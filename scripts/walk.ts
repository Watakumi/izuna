import {
  mkdirSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { basename, join } from 'node:path'
import type { Page } from 'playwright'
import { ROOT, call, launch } from './lib/electron'

/**
 * v1 の 7 手を、本物の Izuna で通しで動かして撮る（docs/GOAL.md 完成の定義）。
 *   pnpm walk [--cwd <GitHub upstream を持つリポジトリ>] [--issue <番号>] [--reset]
 *
 * `--reset` は前回の残骸（worktree・作業ブランチ・sandbox のブランチ・共有フォルダ・GitHub の PR）を
 * 先に片付ける。**使い捨てのリポジトリでだけ使うこと。**
 *
 * **実 API を呼び、GitHub と Forgejo に書く。** 使い捨てのリポジトリで回すこと
 * （既定は `~/work/personal/izuna-v1-walk`。`docs/v1-walk/README.md` に前回の結果がある）。
 *
 * 人がやる部分（釦を押す・承認する・依頼を打つ）はこのスクリプトが**画面を操作して**やる。
 * `window.izuna` を直接呼ぶのは、画面に無い確認（remote のブランチ一覧など）だけ。
 * 撮った PNG は `docs/v1-walk/` に置き、結果は同じ場所の README.md に書く。
 */

const PORT = 9334
const args = process.argv.slice(2)
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const CWD = opt('cwd', join(process.env.HOME ?? '', 'work', 'personal', 'izuna-v1-walk'))
const ISSUE = Number(opt('issue', '1'))
const OUT = join(ROOT, 'docs', 'v1-walk')
mkdirSync(OUT, { recursive: true })
// 前回の PNG は消す。落ちたときの絵が残っていると、通った記録に混ざる
for (const f of readdirSync(OUT)) if (f.endsWith('.png')) rmSync(join(OUT, f))

const sh = (cwd: string, cmd: string, a: string[]): string => {
  try {
    return execFileSync(cmd, a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

/** 前回の残骸を片付ける。GitHub の PR は閉じ、ブランチは消す。共有フォルダは捨てる */
function reset(cwd: string, issue: number): void {
  const deliver = `issue-${issue}`
  sh(cwd, 'git', ['checkout', '-q', 'main'])
  for (const line of sh(cwd, 'git', ['worktree', 'list', '--porcelain']).split('\n')) {
    if (line.startsWith('worktree ') && line.includes('.claude/worktrees')) {
      // CLI のロックが残っていると remove は拒まれる。使い捨てなので外して消す
      sh(cwd, 'git', ['worktree', 'unlock', line.slice(9)])
      sh(cwd, 'git', ['worktree', 'remove', '--force', line.slice(9)])
    }
  }
  sh(cwd, 'git', ['worktree', 'prune'])
  for (const b of sh(cwd, 'git', ['branch', '--format=%(refname:short)'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (b !== 'main') sh(cwd, 'git', ['branch', '-D', b])
  }
  // upstream だけ。sandbox は private で、シェルの git の資格情報では届かない（§7 の 401→404）。
  // sandbox のブランチはアプリの口（`deleteRemoteBranch`）で消す（`resetSandbox`）
  for (const l of sh(cwd, 'git', ['ls-remote', '--heads', 'upstream']).split('\n')) {
    const b = /refs\/heads\/(\S+)$/.exec(l)?.[1]
    if (b && b !== 'main') sh(cwd, 'git', ['push', '-q', 'upstream', '--delete', b])
  }
  const prs = sh(cwd, 'gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--json',
    'number',
    '-q',
    '.[].number'
  ])
    .trim()
    .split('\n')
    .filter(Boolean)
  for (const n of prs) sh(cwd, 'gh', ['pr', 'close', n, '--delete-branch'])
  sh(cwd, 'git', ['fetch', '-q', '--prune', 'upstream'])
  const exclude = join(cwd, '.git', 'info', 'exclude')
  if (!existsSync(exclude) || !readFileSync(exclude, 'utf8').includes('.claude/worktrees'))
    appendFileSync(exclude, '.claude/worktrees/\n')
  rmSync(join(process.env.HOME ?? '', '.izuna', 'teams', basename(cwd)), {
    recursive: true,
    force: true
  })
  sh(cwd, 'git', ['branch', '-D', deliver])
}

const t0 = Date.now()
const stamp = (): string => `${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`
const log = (...a: unknown[]): void => console.log(`[${stamp()}]`, ...a)
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const rows: Array<{ step: string; result: string; shot: string | null }> = []
let shotN = 0
let approvals = 0
const approvalShots: string[] = []

async function shot(page: Page, name: string): Promise<string> {
  shotN++
  const file = `${String(shotN).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: join(OUT, file), animations: 'disabled' })
  log('撮った', file)
  return file
}
const record = (step: string, result: string, shot: string | null = null): void => {
  rows.push({ step, result, shot })
  log(step, '→', result)
}

/** 条件が満たされるまで待つ。上限を過ぎたら理由を言って落ちる */
async function until(
  what: string,
  ok: () => Promise<boolean>,
  maxMs: number,
  everyMs = 1000
): Promise<void> {
  const end = Date.now() + maxMs
  while (Date.now() < end) {
    if (await ok()) return
    await sleep(everyMs)
  }
  throw new Error(`${what} を ${Math.round(maxMs / 1000)} 秒待っても満たされない`)
}

/** 会話に出ている文字を数える。実行役の節目は notice として挟まる（`useSessions`） */
const countText = async (page: Page, text: string | RegExp): Promise<number> =>
  page.getByText(text).count()
/** ブレインが手を止めているか。**実行中だけ「止める」が出る**（App.tsx） */
const idle = async (page: Page): Promise<boolean> =>
  (await page.getByRole('button', { name: '止める' }).count()) === 0

/**
 * 承認は人が持つ（完成の定義 5）。ここでは**このスクリプトが人の役**で、
 * 出た札を読んで「許可」を押す。押した数と、最初の 2 枚を残す。
 */
function answerPermissions(page: Page): () => void {
  let on = true
  void (async () => {
    while (on) {
      try {
        const allow = page.getByRole('button', { name: '許可', exact: true })
        if ((await allow.count()) > 0) {
          if (approvalShots.length < 2)
            approvalShots.push(await shot(page, `approve-${approvals + 1}`))
          await allow.first().click()
          approvals++
        }
      } catch {
        // 描き直しの最中に消えた。次で見る
      }
      await sleep(600)
    }
  })()
  return () => {
    on = false
  }
}

/**
 * 依頼を打つ。返りは**印の数**。区切りの印（BRANCH: / MERGED）は依頼文にも入るので、
 * 「送った時点より増えたか」で返事を見分ける（3 回目に自分の依頼文に反応して踏んだ）
 */
async function send(page: Page, text: string, marker: RegExp): Promise<number> {
  const box = page.getByPlaceholder('依頼を書く（画像は貼るか落とす）')
  await box.fill(text)
  await box.press('Meta+Enter')
  await sleep(1500)
  return countText(page, marker)
}

/**
 * 右のタブ。**字で探さない**（「PR」は本文にも出て、そちらを押していた）。`data-tab` で押す。
 * **座標で押さない** —— 情報タブは幅が違い、切り替えの途中で隣（ループ）に当たった。
 * 要素に click を送り、中身の印（見出し）が出るまで待つ
 */
const TAB_KEY: Record<string, string> = { 情報: 'info', PR: 'pr', ブランチ: 'branch' }

async function tab(page: Page, name: string): Promise<void> {
  const key = TAB_KEY[name]
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.locator(`[data-tab="${key}"]`).evaluate((el) => (el as HTMLElement).click())
    const end = Date.now() + 4000
    while (Date.now() < end) {
      if ((await page.locator(`[data-tab="${key}"][aria-selected="true"]`).count()) > 0) {
        await sleep(800)
        return
      }
      await sleep(250)
    }
  }
  throw new Error(`タブ「${name}」に切り替えられない`)
}

async function main(): Promise<void> {
  if (args.includes('--reset')) {
    reset(CWD, ISSUE)
    log('前回の残骸を片付けた')
  }
  const app = await launch(PORT)
  const { page } = app
  const stopAnswering = answerPermissions(page)
  const repo = basename(CWD)
  try {
    // ── 前提 ─────────────────────────────────────────────
    const facts = await call<{ reachable: boolean; tokenWorks: boolean | null }>(page, 'forgeFacts')
    if (!facts.reachable || facts.tokenWorks !== true)
      throw new Error('Forgejo に届かないかトークンが通らない')
    const gh = await call<{ ok: boolean; detail: string }>(page, 'ghStatus', CWD)
    if (!gh.ok) throw new Error(`gh が使えない: ${gh.detail}`)
    const remotes = await call<Array<{ name: string; role: string }>>(page, 'remotes', CWD)
    const upstream = remotes.find((r) => r.role === 'upstream')
    if (!upstream) throw new Error('GitHub の remote が無い')
    const base = (await call<string | null>(page, 'defaultBranch', CWD, upstream.name)) ?? 'main'

    // ── 1. Forgejo を sandbox の remote として登録する ────────
    const sb = await call<{ owner: string; name: string }>(page, 'forgeEnsureRepo', repo)
    const added = await call<string>(page, 'ensureSandboxRemote', CWD, sb.owner, sb.name)
    const sandbox = (await call<Array<{ name: string; role: string }>>(page, 'remotes', CWD)).find(
      (r) => r.role === 'sandbox'
    )!
    if (args.includes('--reset')) {
      // 前回の作業ブランチを sandbox から消す。**アプリの口で**（資格情報を持つのはアプリ）
      for (const b of await call<string[]>(page, 'remoteHeads', CWD, sandbox.name)) {
        if (b !== base) await call(page, 'deleteRemoteBranch', CWD, sandbox.name, b)
      }
    }
    await call(page, 'push', CWD, sandbox.name, base)
    await until(
      'sandbox に中身が入る',
      async () =>
        (
          await call<Array<{ owner: string; name: string; empty: boolean }>>(page, 'forgeRepos')
        ).some((r) => r.owner === sb.owner && r.name === sb.name && !r.empty),
      30_000
    )
    record('1. Forgejo を sandbox の remote として登録', `${added}。${base} を push`)

    // ── 2. GitHub の Issue を選んでブレインを開く（画面から） ──
    await page.getByRole('button', { name: /新しいセッション/ }).click()
    await page.getByText(repo, { exact: true }).first().click()
    const issueTitle = (
      await call<Array<{ number: number; title: string }>>(page, 'ghIssues', CWD)
    ).find((i) => i.number === ISSUE)?.title
    if (!issueTitle) throw new Error(`Issue #${ISSUE} が無い`)
    // **題名で探さない。** 前回のセッションの題名が同じで「続きから」の行に当たる（2 回目に踏んだ）。
    // Issue の札は `#<番号>` の印を持つので、それで探す
    await until(
      'Issue が出る',
      async () => (await page.getByText(`#${ISSUE}`, { exact: true }).count()) > 0,
      30_000
    )
    await page.getByText(`#${ISSUE}`, { exact: true }).first().click()
    const s2 = await shot(page, 'new-session-from-issue')
    await page.getByRole('button', { name: '開く', exact: true }).click()
    await until(
      '会話が開く',
      async () => (await page.getByPlaceholder('依頼を書く（画像は貼るか落とす）').count()) > 0,
      60_000
    )
    record('2. GitHub の Issue を選んでブレインを開く', `Issue #${ISSUE}「${issueTitle}」`, s2)
    // 最初の依頼でブレインが動き出す。**動き出したのを見てから**、止まるのを待つ
    await sleep(5000)
    await until('ブレインの最初のターンが終わる', () => idle(page), 5 * 60_000)

    // ── 3. ブレインが作業を分解し、worktree ごとに実行役を 2 つ起こす ──
    const seenBranch = await send(
      page,
      [
        `Issue #${ISSUE} を 2 つの作業単位（greet の検査、math の検査）に分けて tasks/ に書き、`,
        'Agent ツール（run_in_background: true, isolation: "worktree"）で実行役を 2 つ同時に起こしてください。',
        '各実行役には、自分の worktree で検査ファイルを 1 つ書き、git でコミットし、summaries/ に要約を書くよう頼んでください。',
        '両方が手を止めたら summaries/ を読み、それぞれの実行役に SendMessage で「検査ファイルの先頭に 1 行コメント（// 目的）を足してコミット」と追加の指示を送ってください。',
        '追加の指示も終わったら、2 つのブランチ名を 1 行ずつ「BRANCH: <名前>」で報告してください。'
      ].join(' '),
      /BRANCH:/
    )
    await until(
      '実行役が 2 つ開く',
      async () => (await countText(page, /を開きました/)) >= 2,
      5 * 60_000
    )
    await sleep(20_000)
    const s3 = await shot(page, 'two-executors-running')
    const worktreesRunning = (
      await call<{ worktrees: Array<{ path: string }> }>(page, 'repo', CWD)
    ).worktrees.filter((w) => w.path.includes('.claude/worktrees')).length
    record(
      '3. ブレインが分解し、worktree ごとに実行役を 2 つ起こす',
      `「実行役 … を開きました」が ${await countText(page, /を開きました/)}、worktree ${worktreesRunning} 本`,
      s3
    )

    // ── 4. 実行役が手を止めたら、ブレインが次の指示を返す ────
    // 実行役は数分かかることがある（1 回目は B が 5 分）。区切りは節目の数ではなく**ブレインの報告**で見る
    await until(
      '実行役が 2 つ止まる',
      async () => (await countText(page, /が手を止めました/)) >= 2,
      15 * 60_000
    )
    const s4a = await shot(page, 'executors-stopped')
    await until(
      'ブレインが追加の指示を終えて BRANCH: を報告する',
      async () => (await countText(page, /BRANCH:/)) > seenBranch && (await idle(page)),
      15 * 60_000
    )
    const s4b = await shot(page, 'followup-delivered')
    const opened = await countText(page, /を開きました/)
    const stopped = await countText(page, /が手を止めました/)
    record(
      '4. 実行役が止まり、ブレインが次の指示を返す',
      `止まった → SendMessage で追加指示 → 報告。「開きました」${opened} 回、「手を止めました」${stopped} 回（追加指示で起き直した分を含む）`,
      `${s4a}, ${s4b}`
    )

    // ── 5. 承認は人 ──────────────────────────────────────
    record(
      '5. 承認を求められたら人が差分を見て許可 / 拒否',
      `${approvals} 件をこのスクリプト（人の役）が許可。実行役の分も含む`,
      approvalShots.join(', ') || null
    )

    // ── 6. sandbox で PR にしてまとめて見る → GitHub に PR ─────
    // 出すブランチは回すたびに別名。前回の PR が sandbox に open のまま残っていても（ブランチを
    // 消しても Forgejo は PR を閉じない）、同名で non-fast-forward にならない
    const deliver = `issue-${ISSUE}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`
    const seenMerged = await send(
      page,
      [
        `本体のリポジトリで ${base} から ${deliver} ブランチを作り、2 つの実行役のブランチ（worktree-agent-*）を merge してください。`,
        `終わったら ${deliver} を checkout したままにして、決めたことを decisions.md に追記し、「MERGED」と一言だけ返してください。`
      ].join(' '),
      /MERGED/
    )
    await until(
      'merge が終わる',
      async () => (await countText(page, /MERGED/)) > seenMerged && (await idle(page)),
      8 * 60_000
    )
    const head = await call<string | null>(page, 'currentBranch', CWD)
    if (head !== deliver) throw new Error(`いまのブランチが ${head}。${deliver} ではない`)

    await tab(page, 'PR')
    await until(
      'sandbox へ push の釦',
      async () => (await page.getByRole('button', { name: `${sandbox.name} に push` }).count()) > 0,
      30_000
    )
    await page.getByRole('button', { name: `${sandbox.name} に push` }).click()
    await until(
      'push が終わる',
      async () => (await page.getByText(/push しました/).count()) > 0,
      60_000
    )
    // 前回の PR が open のまま残っていれば釦は出ない（ブランチを消しても Forgejo は PR を閉じない）。あるものを使う
    const existing = (
      await call<Array<{ number: number; head: string }>>(page, 'forgePulls', sb.owner, sb.name)
    ).find((p) => p.head === deliver)
    if (!existing) {
      await until(
        'sandbox で PR を作る釦',
        async () => (await page.getByRole('button', { name: 'sandbox で PR を作る' }).count()) > 0,
        60_000
      )
      // push の直後は PR が 404 になることがある（§7）。少し置いてから押す
      await sleep(3000)
      await page.getByRole('button', { name: 'sandbox で PR を作る' }).click()
    }
    await until(
      'sandbox の PR が出る',
      async () => (await page.getByText('差分', { exact: true }).count()) > 0,
      60_000
    )
    await page.getByText('差分', { exact: true }).first().click()
    // 「読んでいます…」が消えて、ファイルの数が出るまで。数だけ見ると本文の字に当たる
    await until(
      '差分が描ける',
      async () =>
        (await page.getByText('差分を読んでいます…').count()) === 0 &&
        (await page.getByText(/\d+ ファイル/).count()) > 0,
      60_000
    )
    const s6a = await shot(page, 'sandbox-pr-diff')
    const pulls = await call<Array<{ number: number; htmlUrl: string }>>(
      page,
      'forgePulls',
      sb.owner,
      sb.name
    )
    const runs = await call<Array<{ status: string }>>(page, 'forgeRuns', sb.owner, sb.name)

    // 通ったので GitHub へ。二段目の PR は出すブランチを upstream に push しないと作れない
    await call(page, 'push', CWD, upstream.name, deliver)
    await tab(page, '情報')
    await tab(page, 'PR')
    await until(
      '漏れの判定が出る',
      async () => (await page.getByText(/作業ブランチ/).count()) > 0,
      60_000
    )
    const leakText =
      (await page
        .getByText(/作業ブランチ(が|は) Upstream/)
        .first()
        .textContent()) ?? ''
    const s6pre = await shot(page, 'upstream-ready')
    await page.getByRole('button', { name: 'Upstream に PR を作る' }).click()
    // 押すと「情報」タブに戻る（Forge の onDone）。できたかは口で確かめる
    let prUrl = ''
    await until(
      'GitHub の PR ができる',
      async () => {
        const pr = (
          await call<Array<{ headRefName: string; url: string }>>(page, 'ghPulls', CWD).catch(
            () => []
          )
        ).find((p) => p.headRefName === deliver)
        prUrl = pr?.url ?? ''
        return prUrl !== ''
      },
      90_000
    )
    // アプリ側の「作った」の後始末（情報タブへ戻る）が終わってから切り替える。先に切り替えると戻される
    await sleep(4000)
    await tab(page, 'PR')
    await until(
      'Upstream の PR の数が出る',
      async () => (await page.getByText(/PR 1 件/).count()) > 0,
      60_000
    )
    const s6b = await shot(page, 'upstream-pr-created')
    const upHeads = await call<string[]>(page, 'remoteHeads', CWD, upstream.name)
    const sbHeads = await call<string[]>(page, 'remoteHeads', CWD, sandbox.name)
    record(
      '6. sandbox（Forgejo）で PR にしてまとめて見る → GitHub に push して PR',
      `sandbox PR !${pulls[0]?.number ?? '?'}（CI ${runs[0]?.status ?? '無し'}）→ ${prUrl.trim()}。${leakText.trim()}。GitHub のブランチ: ${upHeads.join(', ')} / sandbox: ${sbHeads.join(', ')}`,
      `${s6a}, ${s6pre}, ${s6b}`
    )

    // ── 7. worktree を畳み、sandbox の作業ブランチは捨てる ───
    // 実行役のブランチは sandbox に置く（GOAL.md 柱 2「実行役のブランチ | Forgejo」）。
    // 7 手目で捨てるものが無いと、捨てる釦が空振りになる。押すのは Izuna の口（資格情報を持つ）
    const agentBranches = (
      await call<{ worktrees: Array<{ path: string; branch: string | null }> }>(page, 'repo', CWD)
    ).worktrees
      .filter((w) => w.path.includes('.claude/worktrees'))
      .map((w) => w.branch)
      .filter((b): b is string => !!b)
    for (const b of agentBranches) await call(page, 'push', CWD, sandbox.name, b)

    // まず sandbox の作業ブランチを PR タブで消す。**同じタブを押し直しても読み直さない**ので、
    // 一度別のタブを経由する。覚えていた一覧が先に出て、remote の一覧は gh の後に届く。節が出るまで待つ
    await tab(page, '情報')
    await tab(page, 'PR')
    await until(
      '作業ブランチの節が出る',
      async () => (await page.getByText('作業ブランチ', { exact: true }).count()) > 0,
      60_000
    )
    for (let i = 0; i < 6; i++) {
      const del = page.getByRole('button', { name: '消す', exact: true })
      const n = await del.count()
      if (n === 0) break
      await del.first().click()
      await until('1 本減る', async () => (await del.count()) < n, 30_000)
    }
    await sleep(1500)
    const s7a = await shot(page, 'sandbox-branches-after-cleanup')

    // 実行役が動いているあいだは CLI が worktree をロックする（消す釦は押せない）。止まれば外れる。
    // 撮ってから、セッションを閉じる。閉じたあとの古いロックは Izuna が外して消す
    await tab(page, 'ブランチ')
    await sleep(1500)
    const s7b = await shot(page, 'worktrees-after-executors')
    await page.getByTitle('このセッションを閉じる').first().click()
    await until(
      'セッションが閉じる',
      async () => (await page.getByText('まだありません').count()) > 0,
      30_000
    )
    await sleep(2000)
    const left = (
      await call<{ worktrees: Array<{ path: string; branch: string | null }> }>(page, 'repo', CWD)
    ).worktrees.filter((w) => w.path !== CWD && w.path.includes('.claude/worktrees'))
    for (const w of left) await call(page, 'removeWorktree', CWD, w.path, true)
    const s7c = await shot(page, 'session-closed-worktrees-removed')

    const worktreesAfter = (await call<{ worktrees: Array<{ path: string }> }>(page, 'repo', CWD))
      .worktrees.length
    const sbAfter = await call<string[]>(page, 'remoteHeads', CWD, sandbox.name)
    const leftover = sbAfter.filter((b) => b !== base && b !== deliver)
    if (leftover.length > 0)
      throw new Error(`sandbox に作業ブランチが残った: ${leftover.join(', ')}`)
    if (worktreesAfter !== 1) throw new Error(`worktree が ${worktreesAfter} 本残った`)
    record(
      '7. worktree を畳み、sandbox の作業ブランチは捨てる',
      `sandbox の作業ブランチ ${agentBranches.length} 本を画面で消し、セッションを閉じてから worktree を消した（CLI の古いロックは Izuna が外す）。worktree ${worktreesAfter} 本（本体のみなら 1）。sandbox のブランチ: ${sbAfter.join(', ')}`,
      `${s7a}, ${s7b}, ${s7c}`
    )
  } catch (e) {
    // 落ちた画面を残す。何が出ていたかが無いと直せない
    await shot(page, 'failed').catch(() => undefined)
    throw e
  } finally {
    stopAnswering()
    writeReadme()
    await app.close()
  }
}

function writeReadme(): void {
  const lines = [
    '# v1 の 7 手を通した記録',
    '',
    `\`pnpm walk\` が ${new Date().toISOString()} に \`${CWD}\` で通したもの（docs/GOAL.md 完成の定義）。`,
    '人の役（釦を押す・承認する・依頼を打つ）はスクリプトが画面を操作して演じた。PNG は同じフォルダにある。',
    '',
    '| 手 | 結果 | 画像 |',
    '| --- | --- | --- |',
    ...rows.map((r) => `| ${r.step} | ${r.result} | ${r.shot ?? ''} |`),
    '',
    `承認は最後まで合わせて ${approvals} 件。かかった時間 ${Math.round((Date.now() - t0) / 1000)} 秒。`,
    ''
  ]
  writeFileSync(join(OUT, 'README.md'), lines.join('\n'))
}

main()
  .then(() => {
    log('通した')
    process.exit(0)
  })
  .catch((e) => {
    log('落ちた:', String(e))
    process.exit(1)
  })

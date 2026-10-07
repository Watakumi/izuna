import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MeetingView } from '../src/shared/meeting'
import { call, launch } from './lib/electron'

/**
 * 会議を本物の Izuna の中で通す（§39）。
 *   pnpm build && npx tsx scripts/meeting-live.ts
 *
 * **実 API を呼ぶ。** `pnpm e2e` は書く口を呼ばない約束なので、こちらに分けた（`walk.ts` と同じ扱い）。
 * 本物の Electron を起こし、renderer から `meetingStart` を呼ぶ —— 人が「始める」を押したときと同じ口。
 *
 * 見るもの:
 * 1. 発言の出来事（`said` / `speaking`）が renderer に届くか
 * 2. 司会が閉じ、`minutes.md` が書かれるか
 * 3. 閉じたあと、claude のプロセスが Electron の下に残らないか
 * 4. 画面の「会議」から開いて、議事録と発言録が出るか（撮る）
 *
 * 作業ディレクトリは作り物の一時ディレクトリ。会議の記録は本物の `~/.izuna/meetings/` に書かれるので、
 * **終わったら自分の分だけ消す**（会議のフォルダと、`members.json` のその cwd の行）。
 * 役の置き場（`~/.izuna/roles/`）が無ければ、アプリが初めて使うときと同じく同梱の役が書き出される。
 */

const PORT = 9336
const BASE = join(homedir(), '.izuna', 'meetings')
let failures = 0
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'NG  '} ${what}`)
  if (!ok) failures++
}
const stamp = (): string => new Date().toISOString().slice(11, 19)

/** Electron の下にいる claude のプロセス。孫まで辿る */
function claudeUnder(pid: number): string[] {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
    .split('\n')
    .map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => !!m)
  const kids = new Set([pid])
  for (let grew = true; grew;) {
    grew = false
    for (const [, p, pp] of rows)
      if (kids.has(Number(pp)) && !kids.has(Number(p))) {
        kids.add(Number(p))
        grew = true
      }
  }
  return rows
    .filter(([, p, , cmd]) => kids.has(Number(p)) && Number(p) !== pid && /claude/.test(cmd))
    .map(([, p, , cmd]) => `${p} ${cmd.slice(0, 80)}`)
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'izuna-meeting-live-'))
  writeFileSync(
    join(cwd, 'README.md'),
    '# notes\n\n個人用のメモアプリ。Electron。メモはローカルの SQLite に保存している。\n'
  )
  const app = await launch(PORT).catch((e: Error) => {
    console.error(e.message)
    process.exit(2)
  })
  const { page } = app
  let id: string | null = null
  try {
    // renderer の側で出来事を溜める。画面が受け取るのと同じ口
    await page.evaluate(() => {
      const w = window as unknown as {
        __m: Array<{ kind: string; who?: string }>
        izuna: { onEvent: (h: (e: { kind: string; event: { kind: string } }) => void) => void }
      }
      w.__m = []
      w.izuna.onEvent((e) => {
        if (e.kind === 'meeting') w.__m.push(e.event)
      })
    })
    const roles = await call<Array<{ name: string }>>(page, 'meetingRoles')
    check(roles.length >= 3, `役が読める（${roles.map((r) => r.name).join(', ')}）`)

    const started = Date.now()
    id = await call<string>(page, 'meetingStart', {
      cwd,
      agenda: 'メモを複数端末で同期したい。自前サーバ / iCloud / 同期しない のどれにするか',
      roles: ['architect', 'security', 'critic']
    })
    console.log(`[${stamp()}] 会議 ${id}`)

    // 閉じるまで待つ。上限 6 分
    let last = 0
    let peak = 0
    for (;;) {
      const events = await page.evaluate(
        () => (window as unknown as { __m: Array<{ kind: string; running?: boolean }> }).__m
      )
      for (const e of events.slice(last))
        console.log(`[${stamp()}]   ${JSON.stringify(e).slice(0, 140)}`)
      last = events.length
      peak = Math.max(peak, claudeUnder(app.ps.pid!).length)
      if (events.some((e) => e.kind === 'running' && e.running === false)) break
      if (Date.now() - started > 6 * 60_000) {
        check(false, '6 分で終わらなかった')
        await call(page, 'meetingStop', id)
        break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    const events = await page.evaluate(
      () => (window as unknown as { __m: Array<{ kind: string }> }).__m
    )
    const count = (k: string): number => events.filter((e) => e.kind === k).length
    check(count('said') >= 3, `発言が renderer に届いた（said ${count('said')} 件）`)
    check(count('speaking') >= 1, `話者が届いた（speaking ${count('speaking')} 件）`)
    check(count('closed') === 1, '司会が閉じた')
    check(count('error') === 0, '壊れていない')
    check(peak >= 2, `会議中に claude が走っていた（最大 ${peak} 本）`)

    const view = await call<MeetingView>(page, 'meetingRead', id)
    check(view.meta.state === 'closed', '控えが closed')
    check(!!view.meta.moderator, '司会の session id が残った')
    check(/### 決まったこと/.test(view.minutes), '議事録に「決まったこと」がある')
    const dir = join(BASE, id)
    check(
      existsSync(join(dir, 'minutes.md')) && existsSync(join(dir, 'transcript.md')),
      'ファイルがある'
    )
    const members = JSON.parse(readFileSync(join(BASE, 'members.json'), 'utf8'))[cwd] ?? {}
    check(Object.keys(members).length >= 1, `覚えが残った（${Object.keys(members).join(', ')}）`)

    // 片付けの待ち（stop は 3 秒で諦める）を越えてから数える
    await new Promise((r) => setTimeout(r, 4000))
    const left = claudeUnder(app.ps.pid!)
    check(left.length === 0, `閉じたあと claude が残っていない（${left.length} 本）`)
    for (const l of left) console.log(`     ${l}`)

    // 画面で開いて撮る
    await page.getByText('会議', { exact: true }).first().click()
    await page.getByText('議事録あり').first().click()
    await page.getByText('決まったこと').first().waitFor({ timeout: 5000 })
    const shot = join(tmpdir(), `izuna-meeting-live-${id}.png`)
    await page.screenshot({ path: shot })
    check(true, `画面で議事録が出た（${shot}）`)

    console.log(
      `\n${seconds} 秒 / 発言 ${view.entries.filter((e) => e.who !== 'moderator' && e.who !== 'human').length} 件`
    )
    console.log('--- 議事録 ---\n' + view.minutes)
  } finally {
    await app.close()
    // 自分の分だけ消す
    if (id) rmSync(join(BASE, id), { recursive: true, force: true })
    const path = join(BASE, 'members.json')
    if (existsSync(path)) {
      const all = JSON.parse(readFileSync(path, 'utf8'))
      delete all[cwd]
      writeFileSync(path, JSON.stringify(all, null, 2))
    }
    rmSync(cwd, { recursive: true, force: true })
  }
  console.log(failures ? `\n${failures} 件 NG` : '\n全部通った')
  process.exit(failures ? 1 : 0)
}

void main()

import { CH, IPC_VERSION } from '../src/shared/ipc'
import { ROOT, call, launch } from './lib/electron'

/**
 * 本物の Electron を起動して、口が通っているかを見る（§30）。
 *
 * `scripts/shots.ts` はブラウザで作り物の `window.izuna` を描く。**main は動かさない。**
 * だから「口を足したのに handler が無い」「Forgejo の口のパスが違う」は、そこでは分からない。
 * ここは本物を起動し、`window.izuna` を renderer から呼んで、返りの形を見る。
 * 起動の仕方は `scripts/lib/electron.ts`（`_electron.launch` を使わない理由もそこに）。
 *
 * 要るもの: `pnpm build` の出力、動いている Forgejo、保管したトークン。
 * 手元専用で、`verify` には入れない（`shots` と同じ）。**書く口は呼ばない** ——
 * push・worktree の削除・セッションの起動は、検査のたびに本物を動かすものではない。
 * 7 手を通しで動かすのは `scripts/walk.ts`。
 */

const PORT = 9333
let failures = 0
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'NG  '} ${what}`)
  if (!ok) failures++
}
const skip = (what: string): void => console.log(`skip ${what}`)

async function main(): Promise<void> {
  const app = await launch(PORT).catch((e: Error) => {
    console.error(e.message)
    process.exit(2)
  })
  const { page } = app
  try {
    // ── 窓と口の面 ─────────────────────────────────────
    check((await page.title()) === 'Izuna', '窓の題が Izuna')
    const keys = await page.evaluate(() =>
      Object.keys((window as unknown as { izuna: object }).izuna).sort()
    )
    const expected = [
      ...Object.keys(CH).filter((k) => k !== 'event' && k !== 'terminalEvent'),
      'onEvent',
      'onTerminal'
    ].sort()
    const missing = expected.filter((k) => !keys.includes(k))
    const extra = keys.filter((k) => !expected.includes(k))
    check(
      missing.length === 0 && extra.length === 0,
      `preload の面が CH と一致する（足りない: ${missing.join(',') || '無し'} / 余り: ${extra.join(',') || '無し'}）`
    )
    check(
      (await call<number>(page, 'ipcVersion')) === IPC_VERSION,
      'IPC_VERSION が main と renderer で同じ'
    )

    // ── 読むだけの口を一通り叩く。handler が無ければここで落ちる ──
    const ro: Array<[string, unknown[]]> = [
      ['configInfo', []],
      ['listSessions', []],
      ['findRepos', []],
      ['listWakeups', []],
      ['ghosttySkin', []],
      ['remotes', [ROOT]],
      ['currentBranch', [ROOT]],
      ['repo', [ROOT]],
      ['worktreeStatus', [ROOT]],
      ['commitsSince', [ROOT, 'HEAD~1']],
      ['teamPath', ['e2e']],
      ['forgeFacts', []]
    ]
    for (const [name, args] of ro) {
      try {
        const v = await call(page, name, ...args)
        check(v !== undefined || name === 'ghosttySkin', `${name}() が返る`)
      } catch (e) {
        check(false, `${name}() が落ちた: ${String(e).slice(0, 120)}`)
      }
    }

    // ── Forgejo。トークンと sandbox が要る ────────────────
    const facts = await call<{
      reachable: boolean
      tokenWorks: boolean | null
      tokenUnreadable: boolean
      config: { rootUrl: string | null } | null
    }>(page, 'forgeFacts')
    if (facts.tokenUnreadable) {
      check(false, '保管したトークンが復号できない（本物の起動でこれなら、鍵が変わっている）')
    } else if (!facts.reachable || facts.tokenWorks !== true) {
      skip(
        `Forgejo に届かないかトークンが無い（reachable=${facts.reachable}, tokenWorks=${facts.tokenWorks}）`
      )
    } else {
      const repos = await call<Array<{ owner: string; name: string; empty: boolean }>>(
        page,
        'forgeRepos'
      )
      check(Array.isArray(repos), `forgeRepos() が一覧を返す（${repos.length} 件）`)
      let seen = false
      for (const r of repos.filter((x) => !x.empty)) {
        const pulls = await call<Array<{ number: number; title: string }>>(
          page,
          'forgePulls',
          r.owner,
          r.name
        )
        if (pulls.length === 0) continue
        const p = pulls[0]
        const files = await call<Array<{ path: string; added: number; removed: number }>>(
          page,
          'forgePullDiff',
          r.owner,
          r.name,
          p.number
        )
        check(
          Array.isArray(files) && files.length > 0 && typeof files[0].path === 'string',
          `forgePullDiff(${r.owner}/${r.name} !${p.number}) が差分を返す（${files.length} ファイル、+${files.reduce((n, f) => n + f.added, 0)}）`
        )
        // Actions の口。無効なら空。**空でも通る** —— 回していないのは異常ではない
        const runs = await call<Array<{ id: number; status: string; ref: string }>>(
          page,
          'forgeRuns',
          r.owner,
          r.name
        )
        check(
          Array.isArray(runs) &&
            runs.every((x) => typeof x.id === 'number' && typeof x.status === 'string'),
          `forgeRuns(${r.owner}/${r.name}) が返る（${runs.length} 件${runs[0] ? `、最新 ${runs[0].status} @ ${runs[0].ref}` : ''}）`
        )
        seen = true
        break
      }
      if (!seen) skip('open な PR が無いので .diff の口は確かめていない')
    }

    // ── 画面。作り物ではなく本物が描いている ──────────────
    check((await page.getByText('セッション', { exact: true }).count()) > 0, '一覧の見出しが出る')
    check((await page.getByText('新しいセッション').count()) > 0, '「新しいセッション」の釦が出る')
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? '\n全部通った' : `\n${failures} 件落ちた`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()

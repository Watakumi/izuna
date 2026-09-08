import { describe, expect, it, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * sandbox（Forgejo）へ push するときの資格情報（CLAUDE.md §7）。
 *
 * ここは**踏んだばかりの経路**なので固めておく。
 *
 * - 作るリポジトリは private なので、匿名では push できない
 * - git はその 401 を `Repository not found` と言うので、原因に辿り着けない
 * - `credential.helper` を止めないと `GIT_ASKPASS` は呼ばれない
 * - **トークンを remote の URL や引数に置かない**（`git remote -v` や `ps` に出る）
 */

let runs: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
let out: Array<string | Error> = []
let token: string | null = 'tok_secret_value'

vi.mock('../src/main/claude/locate', () => ({
  loginShellEnv: async () => ({ PATH: '/usr/bin' })
}))
vi.mock('../src/main/config', () => ({ resolved: async () => ({ sandboxRemote: 'forgejo' }) }))
vi.mock('../src/main/forge/store', () => ({ loadToken: async () => token }))
vi.mock('../src/main/forge/client', () => ({ whoami: async () => 'watakumi' }))
vi.mock('node:child_process', () => ({
  execFile: (...all: unknown[]) => {
    const cb = all[all.length - 1] as (e: Error | null, r?: { stdout: string; stderr: string }) => void
    runs.push({ args: (all[1] as string[]) ?? [], env: (all[2] as { env: NodeJS.ProcessEnv })?.env ?? {} })
    const next = out.shift()
    if (next instanceof Error) cb(next)
    else cb(null, { stdout: next ?? '', stderr: '' })
  }
}))

const load = async (): Promise<typeof import('../src/main/git/remote')> => import('../src/main/git/remote')
const SANDBOX = 'http://localhost:4649/'

beforeEach(() => {
  runs = []
  out = []
  token = 'tok_secret_value'
  vi.resetModules()
})

describe('sandbox 相手のとき', () => {
  it('**credential helper を止める**（止めないと GIT_ASKPASS が呼ばれない）', async () => {
    out = ['http://localhost:4649/watakumi/izuna.git\n', '']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', SANDBOX)
    const args = runs.at(-1)!.args
    expect(args.slice(0, 2)).toEqual(['-c', 'credential.helper='])
    expect(args).toContain('push')
  })

  it('**トークンは環境変数で渡す。引数に置かない**（`ps` で他から見える）', async () => {
    out = ['http://localhost:4649/watakumi/izuna.git\n', '']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', SANDBOX)
    const { args, env } = runs.at(-1)!
    expect(args.join(' ')).not.toContain('tok_secret_value')
    expect(env.IZUNA_GIT_TOKEN).toBe('tok_secret_value')
    expect(env.IZUNA_GIT_USER).toBe('watakumi')
    expect(env.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('仲介を置き、**他人に読めない権限**にする', async () => {
    out = ['http://localhost:4649/watakumi/izuna.git\n', '']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', SANDBOX)
    const path = runs.at(-1)!.env.GIT_ASKPASS!
    expect(existsSync(path)).toBe(true)
    expect(statSync(path).mode & 0o077).toBe(0)
    const script = readFileSync(path, 'utf8')
    expect(script).toContain('IZUNA_GIT_USER')
    // **中身にトークンを書かない。** 環境変数から取る
    expect(script).not.toContain('tok_secret_value')
    expect(path.startsWith(tmpdir()) || path.startsWith(join('/private', tmpdir().replace(/^\//, '')))).toBe(true)
  })

  it('ls-remote にも同じ資格情報を渡す（渡さないと黙って false になる）', async () => {
    out = ['http://localhost:4649/watakumi/izuna.git\n', 'abc refs/heads/main\n']
    const { isPushed } = await load()
    expect(await isPushed('/w', 'forgejo', 'main', SANDBOX)).toBe(true)
    expect(runs.at(-1)!.env.IZUNA_GIT_TOKEN).toBe('tok_secret_value')
  })
})

describe('sandbox 以外', () => {
  it('**GitHub には付けない**（ssh なので要らない。付けると失敗を増やす）', async () => {
    out = ['git@github.com:Watakumi/izuna.git\n', '']
    const { push } = await load()
    await push('/w', 'upstream', 'main', SANDBOX)
    const { args, env } = runs.at(-1)!
    expect(args.slice(0, 2)).not.toEqual(['-c', 'credential.helper='])
    expect(env.IZUNA_GIT_TOKEN).toBeUndefined()
  })

  it('Forgejo の根が分からなければ付けない', async () => {
    out = ['']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', null)
    expect(runs.at(-1)!.env.IZUNA_GIT_TOKEN).toBeUndefined()
  })

  it('remote の URL が引けなければ付けない（落とさない）', async () => {
    out = [new Error('そんな remote は無い'), '']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', SANDBOX)
    expect(runs.at(-1)!.env.IZUNA_GIT_TOKEN).toBeUndefined()
  })

  it('トークンが無ければ付けない（発行前でも push は試せる）', async () => {
    token = null
    out = ['http://localhost:4649/watakumi/izuna.git\n', '']
    const { push } = await load()
    await push('/w', 'forgejo', 'main', SANDBOX)
    expect(runs.at(-1)!.env.IZUNA_GIT_TOKEN).toBeUndefined()
  })
})

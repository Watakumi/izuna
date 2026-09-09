import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Forgejo の準備（段5）。
 *
 * **`forgejo` と `brew` は差し替えるが、渡している引数を必ず見る。**
 * ここは**人の環境を書き換える**唯一の場所なので、
 * 「押したときだけ動くか」「控えを残しているか」「権限を正しく要求しているか」を固定する。
 *
 * 権限の中身は実測（CLAUDE.md §7）——
 * `POST /user/repos` は `write:user` と `write:repository` の両方を要求する。
 */

let work: string
let runs: string[][] = []
let out: Array<string | Error> = []
let saved: { token: string; scopes?: readonly string[] } | null = null
let fetchStatus = 200

vi.mock('../src/main/claude/locate', () => ({
  loginShellEnv: async () => ({ PATH: '/usr/bin', SHELL: '/bin/zsh' })
}))
vi.mock('../src/main/forge/store', () => ({
  loadToken: async () => 'tok_abcdefgh',
  loadScopes: async () => null,
  tokenStatus: async () => tokenState,
  saveToken: async (token: string, scopes?: readonly string[]) => { saved = { token, scopes } }
}))
let tokenState: 'none' | 'unreadable' | 'ok' = 'ok'
vi.mock('node:child_process', () => ({
  execFile: (...all: unknown[]) => {
    const cb = all[all.length - 1] as (e: Error | null, r?: { stdout: string; stderr: string }) => void
    runs.push([all[0] as string, ...((all[1] as string[]) ?? [])])
    const next = out.shift()
    if (next instanceof Error) cb(next)
    else cb(null, { stdout: next ?? '', stderr: '' })
  }
}))

const appIni = (extra = ''): string =>
  `[server]\nROOT_URL = http://localhost:4649/\nHTTP_PORT = 4649\nHTTP_ADDR = 127.0.0.1\n\n[security]\nINSTALL_LOCK = true\n${extra}`

const setUp = (extra = ''): void => {
  mkdirSync(join(work, 'custom', 'conf'), { recursive: true })
  writeFileSync(join(work, 'custom', 'conf', 'app.ini'), appIni(extra))
}

const load = async (): Promise<typeof import('../src/main/forge/setup')> => {
  vi.doMock('../src/main/config', () => ({
    resolved: async () => ({ forgejoWorkPaths: [work], forgejoUrl: null, ignored: [] })
  }))
  return import('../src/main/forge/setup')
}

beforeEach(() => {
  tokenState = 'ok'
  work = mkdtempSync(join(tmpdir(), 'izuna-f-'))
  runs = []
  out = []
  saved = null
  fetchStatus = 200
  vi.resetModules()
  vi.stubGlobal('fetch', async () => ({
    ok: fetchStatus < 400, status: fetchStatus,
    json: async () => ({ login: 'me' }), text: async () => ''
  }))
})

describe('調べる', () => {
  it('forgejo が無ければ、それ以上調べない', async () => {
    out = [new Error('見つからない'), new Error('見つからない')]
    const { gatherFacts } = await load()
    const f = await gatherFacts()
    expect(f).toMatchObject({ binary: null, version: null, config: null, reachable: false })
  })

  it('版・設定・応答を集める', async () => {
    setUp()
    out = ['/opt/homebrew/bin/forgejo', 'Forgejo version 16.0.3+gitea-1.22.0']
    const { gatherFacts } = await load()
    const f = await gatherFacts()
    expect(f.binary).toContain('forgejo')
    expect(f.version).toBe('16.0.3+gitea-1.22.0')
    expect(f.config).toMatchObject({ rootUrl: 'http://localhost:4649/', installLocked: true })
    expect(f.reachable).toBe(true)
  })

  it('app.ini が無ければ config は null（落ちない）', async () => {
    out = ['/opt/homebrew/bin/forgejo', 'version 16.0.3']
    const { gatherFacts } = await load()
    expect((await gatherFacts()).config).toBeNull()
  })

  it('**権限はサーバに聞く**（発行時の記録ではなく事実）', async () => {
    setUp()
    out = ['/opt/homebrew/bin/forgejo', 'version 16.0.3']
    vi.stubGlobal('fetch', async (url: URL) => ({
      ok: true, status: 200,
      json: async () => String(url).endsWith('/tokens')
        ? [{ id: 1, name: 'izuna', scopes: ['write:user', 'write:repository'],
             token_last_eight: 'abcdefgh', created_at: '' }]
        : { login: 'me' },
      text: async () => ''
    }))
    const { gatherFacts } = await load()
    expect((await gatherFacts()).tokenScopes).toEqual(['write:user', 'write:repository'])
  })

  it('保管はあるのに復号できなければ、そう言う（「未設定」ではない）', async () => {
    setUp()
    tokenState = 'unreadable'
    out = ['/opt/homebrew/bin/forgejo', 'version 16.0.3']
    const { gatherFacts } = await load()
    expect((await gatherFacts()).tokenUnreadable).toBe(true)
  })

  it('トークンが拒まれたら works: false', async () => {
    setUp()
    out = ['/opt/homebrew/bin/forgejo', 'version 16.0.3']
    fetchStatus = 401
    const { gatherFacts } = await load()
    expect((await gatherFacts()).tokenWorks).toBe(false)
  })
})

describe('押したときだけ動く', () => {
  it('入れる・起こすは brew に任せる', async () => {
    out = [new Error('無い'), new Error('無い'), '']
    const { applyFix } = await load()
    expect(await applyFix('install')).toContain('brew install')
    expect(runs.at(-1)).toEqual(['brew', 'install', 'forgejo'])
  })

  it('起動', async () => {
    out = [new Error('無い'), new Error('無い'), '']
    const { applyFix } = await load()
    await applyFix('start')
    expect(runs.at(-1)).toEqual(['brew', 'services', 'start', 'forgejo'])
  })

  it('**トークンは write:user を含めて発行する**（無いと POST /user/repos が 403）', async () => {
    setUp()
    out = ['/f', 'version 1', 'ID\tUsername\n1\twatakumi\tx\n2\tizuna\ty', 'tok_new_abcdefgh']
    const { applyFix } = await load()
    const msg = await applyFix('token')
    const args = runs.at(-1)!
    expect(args).toContain('generate-access-token')
    const scopes = args[args.indexOf('--scopes') + 1]
    expect(scopes).toContain('write:user')
    expect(scopes).toContain('write:repository')
    expect(saved?.token).toBe('tok_new_abcdefgh')
    expect(saved?.scopes).toContain('write:user')
    expect(msg).toContain('izuna')
  })

  it('**人（管理者）のトークンは作らない。** ボットのものを発行する（§26）', async () => {
    setUp()
    out = ['/f', 'version 1', 'ID\tUsername\n1\twatakumi\tx\n2\tizuna\ty', 'tok_new_abcdefgh']
    const { applyFix } = await load()
    await applyFix('token')
    const args = runs.at(-1)!
    expect(args[args.indexOf('--username') + 1]).toBe('izuna')
    expect(args.join(' ')).not.toContain('watakumi')
  })

  it('ボットが無ければ作ってから発行する。パスワードは乱数で捨てる', async () => {
    setUp()
    out = ['/f', 'version 1', 'ID\tUsername\n1\twatakumi\tx', '', 'tok_new_abcdefgh']
    const { applyFix } = await load()
    await applyFix('token')
    const create = runs.find((r) => r.includes('create'))!
    expect(create.slice(0, 4)).toEqual(['/f', 'admin', 'user', 'create'])
    expect(create[create.indexOf('--username') + 1]).toBe('izuna')
    expect(create).toContain('--random-password')
    expect(create).toContain('--must-change-password=false')
    expect(create.join(' ')).not.toMatch(/--password/)
    expect(runs.at(-1)).toContain('generate-access-token')
  })

  it('経路が危なければトークンを試さない（分からないまま返す）', async () => {
    setUp()
    writeFileSync(join(work, 'custom', 'conf', 'app.ini'),
      appIni().replace('http://localhost:4649/', 'http://192.168.1.10:4649/'))
    out = ['/opt/homebrew/bin/forgejo', 'version 16.0.3']
    const { gatherFacts } = await load()
    const f = await gatherFacts()
    expect(f.tokenWorks).toBeNull()
    expect(f.tokenScopes).toBeNull()
  })

  it('Forgejo が無ければトークンは作らない', async () => {
    out = [new Error('無い'), new Error('無い')]
    const { applyFix } = await load()
    await expect(applyFix('token')).rejects.toThrow(/見つかりません/)
  })
})

describe('設定を書き換えるときは控えを残す', () => {
  it('**書き換える前に控えを残す**（壊して戻せないのが一番困る）', async () => {
    setUp()
    out = ['/f', 'version 1', '']
    const { applyFix } = await load()
    await applyFix('actions')
    const path = join(work, 'custom', 'conf', 'app.ini')
    expect(existsSync(`${path}.izuna-backup`)).toBe(true)
    expect(readFileSync(`${path}.izuna-backup`, 'utf8')).not.toContain('[actions]')
    expect(readFileSync(path, 'utf8')).toMatch(/\[actions\][\s\S]*ENABLED = true/)
    expect(runs.at(-1)).toEqual(['brew', 'services', 'restart', 'forgejo'])
  })

  it('既に [actions] があれば値だけ変える（節を二重に作らない）', async () => {
    setUp('\n[actions]\nENABLED = false\n')
    out = ['/f', 'version 1', '']
    const { applyFix } = await load()
    await applyFix('actions')
    const text = readFileSync(join(work, 'custom', 'conf', 'app.ini'), 'utf8')
    expect(text.match(/\[actions\]/g)).toHaveLength(1)
    expect(text).toContain('ENABLED = true')
  })

  it('待ち受けを開くときも控えを残す', async () => {
    setUp()
    out = ['/f', 'version 1', '']
    const { applyFix } = await load()
    await applyFix('openAddr')
    const path = join(work, 'custom', 'conf', 'app.ini')
    expect(existsSync(`${path}.izuna-backup`)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('HTTP_ADDR = 0.0.0.0')
  })

  it('**書ける形でなければ触らない。** 手でやる場所を言う', async () => {
    mkdirSync(join(work, 'custom', 'conf'), { recursive: true })
    writeFileSync(join(work, 'custom', 'conf', 'app.ini'),
      '[server]\nROOT_URL = http://localhost:4649/\n[security]\nINSTALL_LOCK = true\n')
    out = ['/f', 'version 1']
    const { applyFix } = await load()
    await expect(applyFix('openAddr')).rejects.toThrow(/HTTP_ADDR/)
    expect(existsSync(join(work, 'custom', 'conf', 'app.ini.izuna-backup'))).toBe(false)
  })

  it('app.ini が無ければ書き換えない', async () => {
    out = ['/f', 'version 1']
    const { applyFix } = await load()
    await expect(applyFix('actions')).rejects.toThrow(/app\.ini/)
  })
})

describe('runner の登録トークン', () => {
  it('forgejo-cli に聞いて、そのまま見せる', async () => {
    setUp()
    out = ['/f', 'version 1', 'ABCDEF123456']
    const { applyFix } = await load()
    expect(await applyFix('runnerToken')).toContain('ABCDEF123456')
    expect(runs.at(-1)).toEqual(expect.arrayContaining(['forgejo-cli', 'actions', 'generate-runner-token']))
  })
})

describe('手元に forgejo が無い構成（docs/SETUP.md）', () => {
  const loadRemote = async (): Promise<typeof import('../src/main/forge/setup')> => {
    vi.doMock('../src/main/config', () => ({
      resolved: async () => ({ forgejoWorkPaths: [], forgejoUrl: 'http://localhost:4649/', ignored: [] })
    }))
    return import('../src/main/forge/setup')
  }

  it('forgejoUrl があれば、binary が無くても応答とトークンを調べ、remote を立てる', async () => {
    out = [new Error('見つからない'), new Error('見つからない')]
    const { gatherFacts } = await loadRemote()
    const f = await gatherFacts()
    expect(f.binary).toBeNull()
    expect(f.remote).toBe(true)
    expect(f.config?.rootUrl).toBe('http://localhost:4649/')
    expect(f.reachable).toBe(true)
    expect(f.tokenWorks).toBe(true)
  })

  it('貼られたトークンは、**通るか・ボットのものか**を聞いてから保管する', async () => {
    const { adoptToken } = await loadRemote()
    vi.stubGlobal('fetch', async (url: URL) => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => String(url).includes('/tokens')
        ? [{ id: 1, name: 'izuna', scopes: ['write:user', 'write:repository'], token_last_eight: 'aaaaaaaa', created_at: '' }]
        : { login: 'izuna' },
      text: async () => ''
    }))
    const msg = await adoptToken('http://localhost:4649/', ' fake-aaaaaaaa ')
    expect(msg).toContain('izuna')
    expect(saved).toEqual({ token: 'fake-aaaaaaaa', scopes: ['write:user', 'write:repository'] })
  })

  it('人のトークンは受け取らない。通らないものも保管しない。空も LAN も断る', async () => {
    const { adoptToken } = await loadRemote()
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ login: 'watakumi' }), text: async () => '' }))
    await expect(adoptToken('http://localhost:4649/', 'tok')).rejects.toThrow(/人の鍵/)
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, statusText: 'x', json: async () => ({}), text: async () => '' }))
    await expect(adoptToken('http://localhost:4649/', 'tok')).rejects.toThrow(/401/)
    await expect(adoptToken('http://localhost:4649/', '   ')).rejects.toThrow(/空/)
    await expect(adoptToken('http://192.168.1.5:4649/', 'tok')).rejects.toThrow(/平文/)
    expect(saved).toBeNull()
  })
})

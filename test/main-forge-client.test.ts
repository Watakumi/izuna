import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * Forgejo の API クライアント（段5）。
 *
 * **`fetch` を差し替えて、送っているものと解釈を見る。** ここで確かめたいのは
 * 「どの口を、どの権限で叩き、返ってきた形をどう読むか」で、通信そのものではない。
 *
 * Electron の `safeStorage` は動かせないので、トークンの置き場だけ差し替える。
 */

vi.mock('../src/main/forge/store', () => ({
  loadToken: async () => stored,
  loadScopes: async () => null,
  saveToken: async () => undefined
}))

let stored: string | null = 'tok_abcdef12345678'
let calls: Array<{ url: string; init: RequestInit }> = []

/** 次に返す応答を積む。`status` が 2xx 以外なら本文をそのまま返す */
const reply = (body: unknown, status = 200): void => {
  responses.push({ body, status })
}
let responses: Array<{ body: unknown; status: number }> = []

beforeEach(() => {
  stored = 'tok_abcdef12345678'
  calls = []
  responses = []
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses.shift() ?? { body: [], status: 200 }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: 'x',
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body))
    }
  })
})

describe('呼び方', () => {
  it('トークンが無ければ、発行する場所を言って落ちる', async () => {
    stored = null
    const { listRepos, ForgeError } = await import('../src/main/forge/client')
    await expect(listRepos('http://localhost:4649/')).rejects.toBeInstanceOf(ForgeError)
    await expect(listRepos('http://localhost:4649/')).rejects.toThrow(/発行/)
  })

  it('api/v1 の下に付け、トークンを添える', async () => {
    const { listRepos } = await import('../src/main/forge/client')
    reply([])
    await listRepos('http://localhost:4649/')
    expect(calls[0].url).toBe('http://localhost:4649/api/v1/user/repos?limit=100')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      'token tok_abcdef12345678'
    )
  })

  it('**403 は足りない権限を名指しする**（「足りません」だけでは直せない）', async () => {
    const { ensureRepo } = await import('../src/main/forge/client')
    reply({ login: 'me' })
    reply([])
    reply('{"message":"token does not have at least one of required scope(s): [write:user]"}', 403)
    await expect(ensureRepo('http://localhost:4649/', 'r')).rejects.toThrow(/write:user/)
  })

  it('それ以外の失敗は本文をそのまま見せる', async () => {
    const { listRepos } = await import('../src/main/forge/client')
    reply('落ちています', 500)
    await expect(listRepos('http://localhost:4649/')).rejects.toThrow(/落ちています/)
  })
})

describe('読み取り', () => {
  it('リポジトリの形を読む', async () => {
    const { listRepos } = await import('../src/main/forge/client')
    reply([
      {
        full_name: 'me/r',
        owner: { login: 'me' },
        name: 'r',
        private: true,
        default_branch: 'main',
        html_url: 'http://x/me/r',
        empty: false
      }
    ])
    const [r] = await listRepos('http://localhost:4649/')
    expect(r).toMatchObject({
      owner: 'me',
      name: 'r',
      private: true,
      defaultBranch: 'main',
      empty: false
    })
  })

  it('**中身の無いリポジトリの 404 は「まだ無い」**（PR は存在しえない）', async () => {
    const { listPulls } = await import('../src/main/forge/client')
    reply({ message: 'The target could not be found.' }, 404)
    await expect(listPulls('http://localhost:4649/', 'o', 'r')).resolves.toEqual([])
  })

  it('404 以外は握りつぶさない', async () => {
    const { listPulls } = await import('../src/main/forge/client')
    reply('壊れています', 500)
    await expect(listPulls('http://localhost:4649/', 'o', 'r')).rejects.toThrow()
  })

  it('PR の形を読む', async () => {
    const { listPulls } = await import('../src/main/forge/client')
    reply([
      {
        number: 3,
        title: 'なおす',
        html_url: 'http://x/3',
        head: { ref: 'feat' },
        base: { ref: 'main' },
        state: 'open'
      }
    ])
    const [p] = await listPulls('http://localhost:4649/', 'o', 'r')
    expect(p).toMatchObject({ number: 3, title: 'なおす', head: 'feat', base: 'main' })
  })

  it('トークンの一覧は権限と末尾 8 文字を返す（記録ではなくサーバの事実）', async () => {
    const { listTokens } = await import('../src/main/forge/client')
    reply([
      {
        id: 1,
        name: 'izuna-x',
        scopes: ['write:user'],
        token_last_eight: 'abcd1234',
        created_at: '2026-09-08T00:00:00+09:00'
      }
    ])
    const [t] = await listTokens('http://localhost:4649/', 'me')
    expect(t).toMatchObject({ id: 1, name: 'izuna-x', last8: 'abcd1234' })
    expect(t.scopes).toEqual(['write:user'])
  })

  it('scopes が null でも空で返す', async () => {
    const { listTokens } = await import('../src/main/forge/client')
    reply([{ id: 1, name: 'x', scopes: null, token_last_eight: 'z', created_at: '' }])
    expect((await listTokens('http://localhost:4649/', 'me'))[0].scopes).toEqual([])
  })
})

describe('作る', () => {
  it('自分の名前を引く', async () => {
    const { whoami } = await import('../src/main/forge/client')
    reply({ login: 'me' })
    expect(await whoami('http://localhost:4649/')).toBe('me')
  })

  it('**既にあれば作らない**（作業場は作り直す前提なので冪等にする）', async () => {
    const { ensureRepo } = await import('../src/main/forge/client')
    reply({ login: 'me' })
    reply([
      {
        full_name: 'me/r',
        owner: { login: 'me' },
        name: 'r',
        private: true,
        default_branch: 'main',
        html_url: '',
        empty: true
      }
    ])
    const r = await ensureRepo('http://localhost:4649/', 'r')
    expect(r.name).toBe('r')
    expect(calls).toHaveLength(2) // POST していない
  })

  it('無ければ private で作る', async () => {
    const { ensureRepo } = await import('../src/main/forge/client')
    reply({ login: 'me' })
    reply([])
    reply({
      full_name: 'me/new',
      owner: { login: 'me' },
      name: 'new',
      private: true,
      default_branch: 'main',
      html_url: '',
      empty: true
    })
    await ensureRepo('http://localhost:4649/', 'new')
    const post = calls[2]
    expect(post.init.method).toBe('POST')
    expect(JSON.parse(String(post.init.body))).toMatchObject({ name: 'new', private: true })
  })

  it('PR を作る', async () => {
    const { createPull } = await import('../src/main/forge/client')
    reply({
      number: 7,
      title: 't',
      html_url: 'http://x/7',
      head: { ref: 'feat' },
      base: { ref: 'main' },
      state: 'open'
    })
    const p = await createPull('http://localhost:4649/', 'o', 'r', {
      title: 't',
      head: 'feat',
      base: 'main'
    })
    expect(p.number).toBe(7)
    expect(calls[0].init.method).toBe('POST')
  })
})

describe('経路（§26）', () => {
  it('**平文で LAN を通る根にはトークンを送らない**', async () => {
    const { listRepos } = await import('../src/main/forge/client')
    await expect(listRepos('http://192.168.1.10:4649/')).rejects.toThrow(/トークンを送りません/)
    expect(calls).toHaveLength(0)
  })
})

describe('PR の差分', () => {
  it('.diff を文字列で取る（JSON ではない）。読むのは shared/patch.ts', async () => {
    const { pullDiff } = await import('../src/main/forge/client')
    reply('diff --git a/x b/x\n')
    expect(await pullDiff('http://localhost:4649/', 'me', 'r', 7)).toBe('diff --git a/x b/x\n')
    expect(calls[0].url).toBe('http://localhost:4649/api/v1/repos/me/r/pulls/7.diff')
  })
})

describe('Actions の実行（GOAL.md 測り方「Izuna がその状態を読める」）', () => {
  it('/actions/runs を叩き、ref は refs/heads/ を付けて渡す', async () => {
    const { listRuns } = await import('../src/main/forge/client')
    reply([])
    await listRuns('http://localhost:4649/', 'izuna', 'r', 'feat/x')
    expect(calls[0].url).toBe(
      'http://localhost:4649/api/v1/repos/izuna/r/actions/runs?limit=20&ref=refs%2Fheads%2Ffeat%2Fx'
    )
  })

  it('ref が既に refs/ なら二重に付けない。無ければ付けない', async () => {
    const { listRuns } = await import('../src/main/forge/client')
    reply([])
    await listRuns('http://localhost:4649/', 'izuna', 'r', 'refs/heads/main')
    expect(calls[0].url).toContain('ref=refs%2Fheads%2Fmain')
    reply([])
    await listRuns('http://localhost:4649/', 'izuna', 'r')
    expect(calls[1].url).not.toContain('ref=')
  })

  it('配列でも { workflow_runs } でも同じ形に読む', async () => {
    const { listRuns } = await import('../src/main/forge/client')
    const raw = {
      id: 7,
      title: 'verify',
      status: 'success',
      event: 'push',
      prettyref: 'refs/heads/feat/x',
      commit_sha: 'abc',
      html_url: 'http://x/r/actions/runs/7',
      workflow_id: 'verify.yml',
      started: '2026-09-09T00:00:00Z',
      stopped: ''
    }
    reply([raw])
    const a = await listRuns('http://localhost:4649/', 'izuna', 'r')
    reply({ workflow_runs: [raw], total_count: 1 })
    const b = await listRuns('http://localhost:4649/', 'izuna', 'r')
    expect(a).toEqual(b)
    expect(a[0]).toEqual({
      id: 7,
      title: 'verify',
      status: 'success',
      event: 'push',
      ref: 'refs/heads/feat/x',
      sha: 'abc',
      htmlUrl: 'http://x/r/actions/runs/7',
      workflow: 'verify.yml',
      startedAt: '2026-09-09T00:00:00Z',
      stoppedAt: null
    })
  })

  it('prettyref が無ければ head_branch から組む', async () => {
    const { listRuns } = await import('../src/main/forge/client')
    reply([
      {
        id: 1,
        title: 't',
        status: 'running',
        event: 'push',
        head_branch: 'main',
        commit_sha: 'a',
        html_url: 'u',
        workflow_id: 'w',
        started: null,
        stopped: null
      }
    ])
    expect((await listRuns('http://localhost:4649/', 'o', 'r'))[0].ref).toBe('refs/heads/main')
  })

  it('**Actions が無効の 404 は「回していない」なので空**。それ以外は落とす', async () => {
    const { listRuns } = await import('../src/main/forge/client')
    reply('actions disabled', 404)
    expect(await listRuns('http://localhost:4649/', 'o', 'r')).toEqual([])
    reply('落ちています', 500)
    await expect(listRuns('http://localhost:4649/', 'o', 'r')).rejects.toThrow(/落ちています/)
  })
})

describe('PR を閉じる（片付け。マージはしない）', () => {
  it('PATCH /pulls/{n} に state: closed を送り、形を読む', async () => {
    const { closePull } = await import('../src/main/forge/client')
    reply({
      number: 7,
      title: 't',
      state: 'closed',
      head: { ref: 'a' },
      base: { ref: 'main' },
      html_url: 'http://x/pulls/7',
      draft: false,
      merged: false,
      created_at: '2026-09-10T00:00:00Z'
    })
    const p = await closePull('http://localhost:4649/', 'izuna', 'r', 7)
    expect(calls[0].url).toBe('http://localhost:4649/api/v1/repos/izuna/r/pulls/7')
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ state: 'closed' })
    expect(p.state).toBe('closed')
  })
})

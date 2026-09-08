import { describe, expect, it, beforeEach, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * `claude` を飼うセッション層（CLAUDE.md §6・§7・§13）。
 *
 * **SDK は差し替えるが、渡している引数は必ず見る。** ここで一番大事なのは
 * 「何を渡しているか」であって、SDK の動作ではない ——
 * `systemPrompt` を省くと**エージェントが自分の居場所を知らないまま
 * それらしいパスを作り話する**（§7 実測）。そういう決定が消えていないかを固定する。
 *
 * 引数を見ない模造を置くと、**引数が間違っていても通る検査**になる。
 */

/** `query()` に渡された options を覚える */
let passed: Record<string, unknown> | null = null
/** 入力の流れ（`prompt`）。`send()` が何を積むかを見るために持つ */
let prompt: AsyncIterable<Record<string, unknown>> | null = null
/** 画面に流す messages を後から差し込むための口 */
let feed: (m: SDKMessage) => void
let finish: () => void
let failWith: ((e: Error) => void) | null = null
/** `canUseTool` を外から呼ぶための控え */
let askTool: ((name: string, input: unknown, opts: unknown) => Promise<unknown>) | null = null
const calls: string[] = []
/** `return()` が返らない状況を作る（§7 の「終われないアプリ」） */
let hangOnReturn = false

vi.mock('../src/main/claude/locate', () => ({
  locateClaude: async () => '/opt/claude',
  loginShellEnv: async () => ({ PATH: '/usr/bin', SHELL: '/bin/zsh' })
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (arg: { prompt: AsyncIterable<Record<string, unknown>>; options: Record<string, unknown> }) => {
    passed = arg.options
    prompt = arg.prompt
    askTool = arg.options.canUseTool as typeof askTool
    const queue: SDKMessage[] = []
    let wake: (() => void) | null = null
    let done = false
    let error: Error | null = null
    feed = (m) => { queue.push(m); wake?.() }
    finish = () => { done = true; wake?.() }
    failWith = (e) => { error = e; wake?.() }

    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          if (error) throw error
          if (queue.length > 0) { yield queue.shift()!; continue }
          if (done) return
          await new Promise<void>((r) => { wake = r })
        }
      },
      interrupt: async () => { calls.push('interrupt') },
      setPermissionMode: async (m: string) => { calls.push(`mode:${m}`) },
      setModel: async (m?: string) => { calls.push(`model:${m ?? '既定'}`) },
      supportedCommands: async () => [{ name: 'verify', description: '', argumentHint: '' }],
      return: async () => {
        calls.push('return')
        if (hangOnReturn) await new Promise(() => {}) // 返らない
      }
    }
  }
}))

const load = async (): Promise<typeof import('../src/main/claude/session')> =>
  import('../src/main/claude/session')

beforeEach(() => {
  passed = null
  prompt = null
  askTool = null
  hangOnReturn = false
  calls.length = 0
  vi.resetModules()
})

describe('起動時に渡すもの', () => {
  it('**`systemPrompt` に claude_code の preset を必ず渡す**（省くと居場所を知らないまま作り話をする）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w' }).start()
    expect(passed?.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' })
  })

  it('追記があれば preset に足す（差し替えない）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w', appendSystemPrompt: '共有フォルダは …' }).start()
    expect(passed?.systemPrompt).toMatchObject({ preset: 'claude_code', append: '共有フォルダは …' })
  })

  it('読み込む設定の範囲をそのまま渡す（§13）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w', settingSources: ['project', 'local'] }).start()
    expect(passed?.settingSources).toEqual(['project', 'local'])
  })

  it('実行役の発話も流す（既定では tool_use しか来ず、何をしたか見えない）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w' }).start()
    expect(passed?.forwardSubagentText).toBe(true)
    expect(passed?.includePartialMessages).toBe(true)
  })

  it('claude の場所とログインシェルの環境を渡す（Finder 起動は PATH を継承しない）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w' }).start()
    expect(passed?.pathToClaudeCodeExecutable).toBe('/opt/claude')
    expect(passed?.env).toMatchObject({ PATH: '/usr/bin' })
  })

  it('cwd・model・resume・共有フォルダを渡す', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({
      cwd: '/w', model: 'haiku', resume: 's1', additionalDirectories: ['/teams/t']
    }).start()
    expect(passed).toMatchObject({
      cwd: '/w', model: 'haiku', resume: 's1', additionalDirectories: ['/teams/t']
    })
  })

  it('**プロセス内の MCP サーバを渡せる**（自律ループの進捗ツール用）', async () => {
    const { ClaudeSession } = await load()
    const fake = { type: 'sdk', name: 'izuna' } as never
    await new ClaudeSession({ cwd: '/w', mcpServers: { izuna: fake } }).start()
    expect(passed?.mcpServers).toEqual({ izuna: fake })
  })

  it('渡さなければ、その鍵ごと出さない（空を渡して既定を壊さない）', async () => {
    const { ClaudeSession } = await load()
    await new ClaudeSession({ cwd: '/w' }).start()
    expect(passed && 'mcpServers' in passed).toBe(false)
  })

  it('二度起動しない', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    await expect(s.start()).rejects.toThrow(/既に/)
  })
})

describe('送る', () => {
  it('起動前に送ろうとしたら落ちる', async () => {
    const { ClaudeSession } = await load()
    expect(() => new ClaudeSession({ cwd: '/w' }).send('やあ')).toThrow(/起動/)
  })

  it('**人の打鍵であることを明示する**（省くと出所不明として扱われる）', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const it = prompt![Symbol.asyncIterator]()
    s.send('やあ')
    const { value } = await it.next()
    expect(value).toMatchObject({ type: 'user', origin: { kind: 'human' } })
    expect(JSON.stringify(value)).toContain('やあ')
  })
})

describe('入力の待ち行列', () => {
  /**
   * SDK は入力を**先に読みに来て待つ**。そこへ `send()` が入る。
   * ここが壊れると、**送った依頼が消えるか、止まる**。
   */
  it('読み手が待っているところへ届く', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const it = prompt![Symbol.asyncIterator]()
    const waiting = it.next()          // 先に読みに来る
    s.send('あとから来た')              // そのあと送る
    expect(JSON.stringify((await waiting).value)).toContain('あとから来た')
  })

  it('先に積んだものは順に出る', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    s.send('一'); s.send('二')
    const it = prompt![Symbol.asyncIterator]()
    expect(JSON.stringify((await it.next()).value)).toContain('一')
    expect(JSON.stringify((await it.next()).value)).toContain('二')
  })

  it('**待っている読み手を終了で起こす**（起こさないと永久に待つ）', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const it = prompt![Symbol.asyncIterator]()
    const waiting = it.next()
    await s.stop()
    expect((await waiting).done).toBe(true)
  })

  it('終了後は読み終わる', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    await s.stop()
    expect((await prompt![Symbol.asyncIterator]().next()).done).toBe(true)
  })
})

describe('いまの状態', () => {
  it('起動で running、終了で止まる。session_id は init で入る', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    expect(s.running).toBe(false)
    expect(s.sessionId).toBeUndefined()
    await s.start()
    expect(s.running).toBe(true)
    feed({ type: 'system', subtype: 'init', session_id: 'abc' } as unknown as SDKMessage)
    await new Promise((r) => setTimeout(r, 10))
    expect(s.sessionId).toBe('abc')
    await s.stop()
    expect(s.running).toBe(false)
  })
})

describe('受け取る', () => {
  it('messages をそのまま流し、init で session_id を覚える', async () => {
    const { ClaudeSession } = await load()
    const s = await (async () => { const x = new ClaudeSession({ cwd: '/w' }); await x.start(); return x })()
    const seen: string[] = []
    s.on('message', (m) => seen.push(m.type))
    feed({ type: 'system', subtype: 'init', session_id: 'abc' } as unknown as SDKMessage)
    feed({ type: 'assistant', message: { content: [] } } as unknown as SDKMessage)
    await new Promise((r) => setTimeout(r, 10))
    expect(seen).toEqual(['system', 'assistant'])
  })

  it('終わったら done', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const done = new Promise<void>((r) => s.on('done', () => r()))
    finish()
    await expect(done).resolves.toBeUndefined()
  })

  it('壊れたら error（黙って止まらない）', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const got = new Promise<Error>((r) => s.on('error', r))
    failWith!(new Error('壊れた'))
    expect((await got).message).toBe('壊れた')
  })
})

describe('承認（§6）', () => {
  it('要求を画面に上げ、答えを CLI に返す', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const asked = new Promise<{ id: string; toolName: string; agentId?: string }>((r) => s.on('permission', r))
    const answer = askTool!('Write', { file_path: '/a' }, { toolUseID: 't1', agentID: 'a1' })
    const req = await asked
    expect(req).toMatchObject({ toolName: 'Write', agentId: 'a1' })
    s.respondToPermission(req.id, { behavior: 'allow' })
    expect(await answer).toMatchObject({ behavior: 'allow' })
  })

  it('**取り消されたら deny**（答えないまま放置すると CLI が待ち続ける）', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const ctrl = new AbortController()
    const answer = askTool!('Bash', {}, { signal: ctrl.signal })
    ctrl.abort()
    expect(await answer).toMatchObject({ behavior: 'deny' })
  })

  it('**終了時は未応答を deny で畳む**。fail-open に反転させない', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const answer = askTool!('Write', {}, {})
    await s.stop()
    expect(await answer).toMatchObject({ behavior: 'deny' })
  })

  it('**誰も答えなければ deny する**（無人で回した瞬間に固まらないように）', async () => {
    vi.useFakeTimers()
    try {
      const { ClaudeSession } = await load()
      const s = new ClaudeSession({ cwd: '/w' })
      await s.start()
      const answer = askTool!('Bash', { command: 'ls' }, {})
      let settled = false
      void answer.then(() => { settled = true })

      await vi.advanceTimersByTimeAsync(ClaudeSession.PERMISSION_TIMEOUT_MS - 1000)
      expect(settled, '期限前に勝手に答えない').toBe(false)

      await vi.advanceTimersByTimeAsync(2000)
      expect(await answer).toMatchObject({ behavior: 'deny' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('**「人が拒否した」と「誰も答えなかった」を区別する**（次の一手が違う）', async () => {
    vi.useFakeTimers()
    try {
      const { ClaudeSession } = await load()
      const s = new ClaudeSession({ cwd: '/w' })
      await s.start()
      const answer = askTool!('Write', {}, {})
      await vi.advanceTimersByTimeAsync(ClaudeSession.PERMISSION_TIMEOUT_MS + 1000)
      const r = (await answer) as { behavior: string; message: string }
      expect(r.message).toContain('誰も答えませんでした')
      expect(r.message).toContain('拒否されたわけではありません')
    } finally {
      vi.useRealTimers()
    }
  })

  it('期限切れを画面に伝える（出したままの承認札を消すため）', async () => {
    vi.useFakeTimers()
    try {
      const { ClaudeSession } = await load()
      const s = new ClaudeSession({ cwd: '/w' })
      await s.start()
      const expired: string[] = []
      s.on('permissionExpired', (id) => expired.push(id))
      const asked = new Promise<{ id: string }>((r) => s.on('permission', r))
      void askTool!('Write', {}, {})
      const req = await asked
      await vi.advanceTimersByTimeAsync(ClaudeSession.PERMISSION_TIMEOUT_MS + 1000)
      expect(expired).toEqual([req.id])
    } finally {
      vi.useRealTimers()
    }
  })

  it('答えたあとに期限が来ても二度答えない', async () => {
    vi.useFakeTimers()
    try {
      const { ClaudeSession } = await load()
      const s = new ClaudeSession({ cwd: '/w' })
      await s.start()
      const asked = new Promise<{ id: string }>((r) => s.on('permission', r))
      const answer = askTool!('Write', {}, {})
      const req = await asked
      s.respondToPermission(req.id, { behavior: 'allow' })
      const expired: string[] = []
      s.on('permissionExpired', (id) => expired.push(id))
      await vi.advanceTimersByTimeAsync(ClaudeSession.PERMISSION_TIMEOUT_MS + 1000)
      expect(await answer).toMatchObject({ behavior: 'allow' })
      expect(expired).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('知らない id に答えても落ちない', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    expect(() => s.respondToPermission('いない', { behavior: 'allow' })).not.toThrow()
  })
})

describe('操作の受け渡し', () => {
  it('中断・モード・モデル・コマンド一覧を SDK に渡す', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    await s.interrupt()
    await s.setPermissionMode('acceptEdits')
    await s.setModel('haiku')
    expect(await s.slashCommands()).toHaveLength(1)
    expect(calls).toEqual(['interrupt', 'mode:acceptEdits', 'model:haiku'])
  })

  it('起動前は何もしない（落ちない）', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.interrupt()
    await s.setModel()
    expect(await s.slashCommands()).toEqual([])
  })
})

describe('終了（§7）', () => {
  it('**返らない片付けで止まらない。** 孤児が 1 つ残るほうが、終われないアプリよりまし', async () => {
    const { ClaudeSession } = await load()
    hangOnReturn = true
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    const began = Date.now()
    await s.stop()
    expect(Date.now() - began).toBeLessThan(4000)
    expect(calls).toContain('return')
  })

  it('二度止めても落ちない', async () => {
    const { ClaudeSession } = await load()
    const s = new ClaudeSession({ cwd: '/w' })
    await s.start()
    await s.stop()
    await expect(s.stop()).resolves.toBeUndefined()
  })
})

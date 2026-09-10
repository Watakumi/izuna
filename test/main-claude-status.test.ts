import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * Claude Code の状態を集める。`claude` を差し替えて、**鍵を落とした環境で聞いていること**と、
 * email や orgId を画面に持ち出さないことを見る。
 */
let located: string | null = '/opt/claude'
let calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
let answers: Record<string, string | Error> = {}

vi.mock('../src/main/claude/locate', () => ({
  locateClaude: async () => {
    if (!located) throw new Error('無い')
    return located
  },
  loginShellEnv: async () => ({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-leak' })
}))
vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv },
    cb: (e: Error | null, r?: { stdout: string; stderr: string }) => void
  ) => {
    calls.push({ args, env: opts.env })
    const a = answers[args.join(' ')]
    if (a instanceof Error) cb(a)
    else cb(null, { stdout: a ?? '', stderr: '' })
  }
}))

const load = async (): Promise<typeof import('../src/main/claude/status')> =>
  import('../src/main/claude/status')

beforeEach(() => {
  located = '/opt/claude'
  calls = []
  answers = {
    '--version': '2.1.263 (Claude Code)',
    'auth status --json': JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      subscriptionType: 'max',
      email: 'x@example.com',
      orgId: 'org_1'
    })
  }
  vi.resetModules()
})

describe('Claude Code の状態', () => {
  it('場所・版・ログインを返し、**email や orgId は返さない**', async () => {
    const { claudeStatus } = await load()
    const s = await claudeStatus()
    expect(s).toEqual({
      path: '/opt/claude',
      version: '2.1.263',
      loggedIn: true,
      authMethod: 'claude.ai',
      subscription: 'max'
    })
    expect(JSON.stringify(s)).not.toContain('example.com')
  })

  it('環境の鍵を落として聞く（拾うと API キーでログイン済みに見える。§14）', async () => {
    const { claudeStatus } = await load()
    await claudeStatus()
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('無ければ全部 null。auth status が返らなければログインだけ null', async () => {
    const { claudeStatus } = await load()
    located = null
    expect(await claudeStatus()).toEqual({
      path: null,
      version: null,
      loggedIn: null,
      authMethod: null,
      subscription: null
    })
    located = '/opt/claude'
    answers['auth status --json'] = new Error('古い版')
    expect(await claudeStatus()).toMatchObject({
      path: '/opt/claude',
      version: '2.1.263',
      loggedIn: null
    })
  })

  it('--version が返らなくても止まらない。auth status が空なら、分からないものは null', async () => {
    const { claudeStatus } = await load()
    answers['--version'] = new Error('落ちた')
    answers['auth status --json'] = '{}'
    expect(await claudeStatus()).toEqual({
      path: '/opt/claude',
      version: null,
      loggedIn: null,
      authMethod: null,
      subscription: null
    })
    // 版の文字列に番号が無ければ null
    answers['--version'] = 'unknown'
    expect((await claudeStatus()).version).toBeNull()
  })
})

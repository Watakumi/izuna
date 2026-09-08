import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEvent } from '../src/shared/ipc'
import { EMPTY_PROGRESS } from '../src/shared/loop'

/**
 * セッションの駆動部（§28）。
 *
 * `register.ts` にあったときは「登録だけ」の建前で検査から外れていて、
 * ループの駆動・起床の配送・レビュー依頼は誰も検査していなかった。
 * ここでは claude と git と hook の関所を差し替え、**駆動そのもの**を見る。
 * ループと予約は本物を回す（判断は `shared/loop.ts` と `shared/wakeup.ts` にある）。
 */

class FakeSession extends EventEmitter {
  static created: FakeSession[] = []
  static startFails = false
  static stopHangs = false
  sent: Array<{ text: string; images: unknown[]; origin: unknown }> = []
  calls: string[] = []
  answered: Array<[string, unknown]> = []
  constructor(readonly options: Record<string, unknown>) {
    super()
    FakeSession.created.push(this)
  }
  async start(): Promise<void> { if (FakeSession.startFails) throw new Error('起動できません') }
  send(text: string, images: unknown[] = [], origin: unknown = { kind: 'human' }): void {
    this.sent.push({ text, images, origin })
  }
  async slashCommands(): Promise<unknown[]> { this.calls.push('slash'); return [] }
  async interrupt(): Promise<void> { this.calls.push('interrupt') }
  async setPermissionMode(m: string): Promise<void> { this.calls.push(`mode:${m}`) }
  async setModel(m?: string): Promise<void> { this.calls.push(`model:${m}`) }
  respondToPermission(id: string, result: unknown): void { this.answered.push([id, result]) }
  stop(): Promise<void> {
    this.calls.push('stop')
    return FakeSession.stopHangs ? new Promise(() => {}) : Promise.resolve()
  }
}

let home: string
let realHome: string | undefined
let logs: Array<{ dir: string; kind: string; note: string }> = []
let branch: string | null = 'feat/x'
let changed: string[] = ['M a.ts']

vi.mock('../src/main/claude/session', () => ({ ClaudeSession: FakeSession }))
vi.mock('../src/main/claude/trust', () => ({
  gateProjectHooks: async (cwd: string) => {
    if (cwd.includes('evil')) throw new Error('hook があります')
    return ['project', 'local']
  }
}))
vi.mock('../src/main/team', () => ({
  ensureTeam: async (name: string) => {
    const dir = join(home, 'teams', name)
    mkdirSync(dir, { recursive: true })
    return dir
  },
  teamInstructions: (dir: string) => `共有: ${dir}`,
  appendLog: async (dir: string, e: { kind: string; note: string }) => { logs.push({ dir, kind: e.kind, note: e.note }) },
  readBoard: async (dir: string) => ({ dir, tasks: [] }),
  setTaskStatus: async (_dir: string, id: string) => id === 'A-01'
}))
vi.mock('../src/main/git/remote', () => ({
  currentBranch: async () => branch,
  commitContext: async () => ({ changed, branch, recent: [] })
}))

const load = async (): Promise<{
  hub: import('../src/main/hub').SessionHub
  events: SessionEvent[]
  wakeups: import('../src/main/wakeup').Wakeups
}> => {
  const { SessionHub } = await import('../src/main/hub')
  const { Wakeups } = await import('../src/main/wakeup')
  const events: SessionEvent[] = []
  const wakeups = new Wakeups()
  const hub = new SessionHub((e) => events.push(e), wakeups)
  return { hub, events, wakeups }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-hub-'))
  realHome = process.env.HOME
  process.env.HOME = home
  FakeSession.created = []
  FakeSession.startFails = false
  FakeSession.stopHangs = false
  logs = []
  branch = 'feat/x'
  changed = ['M a.ts']
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

const started = async (): Promise<{ hub: import('../src/main/hub').SessionHub; id: string; s: FakeSession; events: SessionEvent[]; wakeups: import('../src/main/wakeup').Wakeups }> => {
  const { hub, events, wakeups } = await load()
  const id = await hub.start({ cwd: '/w/repo', team: 't1' })
  return { hub, id, s: FakeSession.created[0], events, wakeups }
}

describe('起動', () => {
  it('関所を通し、共有フォルダを渡し、記録を書く', async () => {
    const { s, events } = await started()
    expect(s.options.settingSources).toEqual(['project', 'local'])
    expect(s.options.additionalDirectories).toEqual([join(home, 'teams', 't1')])
    expect(String(s.options.appendSystemPrompt)).toContain('共有:')
    expect(s.options.mcpServers).toHaveProperty('izuna')
    expect(logs.map((l) => l.kind)).toEqual(['start'])
    expect(logs[0].note).toBe('新規')
    expect(events).toEqual([])
  })

  it('続きからのときは記録にそう書く', async () => {
    const { hub } = await load()
    await hub.start({ cwd: '/w/repo', resume: 'abc' })
    expect(logs[0].note).toBe('続きから')
  })

  it('**関所で止まれば claude を起こさない**', async () => {
    const { hub } = await load()
    await expect(hub.start({ cwd: '/w/evil' })).rejects.toThrow(/hook/)
    expect(FakeSession.created).toHaveLength(0)
  })

  it('起動に失敗したら記録から外す（後から送れない）', async () => {
    FakeSession.startFails = true
    const { hub } = await load()
    await expect(hub.start({ cwd: '/w/repo' })).rejects.toThrow(/起動できません/)
    expect(() => hub.send('x', 'やあ')).toThrow(/見つかりません/)
  })

  it('claude からの出来事をそのまま画面へ流す', async () => {
    const { id, s, events } = await started()
    s.emit('message', { type: 'assistant' })
    s.emit('permission', { id: 'p1' })
    s.emit('permissionExpired', 'p1')
    s.emit('error', new Error('壊れた'))
    expect(events.map((e) => e.kind)).toEqual(['message', 'permission', 'permissionExpired', 'error'])
    expect(events.every((e) => e.id === id)).toBe(true)
  })

  it('終わったら記録に書き、exit を流し、もう送れない', async () => {
    const { hub, id, s, events } = await started()
    s.emit('done')
    expect(logs.map((l) => l.kind)).toEqual(['start', 'end'])
    expect(events.at(-1)).toEqual({ kind: 'exit', id })
    expect(() => hub.send(id, 'まだ？')).toThrow(/見つかりません/)
  })
})

describe('名前', () => {
  it('通知に出す名前は作業ディレクトリの末尾。終わっても消えない', async () => {
    const { hub, id, s } = await started()
    expect(hub.labelOf(id)).toBe('repo')
    s.emit('done')
    expect(hub.labelOf(id)).toBe('repo')
    expect(hub.labelOf('0123456789')).toBe('01234567')
  })
})

describe('会話の口', () => {
  it('send は画像と出どころをそのまま渡す', async () => {
    const { hub, id, s } = await started()
    hub.send(id, 'やあ', [{ mediaType: 'image/png', data: 'x', name: '' }])
    expect(s.sent[0]).toMatchObject({ text: 'やあ', images: [{ mediaType: 'image/png' }] })
  })

  it('承認の答え・スラッシュ・中断・モード・モデルを通す', async () => {
    const { hub, id, s } = await started()
    hub.respondPermission(id, 'req1', { behavior: 'deny', message: 'だめ' })
    await hub.slashCommands(id)
    await hub.interrupt(id)
    await hub.setPermissionMode(id, 'plan')
    await hub.setModel(id, 'opus')
    expect(s.answered).toEqual([['req1', { behavior: 'deny', message: 'だめ' }]])
    expect(s.calls).toEqual(['slash', 'interrupt', 'mode:plan', 'model:opus'])
  })

  it('無い id には、そう言って落ちる', async () => {
    const { hub } = await load()
    expect(() => hub.send('nope', 'x')).toThrow(/セッションが見つかりません: nope/)
  })
})

describe('止める', () => {
  it('止めたら記録から消え、claude も止める', async () => {
    const { hub, id, s } = await started()
    await hub.stop(id)
    expect(s.calls).toContain('stop')
    expect(() => hub.send(id, 'x')).toThrow(/見つかりません/)
  })

  it('無い id を止めても落ちない', async () => {
    const { hub } = await load()
    await expect(hub.stop('nope')).resolves.toBeUndefined()
  })

  it('**全部止めるのは必ず返る**（返らない claude がいても、上限で諦める）', async () => {
    FakeSession.stopHangs = true
    const { hub } = await started()
    const t0 = Date.now()
    await hub.stopAll(50)
    expect(Date.now() - t0).toBeLessThan(2000)
  })

  it('何も無ければすぐ返る', async () => {
    const { hub } = await load()
    await expect(hub.stopAll(50)).resolves.toBeUndefined()
  })
})

describe('共有フォルダ', () => {
  it('盤面はそのセッションの共有フォルダから読む。無ければ null', async () => {
    const { hub, id } = await started()
    expect(await hub.teamBoard(id)).toMatchObject({ dir: join(home, 'teams', 't1') })
    expect(await hub.teamBoard('nope')).toBeNull()
  })

  it('札の状態を変えたら記録に書く。変えられなければ書かない', async () => {
    const { hub, id } = await started()
    expect(await hub.setTaskStatus(id, 'A-01', 'done')).toBe(true)
    expect(logs.at(-1)).toMatchObject({ kind: 'status', note: 'done' })
    expect(await hub.setTaskStatus(id, 'ZZ', 'done')).toBe(false)
    expect(await hub.setTaskStatus('nope', 'A-01', 'done')).toBe(false)
    expect(logs.filter((l) => l.kind === 'status')).toHaveLength(1)
  })
})

describe('自律ループ（§23）', () => {
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

  it('**反復の依頼は人の打鍵として送らない**。結果が返ると次へ進み、上限で止まる', async () => {
    const { hub, id, s, events } = await started()
    hub.startLoop(id, 2)
    await tick()
    expect(s.sent).toHaveLength(1)
    expect(s.sent[0].origin).toEqual({ kind: 'auto-continuation' })
    s.emit('message', { type: 'result' })
    await tick()
    expect(s.sent).toHaveLength(2)
    s.emit('message', { type: 'result' })
    await tick()
    const stopped = events.find((e) => e.kind === 'loopStopped')
    expect(stopped).toMatchObject({ kind: 'loopStopped', id, stop: { reason: 'maxIterations' } })
    expect(events.filter((e) => e.kind === 'loopProgress')).toHaveLength(2)
    // 終わったので、もう一度回せる
    expect(() => hub.startLoop(id, 1)).not.toThrow()
  })

  it('二重には回さない', async () => {
    const { hub, id } = await started()
    hub.startLoop(id, 3)
    expect(() => hub.startLoop(id, 3)).toThrow(/既にループ/)
  })

  it('人が止めれば、次の反復に入らずに止まる', async () => {
    const { hub, id, s, events } = await started()
    hub.startLoop(id, 5)
    await tick()
    hub.stopLoop(id)
    s.emit('message', { type: 'result' })
    await tick()
    expect(events.find((e) => e.kind === 'loopStopped')).toMatchObject({ stop: { reason: 'stopped' } })
    expect(s.sent).toHaveLength(1)
  })

  it('claude が壊れたら反復は失敗として数える（黙って待ち続けない）', async () => {
    const { hub, id, s } = await started()
    hub.startLoop(id, 5)
    await tick()
    s.emit('error', new Error('落ちた'))
    await tick()
    // 失敗しても即座には諦めない（shared/loop.ts）。ここでは待ち続けていないことだけ見る
    expect(s.sent.length).toBeGreaterThanOrEqual(1)
    hub.stopLoop(id)
  })

  it('進捗はセッションの共有フォルダから読む。無ければ既定', async () => {
    const { hub, id } = await started()
    expect(await hub.loopProgress(id)).toEqual(EMPTY_PROGRESS)
    writeFileSync(join(home, 'teams', 't1', 'progress.json'),
      JSON.stringify({ ...EMPTY_PROGRESS, currentIteration: 3 }))
    expect((await hub.loopProgress(id)).currentIteration).toBe(3)
    expect(await hub.loopProgress('nope')).toEqual(EMPTY_PROGRESS)
  })

  it('無いセッションのループを止めても落ちない', async () => {
    const { hub } = await load()
    expect(() => hub.stopLoop('nope')).not.toThrow()
  })
})

describe('起床の予約', () => {
  it('予約はセッションの作業ディレクトリを覚える', async () => {
    const { hub, id } = await started()
    const w = await hub.addWakeup(id, 30, '続きを')
    expect(w).toMatchObject({ sessionId: id, cwd: '/w/repo', prompt: '続きを', state: 'pending' })
    expect((await hub.listWakeups()).map((x) => x.id)).toEqual([w.id])
    await hub.removeWakeup(w.id)
    expect(await hub.listWakeups()).toEqual([])
  })

  it('**起こすときは人の打鍵として送らない**。画面にも知らせる', async () => {
    const { hub, id, s, events } = await started()
    const w = await hub.addWakeup(id, 30, '続きを')
    await hub.fireWakeup(w.id)
    expect(s.sent[0]).toMatchObject({ text: '続きを', origin: { kind: 'task-notification', subkind: 'scheduled-trigger' } })
    expect(events.at(-1)).toEqual({ kind: 'wokeUp', id, prompt: '続きを' })
  })

  it('もう無いセッションには送らない', async () => {
    const { hub, id, s } = await started()
    const w = await hub.addWakeup(id, 30, '続きを')
    await hub.stop(id)
    await hub.fireWakeup(w.id)
    expect(s.sent).toEqual([])
  })

  it('起動時に予約を読む', async () => {
    const { hub } = await load()
    await expect(hub.open()).resolves.toBeUndefined()
  })
})

describe('会話に頼むもの', () => {
  it('コミット文の下書きは会話に流す。変更が無ければ頼まない', async () => {
    const { hub, id, s } = await started()
    await hub.draftCommitMessage(id)
    expect(s.sent[0].text).toContain('a.ts')
    changed = []
    await expect(hub.draftCommitMessage(id)).rejects.toThrow(/変更がありません/)
  })

  it('レビューは範囲だけ渡す。比べる先が決まらなければ頼まない', async () => {
    const { hub, id, s } = await started()
    await hub.requestReview(id, 'main', 7)
    expect(s.sent[0].text).toContain('PR #7')
    expect(s.sent[0].text).toContain('main...feat/x')
    branch = null
    await expect(hub.requestReview(id, 'main')).rejects.toThrow(/決まりません/)
  })
})

describe('実行役の節目（§12）', () => {
  type Hook = (input: Record<string, unknown>) => Promise<unknown>
  const hooksOf = (s: FakeSession): Record<string, Array<{ hooks: Hook[] }>> =>
    s.options.hooks as Record<string, Array<{ hooks: Hook[] }>>

  it('SubagentStart / SubagentStop / TeammateIdle / Task の hook を張る。**Worktree は張らない**', async () => {
    const { hub } = await load()
    await hub.start({ cwd: '/w' })
    expect(Object.keys(hooksOf(FakeSession.created[0])).sort()).toEqual(
      ['SubagentStart', 'SubagentStop', 'TaskCompleted', 'TaskCreated', 'TeammateIdle']
    )
  })

  it('鳴ったら log.md に書き、画面に流し、**止めない**（空を返す）', async () => {
    const { hub, events } = await load()
    const id = await hub.start({ cwd: '/w' })
    const stop = hooksOf(FakeSession.created[0]).SubagentStop[0].hooks[0]
    const out = await stop({ session_id: 's', transcript_path: '/t', cwd: '/w', hook_event_name: 'SubagentStop',
      stop_hook_active: false, agent_id: 'a9d98cdcaa1a7c6e6', agent_type: 'general-purpose',
      agent_transcript_path: '/x', last_assistant_message: 'Done.' })
    expect(out).toEqual({})
    expect(logs.at(-1)).toMatchObject({ kind: 'stop', note: 'Done.' })
    const ev = events.find((e) => e.kind === 'teammate')
    expect(ev).toMatchObject({ kind: 'teammate', id, event: { kind: 'stop', agent: 'a9d98cdcaa1a7c6e6', note: 'Done.' } })
  })

  it('読めない入力は書かず流さず、それでも空を返す', async () => {
    const { hub, events } = await load()
    await hub.start({ cwd: '/w' })
    const before = logs.length
    const h = hooksOf(FakeSession.created[0]).TeammateIdle[0].hooks[0]
    expect(await h({ session_id: 's', transcript_path: '/t', cwd: '/w', hook_event_name: 'Stop', stop_hook_active: false })).toEqual({})
    expect(logs.length).toBe(before)
    expect(events.some((e) => e.kind === 'teammate')).toBe(false)
  })
})

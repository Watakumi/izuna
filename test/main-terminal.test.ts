import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * worktree のシェル（段6）。
 *
 * **PTY は差し替えるが、渡している引数と後片付けを見る。**
 * ここで壊れると「窓を閉じたのにシェルが残る」「閉じた窓に書き込んで落ちる」
 * といった、後から追いにくい形で出る。
 */

interface Spawned {
  shell: string
  args: string[]
  opts: { cols: number; rows: number; cwd: string; env: Record<string, string>; name: string }
  written: string[]
  resized: Array<[number, number]>
  killed: boolean
  emitData: (s: string) => void
  emitExit: (code: number) => void
}

let spawned: Spawned[] = []

vi.mock('../src/main/claude/locate', () => ({
  loginShellEnv: async () => ({ PATH: '/usr/bin', SHELL: '/bin/fish' })
}))

vi.mock('node-pty', () => {
  return {
    spawn: (shell: string, args: string[], opts: Spawned['opts']) => {
      let onData = (_: string): void => {}
      let onExit = (_: { exitCode: number }): void => {}
      const rec: Spawned = {
        shell,
        args,
        opts,
        written: [],
        resized: [],
        killed: false,
        emitData: (s) => onData(s),
        emitExit: (code) => onExit({ exitCode: code })
      }
      spawned.push(rec)
      return {
        onData: (f: (s: string) => void) => {
          onData = f
        },
        onExit: (f: (e: { exitCode: number }) => void) => {
          onExit = f
        },
        write: (s: string) => rec.written.push(s),
        resize: (c: number, r: number) => rec.resized.push([c, r]),
        kill: () => {
          rec.killed = true
        }
      }
    }
  }
})

/** 画面。閉じたあとに書き込まれていないかを見る */
let sent: Array<{
  channel: string
  payload: { id: string; kind: string; data?: string; code?: number }
}> = []
let destroyed = false
const win = {
  isDestroyed: () => destroyed,
  webContents: { send: (channel: string, payload: never) => sent.push({ channel, payload }) }
} as never

const load = async (): Promise<typeof import('../src/main/terminal')> =>
  import('../src/main/terminal')

beforeEach(() => {
  spawned = []
  sent = []
  destroyed = false
  vi.resetModules()
})

describe('開く', () => {
  it('ログインシェルを対話で起こし、大きさと場所を渡す', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 100, rows: 30 })
    expect(spawned[0].shell).toBe('/bin/fish')
    expect(spawned[0].args).toEqual(['-l'])
    expect(spawned[0].opts).toMatchObject({
      cols: 100,
      rows: 30,
      cwd: '/w',
      name: 'xterm-256color'
    })
    expect(spawned[0].opts.env.PATH).toBe('/usr/bin')
  })

  it('**小さすぎる大きさで起こさない**（0 行 0 桁だと表示が壊れる）', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 0, rows: 0 })
    expect(spawned[0].opts.cols).toBeGreaterThanOrEqual(20)
    expect(spawned[0].opts.rows).toBeGreaterThanOrEqual(5)
  })

  it('場所が空なら家で開く（存在しない場所で spawn すると落ちる）', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => win, 'ch', { cwd: '', cols: 80, rows: 24 })
    expect(spawned[0].opts.cwd).not.toBe('')
  })

  it('シェルを指定できる', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24, shell: '/bin/bash' })
    expect(spawned[0].shell).toBe('/bin/bash')
  })

  it('別々の id を返す', async () => {
    const { openTerminal } = await load()
    const a = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    const b = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    expect(a).not.toBe(b)
  })
})

describe('やりとり', () => {
  it('出力を画面へ、id を添えて送る', async () => {
    const { openTerminal } = await load()
    const id = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    spawned[0].emitData('こんにちは')
    expect(sent[0]).toMatchObject({
      channel: 'ch',
      payload: { id, kind: 'data', data: 'こんにちは' }
    })
  })

  it('打鍵を渡し、大きさを合わせる', async () => {
    const { openTerminal, writeTerminal, resizeTerminal } = await load()
    const id = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    writeTerminal(id, 'ls\n')
    resizeTerminal(id, 120, 40)
    expect(spawned[0].written).toEqual(['ls\n'])
    expect(spawned[0].resized).toEqual([[120, 40]])
  })

  it('知らない id に書いても落ちない（閉じた直後の打鍵が届く）', async () => {
    const { writeTerminal, resizeTerminal, closeTerminal } = await load()
    expect(() => writeTerminal('いない', 'x')).not.toThrow()
    expect(() => resizeTerminal('いない', 80, 24)).not.toThrow()
    expect(() => closeTerminal('いない')).not.toThrow()
  })

  it('**閉じた窓に書き込まない**（落ちる）', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    destroyed = true
    spawned[0].emitData('あとから来た')
    expect(sent).toHaveLength(0)
  })

  it('窓が無くなっていても落ちない', async () => {
    const { openTerminal } = await load()
    await openTerminal(() => null, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    expect(() => spawned[0].emitData('x')).not.toThrow()
  })
})

describe('閉じる', () => {
  it('終了を画面に伝え、控えから外す', async () => {
    const { openTerminal, writeTerminal } = await load()
    const id = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    spawned[0].emitExit(0)
    expect(sent.at(-1)).toMatchObject({ payload: { id, kind: 'exit', code: 0 } })
    // 外れているので、あとから書いても届かない
    writeTerminal(id, 'x')
    expect(spawned[0].written).toEqual([])
  })

  it('閉じるとシェルも終わる', async () => {
    const { openTerminal, closeTerminal } = await load()
    const id = await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    closeTerminal(id)
    expect(spawned[0].killed).toBe(true)
  })

  it('**まとめて閉じる**（終了時に取り残すと、シェルだけ生き残る）', async () => {
    const { openTerminal, closeAllTerminals } = await load()
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    await openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })
    closeAllTerminals()
    expect(spawned.every((s) => s.killed)).toBe(true)
  })
})

describe('PTY が読めないとき', () => {
  it('**アプリは落とさず、直し方を言う**', async () => {
    // 模造の工場は一度しか走らないので、この検査だけ差し替え直す
    vi.resetModules()
    vi.doMock('node-pty', () => {
      throw new Error('ネイティブモジュールが無い')
    })
    const { openTerminal } = await import('../src/main/terminal')
    await expect(openTerminal(() => win, 'ch', { cwd: '/w', cols: 80, rows: 24 })).rejects.toThrow(
      /pnpm install/
    )
  })
})

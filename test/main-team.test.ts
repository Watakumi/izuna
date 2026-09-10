import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 共有フォルダの盤面に対する門（§16 / §24）。
 *
 * `shared/team.ts` のパースは `test/team.test.ts` が見ている。
 * ここが見るのは**その純粋関数を誰が呼ぶか**である ——
 * 呼ぶ側が無いと、パースがどれだけ正しくても盤面は動かない。
 * これが `SafePathValidator` の形（§24）で、それを塞ぐのがここ。
 */

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-team-'))
  vi.resetModules()
  vi.doMock('node:os', async () => ({
    ...(await vi.importActual<typeof import('node:os')>('node:os')),
    homedir: () => home
  }))
})
afterEach(() => {
  vi.doUnmock('node:os')
  rmSync(home, { recursive: true, force: true })
})

const load = async (): Promise<typeof import('../src/main/team')> =>
  await import('../src/main/team')

const taskFile = (over: Record<string, unknown>): string => {
  const d = {
    id: 'A-01',
    title: 'やる',
    status: 'doing',
    paths: [],
    depends_on: [],
    updated: '2026-09-08T00:00:00Z',
    ...over
  }
  const yaml = Object.entries(d)
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${k}:\n${v.map((x) => `  - ${String(x)}`).join('\n') || '  []'}`
        : `${k}: ${String(v)}`
    )
    .join('\n')
  return `---\n${yaml}\n---\n\n本文\n`
}

describe('盤面を読む', () => {
  it('札・要約・決定・記録をまとめて返す', async () => {
    const { ensureTeam, readBoard } = await load()
    const dir = await ensureTeam('t', '狙いはこう')
    writeFileSync(join(dir, 'tasks', '01-a.md'), taskFile({ id: 'A-01', paths: ['src/x.ts'] }))
    writeFileSync(
      join(dir, 'summaries', 'A-01.md'),
      '---\ntask: A-01\nby: exec-1\nat: 2026-09-08T01:00:00Z\noutcome: partial\n---\n\nやった\n'
    )
    writeFileSync(
      join(dir, 'decisions.md'),
      '# 決めたこと\n\n## 2026-09-08T01:00:00Z · A-01 · brain\n\n先に読む側を通す\n'
    )

    const board = await readBoard(dir)
    expect(board.tasks.map((t) => t.id)).toEqual(['A-01'])
    expect(board.brief.body).toContain('狙いはこう')
    expect(board.summaries[0].by).toBe('exec-1')
    expect(board.decisions[0].target).toBe('A-01')
    expect(board.errors).toEqual([])
  })

  /**
   * **重なりを見つけるのが盤面の本題**（§16）。
   * これが動かないなら、盤面を出す意味が無い。
   */
  it('paths が重なる札を、同時に走らせてはいけない組として返す', async () => {
    const { ensureTeam, readBoard } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({ id: 'A-01', paths: ['src/x.ts'] }))
    writeFileSync(join(dir, 'tasks', '02.md'), taskFile({ id: 'A-02', paths: ['src/x.ts'] }))

    const board = await readBoard(dir)
    expect(board.collisions).toHaveLength(1)
    expect(board.collisions[0].paths).toEqual(['src/x.ts'])
  })

  it('依存が満たされた未着手を ready に出す', async () => {
    const { ensureTeam, readBoard } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({ id: 'A-01', status: 'done' }))
    writeFileSync(
      join(dir, 'tasks', '02.md'),
      taskFile({ id: 'A-02', status: 'todo', depends_on: ['A-01'] })
    )
    writeFileSync(
      join(dir, 'tasks', '03.md'),
      taskFile({ id: 'A-03', status: 'todo', depends_on: ['A-02'] })
    )

    const board = await readBoard(dir)
    expect(board.ready.map((t) => t.id)).toEqual(['A-02'])
  })

  /**
   * **壊れた札を黙って落とさない。** 落とすと、書いた本人には
   * 「書いたのに出てこない」としか分からない。
   */
  it('読めない札は消さずに errors に出す', async () => {
    const { ensureTeam, readBoard } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), '---\ntitle: id がない\n---\n')
    const board = await readBoard(dir)
    expect(board.tasks).toEqual([])
    expect(board.errors[0]).toContain('tasks/01.md')
  })

  it('要約が読めなくても札は返す', async () => {
    const { ensureTeam, readBoard } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({}))
    writeFileSync(join(dir, 'summaries', 'x.md'), '---\nby: exec\n---\n')
    const board = await readBoard(dir)
    expect(board.tasks).toHaveLength(1)
    expect(board.errors[0]).toContain('summaries/x.md')
  })

  it('フォルダが無くても落ちない（まだ何も始めていないだけ）', async () => {
    const { readBoard } = await load()
    const board = await readBoard(join(home, 'ない'))
    expect(board.tasks).toEqual([])
    expect(board.collisions).toEqual([])
    expect(board.brief.body).toBe('')
  })
})

describe('log.md は Izuna が書く', () => {
  it('追記であって、書き換えではない', async () => {
    const { ensureTeam, appendLog } = await load()
    const dir = await ensureTeam('t')
    const before = readFileSync(join(dir, 'log.md'), 'utf8')
    await appendLog(dir, {
      at: '2026-09-08T01:00:00Z',
      from: 'izuna',
      to: 'brain',
      kind: 'start',
      target: '/w',
      note: '新規'
    })
    await appendLog(dir, {
      at: '2026-09-08T02:00:00Z',
      from: 'izuna',
      to: 'brain',
      kind: 'end',
      target: '/w',
      note: '終了'
    })

    const after = readFileSync(join(dir, 'log.md'), 'utf8')
    expect(after.startsWith(before)).toBe(true)
    expect(after).toContain('start')
    expect(after).toContain('end')
  })

  it('タブ区切りで書く（§16 の形）', async () => {
    const { ensureTeam, appendLog, readBoard } = await load()
    const dir = await ensureTeam('t')
    await appendLog(dir, {
      at: '2026-09-08T01:00:00Z',
      from: 'izuna',
      to: 'brain',
      kind: 'start',
      target: '/w',
      note: '新規'
    })
    const board = await readBoard(dir)
    expect(board.log).toHaveLength(1)
    expect(board.log[0].kind).toBe('start')
  })

  it('フォルダが無ければ作ってから書く', async () => {
    const { appendLog } = await load()
    const dir = join(home, 'まだない')
    await appendLog(dir, {
      at: '2026-09-08T01:00:00Z',
      from: 'izuna',
      to: 'x',
      kind: 'start',
      target: '/w',
      note: ''
    })
    expect(existsSync(join(dir, 'log.md'))).toBe(true)
  })
})

describe('札の状態を書き換える', () => {
  it('状態と updated だけ変え、本文は残す', async () => {
    const { ensureTeam, setTaskStatus, readBoard } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({ id: 'A-01', status: 'todo' }))

    expect(await setTaskStatus(dir, 'A-01', 'doing')).toBe(true)
    const board = await readBoard(dir)
    expect(board.tasks[0].status).toBe('doing')
    expect(board.tasks[0].body).toContain('本文')
    expect(board.tasks[0].updated).not.toBe('2026-09-08T00:00:00Z')
  })

  it('無い id には false を返す（黙って作らない）', async () => {
    const { ensureTeam, setTaskStatus } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({ id: 'A-01' }))
    expect(await setTaskStatus(dir, 'B-99', 'done')).toBe(false)
  })

  it('読めない札は飛ばす', async () => {
    const { ensureTeam, setTaskStatus } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'tasks', '00.md'), '---\ntitle: id がない\n---\n')
    writeFileSync(join(dir, 'tasks', '01.md'), taskFile({ id: 'A-01' }))
    expect(await setTaskStatus(dir, 'A-01', 'done')).toBe(true)
  })
})

describe('共有フォルダを用意する', () => {
  it('既にあるものは触らない（追記のみの規律を壊さない）', async () => {
    const { ensureTeam } = await load()
    const dir = await ensureTeam('t')
    writeFileSync(join(dir, 'decisions.md'), '# 決めたこと\n\n書いた\n')
    await ensureTeam('t')
    expect(readFileSync(join(dir, 'decisions.md'), 'utf8')).toContain('書いた')
  })

  it('名前が空でも置き場所を決める', async () => {
    const { teamPathFor, TEAMS_BASE } = await load()
    expect(teamPathFor('')).toBe(join(TEAMS_BASE, 'team'))
  })
})

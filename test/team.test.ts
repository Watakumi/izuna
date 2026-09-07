import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatLogEntry,
  parseBrief,
  parseDecisions,
  parseLog,
  parseSummary,
  parseTask,
  pathCollisions,
  readyTasks,
  serializeTask,
  type Task
} from '../src/shared/team'

/**
 * 共有フォルダの形に対する門。
 *
 * **雛形そのものを仕様として扱う。** 散文で決めた形は守られないが、
 * `templates/team/` が読めなくなったら赤くなるなら守られる。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const T = join(ROOT, 'templates', 'team')
const read = (...p: string[]): string => readFileSync(join(T, ...p), 'utf8')

const task = (over: Partial<Task>): Task => ({
  id: '01', title: 't', assignee: null, branch: null, status: 'todo',
  depends_on: [], paths: [], updated: '', body: '', ...over
})

describe('雛形が仕様どおりに読める', () => {
  it('brief.md', () => {
    const b = parseBrief(read('brief.md'))
    expect(b.issue).toBe('Watakumi/izuna#12')
    expect(b.body).toContain('## 受け入れ条件')
    // 触らない範囲は並列の衝突を防ぐ要なので、雛形から消さない
    expect(b.body).toContain('## 触らない範囲')
  })

  it('tasks/ が全部読める', () => {
    const files = readdirSync(join(T, 'tasks')).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      const r = parseTask(read('tasks', f))
      expect(r.ok, r.ok ? '' : `${f}: ${r.error}`).toBe(true)
    }
  })

  it('summaries/ が全部読める。判断が要る点を持っている', () => {
    const files = readdirSync(join(T, 'summaries')).filter((f) => f.endsWith('.md'))
    for (const f of files) {
      const r = parseSummary(read('summaries', f))
      expect(r.ok, r.ok ? '' : `${f}: ${r.error}`).toBe(true)
      // ブレインが読むべき箇所。これが無いと反省ループが回らない
      if (r.ok) expect(r.value.body).toContain('## 判断が要る点')
    }
  })

  it('decisions.md', () => {
    const ds = parseDecisions(read('decisions.md'))
    expect(ds).toHaveLength(1)
    expect(ds[0].target).toBe('01')
    expect(ds[0].by).toBe('brain')
  })

  it('log.md', () => {
    const es = parseLog(read('log.md'))
    expect(es).toHaveLength(6)
    expect(es[0]).toMatchObject({ from: 'brain', to: 'A', kind: 'instruct', target: '01' })
    expect(es.at(-1)).toMatchObject({ from: 'A', to: 'human', kind: 'approval' })
  })
})

describe('パースの端', () => {
  it('status が不正なら落とす（黙って todo にしない）', () => {
    const r = parseTask('---\nid: "9"\ntitle: x\nstatus: wip\n---\n')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('wip')
  })

  it('id か title が無ければ落とす', () => {
    expect(parseTask('---\ntitle: x\n---\n').ok).toBe(false)
    expect(parseTask('---\nid: "1"\n---\n').ok).toBe(false)
  })

  it('frontmatter が無い本文も読める', () => {
    const b = parseBrief('# ただの見出し\n')
    expect(b.issue).toBeNull()
    expect(b.body).toBe('# ただの見出し')
  })

  it('task は書いて読み直しても同じ', () => {
    const before = parseTask(read('tasks', '01-virtualize.md'))
    expect(before.ok).toBe(true)
    if (!before.ok) return
    const after = parseTask(serializeTask(before.value))
    expect(after.ok).toBe(true)
    if (after.ok) expect(after.value).toEqual(before.value)
  })

  it('log の行は書いて読み直しても同じ', () => {
    const e = { at: '2026-09-07T15:02:11+09:00', from: 'brain', to: 'A', kind: 'instruct', target: '01', note: 'x' }
    expect(parseLog(formatLogEntry(e))).toEqual([e])
  })
})

describe('並列させてよいかの判定', () => {
  it('走っている 2 つが同じパスを触るなら衝突として挙げる', () => {
    const c = pathCollisions([
      task({ id: '01', status: 'doing', paths: ['a.ts', 'b.ts'] }),
      task({ id: '02', status: 'idle', paths: ['b.ts'] })
    ])
    expect(c).toEqual([{ a: '01', b: '02', paths: ['b.ts'] }])
  })

  it('触るパスが分かれていれば衝突しない', () => {
    expect(pathCollisions([
      task({ id: '01', status: 'doing', paths: ['a.ts'] }),
      task({ id: '02', status: 'doing', paths: ['b.ts'] })
    ])).toEqual([])
  })

  it('走っていないものは衝突に数えない', () => {
    // todo と done は誰も触っていないので、重なっていても問題にならない
    expect(pathCollisions([
      task({ id: '01', status: 'todo', paths: ['a.ts'] }),
      task({ id: '02', status: 'done', paths: ['a.ts'] })
    ])).toEqual([])
  })

  it('雛形の 2 件は同時に走らせてよい', () => {
    const tasks = readdirSync(join(T, 'tasks'))
      .filter((f) => f.endsWith('.md'))
      .map((f) => parseTask(read('tasks', f)))
      .flatMap((r) => (r.ok ? [r.value] : []))
    expect(pathCollisions(tasks)).toEqual([])
  })
})

describe('次に着手できるもの', () => {
  it('依存が終わっていないものは出さない', () => {
    const ts = [
      task({ id: '01', status: 'doing' }),
      task({ id: '02', status: 'todo', depends_on: ['01'] }),
      task({ id: '03', status: 'todo' })
    ]
    expect(readyTasks(ts).map((t) => t.id)).toEqual(['03'])
  })

  it('依存が終わっていれば出す', () => {
    const ts = [
      task({ id: '01', status: 'done' }),
      task({ id: '02', status: 'todo', depends_on: ['01'] })
    ]
    expect(readyTasks(ts).map((t) => t.id)).toEqual(['02'])
  })
})

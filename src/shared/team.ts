import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * 共有フォルダ `~/.izuna/teams/<team>/` の読み書き。
 *
 * ブレインと実行役はコンテキストの窓を共有しない（CLAUDE.md §12）。
 * 共有されるのはこのフォルダだけで、**圧縮を跨いで残るのもここだけ**。
 * だから形を決めて、検査できるようにしてある。
 *
 * **1 ファイル 1 書き手**が要である。同じファイルを 2 者が書くと、
 * ロックなしでは必ず壊れる。
 *
 *   brief.md        ブレイン
 *   tasks/NN-*.md   ブレイン
 *   summaries/*.md  その実行役だけ
 *   decisions.md    ブレイン（追記のみ）
 *   log.md          Izuna（エージェントは書かない・追記のみ）
 *
 * ここはプロセスを知らない純粋関数に保つ。ファイル入出力は main 側の役目。
 */

export const TASK_STATUS = ['todo', 'doing', 'idle', 'done', 'blocked'] as const
export type TaskStatus = (typeof TASK_STATUS)[number]

/** `idle` は「実行役が手を止めた」= ブレインが読む番、を意味する */
export interface Task {
  id: string
  title: string
  /** 実行役の名前。未割り当ては null */
  assignee: string | null
  branch: string | null
  status: TaskStatus
  /** 先に終わっている必要のある task id */
  depends_on: string[]
  /** この作業が触ってよいパス。並列の衝突判定に使う */
  paths: string[]
  updated: string
  body: string
}

export interface Brief {
  issue: string | null
  created: string | null
  body: string
}

export const OUTCOMES = ['done', 'partial', 'blocked'] as const
export type Outcome = (typeof OUTCOMES)[number]

export interface Summary {
  task: string
  by: string
  at: string
  outcome: Outcome
  body: string
}

export interface Decision {
  at: string
  /** 対象の task id。全体に関わるものは null */
  target: string | null
  by: string
  body: string
}

export interface LogEntry {
  at: string
  from: string
  to: string
  kind: string
  target: string
  note: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** `---` で挟んだ frontmatter を切り出す。無ければ frontmatter 空で本文だけ返す */
export function splitFrontmatter(src: string): { data: Record<string, unknown>; body: string } {
  const text = src.replace(/^﻿/, '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { data: {}, body: text.trim() }
  const data = (parseYaml(m[1]) ?? {}) as Record<string, unknown>
  return { data, body: text.slice(m[0].length).trim() }
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.flatMap((x) => (str(x) === null ? [] : [str(x) as string])) : []
}

export function parseTask(src: string): ParseResult<Task> {
  const { data, body } = splitFrontmatter(src)
  const id = str(data.id)
  const title = str(data.title)
  if (!id) return { ok: false, error: 'task に id がない' }
  if (!title) return { ok: false, error: `task ${id} に title がない` }
  const status = str(data.status) ?? 'todo'
  if (!(TASK_STATUS as readonly string[]).includes(status)) {
    return { ok: false, error: `task ${id} の status が不正: ${status}（${TASK_STATUS.join(' / ')}）` }
  }
  return {
    ok: true,
    value: {
      id,
      title,
      assignee: str(data.assignee),
      branch: str(data.branch),
      status: status as TaskStatus,
      depends_on: strList(data.depends_on),
      paths: strList(data.paths),
      updated: str(data.updated) ?? '',
      body
    }
  }
}

export function serializeTask(task: Task): string {
  const { body, ...front } = task
  return `---\n${stringifyYaml(front).trimEnd()}\n---\n\n${body}\n`
}

export function parseBrief(src: string): Brief {
  const { data, body } = splitFrontmatter(src)
  return { issue: str(data.issue), created: str(data.created), body }
}

export function parseSummary(src: string): ParseResult<Summary> {
  const { data, body } = splitFrontmatter(src)
  const task = str(data.task)
  const by = str(data.by)
  if (!task) return { ok: false, error: 'summary に task がない' }
  if (!by) return { ok: false, error: `summary(task ${task}) に by がない` }
  const outcome = str(data.outcome) ?? 'partial'
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: false, error: `summary(task ${task}) の outcome が不正: ${outcome}` }
  }
  return {
    ok: true,
    value: { task, by, at: str(data.at) ?? '', outcome: outcome as Outcome, body }
  }
}

/**
 * `## <ISO8601> · <対象> · <誰>` を見出しにした追記の並びを読む。
 * 見出しに合わない塊は落とさず捨てる —— 落とすと「無かったこと」になるので、
 * 呼び出し側が件数を突き合わせられるよう、見つかった分だけ返す。
 */
export function parseDecisions(src: string): Decision[] {
  const out: Decision[] = []
  const re = /^##\s+(\S+)\s+·\s+(\S+)\s+·\s+(\S+)\s*$/gm
  const heads: Array<{ at: string; target: string; by: string; start: number; end: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    heads.push({ at: m[1], target: m[2], by: m[3], start: m.index, end: re.lastIndex })
  }
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]
    const body = src.slice(h.end, heads[i + 1]?.start ?? src.length).trim()
    out.push({ at: h.at, target: h.target === '-' ? null : h.target, by: h.by, body })
  }
  return out
}

/** タブ区切り 1 行 1 件。`#` で始まる行と空行は読み飛ばす */
export function parseLog(src: string): LogEntry[] {
  const out: LogEntry[] = []
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('`')) continue
    const cols = line.split('\t')
    if (cols.length < 4) continue
    const [at, arrow, kind, target, note] = cols
    const [from, to] = arrow.split('→')
    if (!from || !to) continue
    out.push({ at, from, to, kind, target: target ?? '', note: note ?? '' })
  }
  return out
}

export function formatLogEntry(e: LogEntry): string {
  return [e.at, `${e.from}→${e.to}`, e.kind, e.target, e.note].join('\t')
}

/**
 * 同時に走らせてよいかを見る。
 *
 * **並列で最も壊れるのは、2 つの実行役が同じファイルを触ること。**
 * `paths` が重なる task を同時に `doing` にしてはいけない。
 * ここは実行前に必ず通す。
 */
export function pathCollisions(tasks: Task[]): Array<{ a: string; b: string; paths: string[] }> {
  const live = tasks.filter((t) => t.status === 'doing' || t.status === 'idle')
  const out: Array<{ a: string; b: string; paths: string[] }> = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const shared = live[i].paths.filter((p) => live[j].paths.includes(p))
      if (shared.length) out.push({ a: live[i].id, b: live[j].id, paths: shared })
    }
  }
  return out
}

/** 依存が満たされていて、まだ着手していないもの */
export function readyTasks(tasks: Task[]): Task[] {
  const done = new Set(tasks.filter((t) => t.status === 'done').map((t) => t.id))
  return tasks.filter((t) => t.status === 'todo' && t.depends_on.every((d) => done.has(d)))
}

import type { Transcript, Block, TaskRun } from './transcript'

/**
 * このセッションでエージェントが触ったファイル。
 *
 * **保存層は要らない。** 触ったことは会話そのものに書いてある ——
 * ツール呼び出しの入力に `file_path` が入っている。
 * 別に記録を持つと、会話と食い違ったときにどちらが正しいのか誰も言えなくなる。
 *
 * 実行役（サブエージェント）が触った分も混ぜる。**混ぜたことは隠さない** ——
 * 誰が触ったかは `by` に出す。人が差分を見る前に知りたいのは
 * 「何が変わったか」であって、「誰の担当だったか」はその次だからである。
 */
export interface Touched {
  path: string
  /** 読んだ回数 */
  read: number
  /** 書いた回数。0 なら読んだだけ */
  wrote: number
  /** 触ったのは誰か。ブレイン本人なら空 */
  by: string[]
}

/** ファイルを読むツール。名前は Claude Code の実測 */
const READERS = new Set(['Read', 'NotebookRead'])
/** ファイルを書き換えるツール */
const WRITERS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

/** ツール入力からパスを取り出す。**形が違えば黙って諦める**（推測で埋めない） */
function pathOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const o = input as Record<string, unknown>
  for (const key of ['file_path', 'notebook_path', 'path']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return null
}

function collect(blocks: Block[], by: string | null, into: Map<string, Touched>): void {
  for (const b of blocks) {
    if (b.kind !== 'tool') continue
    const reads = READERS.has(b.name)
    const writes = WRITERS.has(b.name)
    if (!reads && !writes) continue
    // **拒否された呼び出しは触っていない。** 出すと「変えた」と読まれる
    if (b.state === 'denied') continue
    const path = pathOf(b.input)
    if (path === null) continue

    const cur = into.get(path) ?? { path, read: 0, wrote: 0, by: [] }
    if (reads) cur.read += 1
    if (writes) cur.wrote += 1
    if (by !== null && !cur.by.includes(by)) cur.by.push(by)
    into.set(path, cur)
  }
}

/**
 * 書いたものを先に、次に読んだだけのものを、それぞれパス順で返す。
 * **書いたものを上に置く** —— 人がここを開くのは、
 * 何が変わったのかを確かめるためだからである。
 */
export function touchedFiles(t: Transcript, tasks: TaskRun[] = []): Touched[] {
  const into = new Map<string, Touched>()
  for (const item of t.items) {
    if (item.kind === 'assistant') collect(item.blocks, null, into)
  }
  for (const task of tasks) collect(task.blocks, task.subagentType ?? task.description, into)

  return [...into.values()].sort((a, b) =>
    a.wrote > 0 !== b.wrote > 0
      ? (b.wrote > 0 ? 1 : 0) - (a.wrote > 0 ? 1 : 0)
      : a.path.localeCompare(b.path))
}

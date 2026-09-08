import type { DiffLine, FileDiff } from './diff'

/**
 * unified diff を読む（docs/NIMBALYST.md §7 の 3）。
 *
 * Forgejo の `GET /repos/{owner}/{repo}/pulls/{index}.diff` は PR 全体を
 * 1 つの unified diff で返す。`shared/diff.ts` の `FileDiff` に変えれば、
 * 承認で使っている `DiffView` がそのまま描ける。
 *
 * **完全な parser は目指さない。** 見るのは `diff --git`、`---` / `+++`、`@@` と
 * 各行の頭 1 文字だけ。バイナリと改名は「そのファイルがある」ことだけ出す。
 * 純粋関数。
 */
export function parseUnifiedDiff(text: string): FileDiff[] {
  const out: FileDiff[] = []
  let cur: FileDiff | null = null
  let before = 0
  let after = 0

  const flush = (): void => {
    if (cur) out.push(cur)
    cur = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)
    if (head) {
      flush()
      cur = { path: head[2], lines: [], added: 0, removed: 0, whole: false }
      continue
    }
    if (!cur) continue
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      // `--- /dev/null` は新規（全文）
      if (line === '--- /dev/null') cur.whole = true
      continue
    }
    if (line.startsWith('Binary files')) {
      cur.lines.push({ kind: 'same', text: '（バイナリ）', before: null, after: null })
      continue
    }
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      before = Number(hunk[1])
      after = Number(hunk[2])
      continue
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line === '\\ No newline at end of file'
    ) {
      continue
    }
    const mark = line[0]
    const body = line.slice(1)
    let entry: DiffLine
    if (mark === '+') {
      entry = { kind: 'add', text: body, before: null, after: after++ }
      cur.added++
    } else if (mark === '-') {
      entry = { kind: 'del', text: body, before: before++, after: null }
      cur.removed++
    } else if (mark === ' ') {
      entry = { kind: 'same', text: body, before: before++, after: after++ }
    } else {
      continue // 空行や知らない行は飛ばす。落として壊すより、読めた分を出す
    }
    cur.lines.push(entry)
  }
  flush()
  return out
}

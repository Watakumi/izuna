/**
 * ツールの入力から差分を起こす。
 *
 * ファイルシステムは読まない。**エージェントが「こうする」と宣言した内容**を
 * そのまま見せる。承認で人間が見るべきなのは実行前の宣言であって、
 * 実行後の結果ではないため。
 *
 * 純粋関数（プロセスを知らない。§4 の原則）。
 */

export type DiffKind = 'add' | 'del' | 'same'
export interface DiffLine {
  kind: DiffKind
  text: string
  /** 変更前の行番号。追加行では null */
  before: number | null
  /** 変更後の行番号。削除行では null */
  after: number | null
}

export interface FileDiff {
  path: string
  lines: DiffLine[]
  added: number
  removed: number
  /** 全文置き換えなのか、一部の差し替えなのか */
  whole: boolean
}

const splitLines = (s: string): string[] => (s === '' ? [] : s.replace(/\n$/, '').split('\n'))

/** 行単位の最長共通部分列。短い差し替えを読みやすく並べるためだけのもの */
function lcs(a: string[], b: string[]): DiffLine[] {
  const n = a.length
  const m = b.length
  // 素朴な DP。承認で見るのは 1 回の Edit なので、この規模で足りる
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], before: i + 1, after: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i], before: i + 1, after: null })
      i++
    } else {
      out.push({ kind: 'add', text: b[j], before: null, after: j + 1 })
      j++
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i], before: ++i, after: null })
  while (j < m) out.push({ kind: 'add', text: b[j], before: null, after: ++j })
  return out
}

function count(lines: DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length
  }
}

type Input = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)

/**
 * 差分を出せるツールなら FileDiff を、そうでなければ null を返す。
 * null は「差分の無いツール」であって失敗ではない（Bash や Read など）。
 */
export function diffFromToolInput(name: string, rawInput: unknown): FileDiff | null {
  if (!rawInput || typeof rawInput !== 'object') return null
  const input = rawInput as Input
  const path = str(input.file_path) ?? str(input.path) ?? ''
  if (!path) return null

  if (name === 'Write') {
    const content = str(input.content) ?? ''
    const lines: DiffLine[] = splitLines(content).map((text, i) => ({
      kind: 'add',
      text,
      before: null,
      after: i + 1
    }))
    return { path, lines, ...count(lines), whole: true }
  }

  if (name === 'Edit') {
    const before = str(input.old_string) ?? ''
    const after = str(input.new_string) ?? ''
    const lines = lcs(splitLines(before), splitLines(after))
    return { path, lines, ...count(lines), whole: false }
  }

  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    const lines: DiffLine[] = []
    for (const raw of input.edits as Input[]) {
      const chunk = lcs(
        splitLines(str(raw.old_string) ?? ''),
        splitLines(str(raw.new_string) ?? '')
      )
      // 塊のあいだに区切りを入れる。連続した 1 つの差分に見せない
      if (lines.length && chunk.length)
        lines.push({ kind: 'same', text: '⋯', before: null, after: null })
      lines.push(...chunk)
    }
    return { path, lines, ...count(lines), whole: false }
  }

  return null
}

/** 承認バーに出す一行。差分が無いツールでも何かは言う */
export function describeToolInput(name: string, rawInput: unknown): string {
  const d = diffFromToolInput(name, rawInput)
  if (d) return `${d.path}  +${d.added} −${d.removed}`
  if (rawInput && typeof rawInput === 'object') {
    const input = rawInput as Input
    const first =
      str(input.command) ??
      str(input.pattern) ??
      str(input.path) ??
      str(input.file_path) ??
      str(input.url)
    if (first) return first.length > 160 ? first.slice(0, 160) + '…' : first
  }
  return name
}

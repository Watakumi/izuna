/**
 * **外の世界に出た操作の記録**（§38。Issue #46、物語 S-17）。
 *
 * 会話の中の一手は `~/.claude/projects/` に残る（§18）ので、Izuna は持たない。
 * 残っていないのは**その外側** —— push、PR を作る・閉じる、ブランチと sandbox を消す、
 * worktree を消す、そして**人が許可したか拒否したか**である。どれも画面には
 * `Result` が 1 行出るだけで、閉じれば消える。
 *
 * **保存層ではない**（規則 2）。会話にあるものを複製しない。ここにしか無いものだけを、
 * 1 件 1 行の追記で残す。読むのは人で、機械は判断に使わない。
 *
 * 純粋関数（プロセスを知らない。§4 の原則）。
 */

/** 記録する操作。**足すときはここに足す** —— 画面の言葉もここから引く */
export const ACTION_KINDS = [
  'push',
  'create-pull',
  'close-pull',
  'delete-branch',
  'create-repo',
  'delete-repo',
  'add-remote',
  'remove-worktree',
  'allow',
  'deny'
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/** 画面に出す言葉。比喩を使わない（§17.4） */
export const ACTION_LABEL: Record<ActionKind, string> = {
  push: 'push',
  'create-pull': 'PR を作る',
  'close-pull': 'PR を閉じる',
  'delete-branch': 'ブランチを消す',
  'create-repo': 'sandbox を作る',
  'delete-repo': 'sandbox を消す',
  'add-remote': 'remote を足す',
  'remove-worktree': 'worktree を消す',
  allow: '許可した',
  deny: '拒否した'
}

export interface Action {
  /** ISO8601 */
  at: string
  kind: ActionKind
  /** 何に対してか（`forgejo/feat-x`、`Bash`、`owner/repo`） */
  target: string
  /** 通ったか。失敗も残す —— 失敗したことこそ後から知りたい */
  ok: boolean
  /** 一言。失敗なら理由 */
  note: string
}

const SEP = '\t'
/** 区切りと改行を潰す。**行を壊させない**（1 件 1 行が全部の前提） */
const flat = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim()

export function formatAction(a: Action): string {
  return [a.at, a.kind, flat(a.target), a.ok ? 'ok' : 'ng', flat(a.note)].join(SEP)
}

const KINDS = new Set<string>(ACTION_KINDS)

/** 読めない行は null。**捨てるが、落ちない** —— 人が手で触るファイルである */
export function parseAction(line: string): Action | null {
  const parts = line.split(SEP)
  if (parts.length < 4) return null
  const [at, kind, target, state, ...rest] = parts
  if (!KINDS.has(kind) || at.trim() === '') return null
  if (state !== 'ok' && state !== 'ng') return null
  return { at, kind: kind as ActionKind, target, ok: state === 'ok', note: rest.join(SEP) }
}

/** 新しいものから `limit` 件。**末尾から読む** */
export function parseActions(text: string, limit = 20): Action[] {
  const out: Action[] = []
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const a = parseAction(lines[i])
    if (a) out.push(a)
  }
  return out
}

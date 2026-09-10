import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'

/**
 * `/` パレットの絞り込み。Izuna の差別化の本体（docs/GOAL.md 柱1）。
 *
 * 純粋関数。React も IPC も知らないので、検査に実 API も画面も要らない。
 *
 * 一覧は `Query.supportedCommands()` が返す。**ファイルシステムを走査しない** ——
 * CLI が cwd 基準で解決済みのものを権威として使う（CLAUDE.md §5）。
 */

export interface Scored {
  command: SlashCommand
  score: number
  /** `name` の中で当たった位置。強調に使う */
  matches: number[]
  /** 名前では当たらず、説明で拾ったもの */
  viaDescription: boolean
  /** 別名で当たった場合、その別名 */
  viaAlias: string | null
}

/**
 * 部分列マッチ。当たった位置も返す。
 * 連続しているほど、語頭に当たるほど高く出る。
 */
function subsequence(query: string, target: string): { score: number; matches: number[] } | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (q === '') return { score: 1, matches: [] }

  const matches: number[] = []
  let score = 0
  let ti = 0
  let previous = -2

  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at === -1) return null
    matches.push(at)

    if (at === previous + 1)
      score += 8 // 連続している
    else score -= Math.min(at - previous - 1, 6) // 飛んだぶんだけ下げる

    // 語頭（先頭・区切りの直後）は強い手がかり
    if (at === 0) score += 14
    else if (/[-_:/. ]/.test(t[at - 1])) score += 9

    previous = at
    ti = at + 1
  }

  // 短い名前を優先する。同じ当たり方なら的が絞れている方が上
  score += Math.max(0, 20 - target.length)
  return { score, matches }
}

const EXACT = 10_000
const PREFIX = 5_000
const DESCRIPTION = 40

/**
 * 後ろに下げるもの。**隠さない** —— 打てば出るが、探していないときに
 * 先頭を占領させない。
 *
 * `__` 始まりはサーバ起動のセッション専用など、人が手で打つものではない。
 * `(removed)` は CLI 自身が廃止と言っているもの。
 * 空の問い合わせでは全員同点なので、これが無いと名前順で `_` が最初に来る。
 */
const DEPRIORITIZED = 100_000

export function isDeprioritized(command: SlashCommand): boolean {
  return command.name.startsWith('__') || /^\s*\(removed\)/i.test(command.description)
}

function best(query: string, command: SlashCommand): Scored | null {
  const names: Array<{ name: string; alias: string | null }> = [
    { name: command.name, alias: null },
    ...(command.aliases ?? []).map((a) => ({ name: a, alias: a }))
  ]

  let top: Scored | null = null
  for (const { name, alias } of names) {
    const lower = name.toLowerCase()
    const q = query.toLowerCase()
    let scored: Scored | null = null

    if (lower === q) {
      scored = {
        command,
        score: EXACT,
        matches: [...name].map((_, i) => i),
        viaDescription: false,
        viaAlias: alias
      }
    } else if (q !== '' && lower.startsWith(q)) {
      scored = {
        command,
        score: PREFIX + Math.max(0, 40 - name.length),
        matches: Array.from({ length: query.length }, (_, i) => i),
        viaDescription: false,
        viaAlias: alias
      }
    } else {
      const sub = subsequence(query, name)
      if (sub)
        scored = {
          command,
          score: sub.score,
          matches: sub.matches,
          viaDescription: false,
          viaAlias: alias
        }
    }

    // 別名で当たった場合は、正式名で当たったものより一段下げる
    if (scored && alias) scored = { ...scored, score: scored.score - 1 }
    if (scored && isDeprioritized(command))
      scored = { ...scored, score: scored.score - DEPRIORITIZED }
    if (scored && (!top || scored.score > top.score)) top = scored
  }
  if (top) return top

  // 名前で当たらなければ説明を見る。「何をするものか」で探せるように
  if (query.length >= 2 && command.description.toLowerCase().includes(query.toLowerCase())) {
    const base = DESCRIPTION - (isDeprioritized(command) ? DEPRIORITIZED : 0)
    return { command, score: base, matches: [], viaDescription: true, viaAlias: null }
  }
  return null
}

/** 当たったものを強い順に返す。同点は名前順で安定させる */
export function filterCommands(query: string, commands: SlashCommand[], limit = 60): Scored[] {
  const q = query.trim()
  const scored = commands.map((c) => best(q, c)).filter((s): s is Scored => s !== null)

  scored.sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
  return scored.slice(0, limit)
}

/**
 * 入力欄の中身から「いまコマンドを打っているか」を見る。
 *
 * `/` で始まる 1 行目だけを対象にする。本文の途中の `/` には反応しない
 * （パスを書いているだけのことが多い）。
 */
export function parseSlashInput(text: string): { name: string; args: string } | null {
  if (!text.startsWith('/')) return null
  const line = text.split('\n', 1)[0]
  const body = line.slice(1)
  const space = body.search(/\s/)
  if (space === -1) return { name: body, args: '' }
  return { name: body.slice(0, space), args: body.slice(space + 1) }
}

/** 補完を確定したときの入力欄の中身 */
export function applyCompletion(command: SlashCommand, args: string): string {
  return args ? `/${command.name} ${args}` : `/${command.name} `
}

/** 出どころ。`:` を含むものはプラグインまたは名前空間つき */
export function originOf(command: SlashCommand): {
  kind: 'namespaced' | 'plain'
  namespace: string | null
} {
  const at = command.name.indexOf(':')
  return at === -1
    ? { kind: 'plain', namespace: null }
    : { kind: 'namespaced', namespace: command.name.slice(0, at) }
}

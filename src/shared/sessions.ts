import type { Attachment } from './image'
import {
  emptyTranscript,
  appendUserText,
  applyMessage,
  type TaskRun,
  type Transcript
} from './transcript'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * セッションの一覧と復元。
 *
 * **保存層を自作しない**（CLAUDE.md §18）。`claude` が
 * `~/.claude/projects/<cwd のスラッグ>/<session-id>.jsonl` に
 * 1 セッション 1 ファイルで既に書いている。それを読む。
 *
 * ここはプロセスもファイルシステムも知らない（§4 の原則）。
 * 行を渡されて要約と会話を組み立てるだけ。
 */

/** 一覧の 1 件。**全文を読まずに作れる範囲**に限る（§18 の「頭と尻尾」） */
export interface SessionSummary {
  id: string
  /** 実際の作業ディレクトリ。**ディレクトリ名から逆算しない**（下記） */
  cwd: string | null
  /** CLI が付けた題名（`ai-title`）。無ければ null */
  title: string | null
  /** CLI 側のコードネーム（`happy-jingling-cherny` 形式） */
  slug: string | null
  /** 最初の人間の発話。題名が無いときの見出しになる */
  firstPrompt: string | null
  branch: string | null
  cliVersion: string | null
  /** ファイルの更新時刻（epoch ms）。中の timestamp より安い */
  updatedAt: number
  bytes: number
}

interface RawEntry {
  type?: string
  cwd?: string
  slug?: string
  aiTitle?: string
  version?: string
  gitBranch?: string
  isSidechain?: boolean
  /** CLI が差し込んだ注記（圧縮の caveat など）。人の発話ではない */
  isMeta?: boolean
  isCompactSummary?: boolean
  origin?: { kind?: string }
  message?: { content?: unknown; id?: string }
  parentUuid?: string | null
}

const parse = (line: string): RawEntry | null => {
  const s = line.trim()
  if (!s) return null
  try {
    const v: unknown = JSON.parse(s)
    return typeof v === 'object' && v !== null ? (v as RawEntry) : null
  } catch {
    // **壊れた行で一覧ごと落とさない。** 書き込み中の末尾は千切れている
    return null
  }
}

/**
 * 人間が打った発話か。**ツール結果も `user` として来る**ので分ける必要がある。
 *
 * `origin.kind === 'human'` では駄目だった（2026-09-07 実測）。
 * CLI から打ったものには付くが、**SDK 経由 —— つまり Izuna 自身が
 * 起こしたセッションでは `origin` が `null`**（`promptSource: "sdk"` /
 * `entrypoint: "sdk-cli"`）。一番見たいセッションだけ見出しが出なくなる。
 *
 * だから素性ではなく**中身の形**で判ぐ。ツール結果を含まない `user` が発話。
 */
const isHuman = (e: RawEntry): boolean => {
  if (e.type !== 'user' || e.isMeta) return false
  const c = e.message?.content
  if (!Array.isArray(c)) return true // 文字列そのままは常に発話
  return !c.some(
    (b) => typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_result'
  )
}

/** 貼った画像。**復元でも残す** —— 何を見せたのかが分からないと、返事の意味も分からない */
const imagesOf = (content: unknown): Attachment[] => {
  if (!Array.isArray(content)) return []
  const out: Attachment[] = []
  for (const b of content) {
    const src = b as {
      type?: string
      source?: { type?: string; media_type?: string; data?: string }
    }
    if (src?.type !== 'image' || src.source?.type !== 'base64') continue
    if (typeof src.source.media_type !== 'string' || typeof src.source.data !== 'string') continue
    out.push({ mediaType: src.source.media_type, data: src.source.data, name: '' })
  }
  return out
}

const textOf = (content: unknown): string | null => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const parts = content
    .filter(
      (b): b is { type: string; text: string } =>
        typeof b === 'object' && b !== null && (b as { type?: string }).type === 'text'
    )
    .map((b) => b.text)
  return parts.length > 0 ? parts.join('\n') : null
}

/**
 * 頭と尻尾だけで要約を作る。
 *
 * **全文を読まない。** 実測で 1 セッション 19MB あり、一覧のために
 * 全部読むと開くたびに待たされる。`cwd` と最初の発話は頭に、
 * `ai-title` と `slug` は尻尾にある（実測で確認済み）。
 */
export function summarize(
  head: string[],
  tail: string[],
  meta: { id: string; updatedAt: number; bytes: number }
): SessionSummary {
  const out: SessionSummary = {
    id: meta.id,
    cwd: null,
    title: null,
    slug: null,
    firstPrompt: null,
    branch: null,
    cliVersion: null,
    updatedAt: meta.updatedAt,
    bytes: meta.bytes
  }

  for (const line of head) {
    const e = parse(line)
    if (!e) continue
    out.cwd ??= e.cwd ?? null
    out.branch ??= e.gitBranch ?? null
    out.cliVersion ??= e.version ?? null
    out.slug ??= e.slug ?? null
    if (out.firstPrompt === null && isHuman(e) && !e.isCompactSummary) {
      const text = textOf(e.message?.content)
      if (text !== null && !isInjected(text)) out.firstPrompt = text
    }
  }

  // 題名は**最後のものが最新**。会話が進むと付け直される（実測 366 件）
  for (const line of tail) {
    const e = parse(line)
    if (!e) continue
    if (e.type === 'ai-title' && e.aiTitle) out.title = e.aiTitle
    if (e.slug) out.slug = e.slug
  }

  return out
}

/**
 * CLI が組み立てた本文か。**見出しに出すと中身が分からない。**
 *
 * `<local-command-caveat>` は圧縮の注記、`<command-name>` は
 * スラッシュコマンドの展開。どちらも `isMeta` が付かないものがある（実測）ので
 * 印だけに頼らず本文の頭も見る。
 */
const isInjected = (text: string): boolean => /^\s*<(local-command-|command-name>)/.test(text)

/** 一覧の見出し。題名 → 最初の発話 → コードネーム → id の順に落ちる */
export function labelOf(s: SessionSummary): string {
  const first = s.firstPrompt?.replace(/\s+/g, ' ').trim()
  return (
    s.title ?? (first && first.length > 0 ? first.slice(0, 60) : null) ?? s.slug ?? s.id.slice(0, 8)
  )
}

/**
 * この作業ディレクトリのセッションか。
 *
 * **worktree も同じリポジトリとして拾う。** 実行役は別の worktree にいるので、
 * 完全一致にすると本体のセッションしか出てこない。
 */
export function belongsTo(s: SessionSummary, cwd: string, worktrees: string[] = []): boolean {
  if (!s.cwd) return false
  const roots = [cwd, ...worktrees].map((p) => p.replace(/\/$/, ''))
  return roots.some((r) => s.cwd === r || s.cwd!.startsWith(`${r}/`))
}

/** 新しい順。**同着は id で決める** —— 並びが呼ぶたびに変わると選べない */
export function byNewest(a: SessionSummary, b: SessionSummary): number {
  return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)
}

/** 題名・最初の発話・コードネームを対象にした絞り込み（部分一致・大小無視） */
export function filterSessions(list: SessionSummary[], query: string): SessionSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...list].sort(byNewest)
  return list
    .filter((s) => [s.title, s.firstPrompt, s.slug, s.id].some((v) => v?.toLowerCase().includes(q)))
    .sort(byNewest)
}

/**
 * 記録から会話を組み立て直す。
 *
 * `user` / `assistant` は SDK と同じ形（`message.content`）で入っているので
 * `applyMessage` をそのまま使える。**分けるのは人間の発話だけ** ——
 * ツール結果も `user` として来るので、`origin.kind` で判ぐ。
 *
 * `isSidechain` は実行役の発話。ブレインの会話に混ぜない（§12 と同じ規律）。
 */
/**
 * 中身の無い thinking を落とす。
 *
 * **記録に思考は残っていない**（2026-09-07 実測: 301 件すべて本文が空で
 * `signature` だけ）。CLI が保存時に落としている。そのまま復元すると
 * 空の箱が数百個並ぶので、ここで捨てる。
 */
function stripEmptyThinking(e: RawEntry): RawEntry {
  const c = e.message?.content
  if (!Array.isArray(c)) return e
  const kept = c.filter(
    (b) =>
      !(
        typeof b === 'object' &&
        b !== null &&
        (b as { type?: string }).type === 'thinking' &&
        !(b as { thinking?: string }).thinking
      )
  )
  return kept.length === c.length ? e : { ...e, message: { ...e.message, content: kept } }
}

/**
 * 巨大なツール出力は**外のファイルに逃がされている**（2026-09-08 実測、23 セッション該当）。
 *
 * ```
 * <persisted-output>
 * Output too large (33.5KB). Full output saved to: …/tool-results/xxxx.txt
 * </persisted-output>
 * ```
 *
 * 読まないと**抜粋しか復元されない**。ここは印からパスを取り出すだけで、
 * 読むのは `main/sessions.ts` の仕事（§4 の原則）。
 */
export function persistedOutputPath(text: string): string | null {
  const m = /Full output saved to:\s*(\S+)/.exec(text)
  return m ? m[1] : null
}

/** 印を、実際の中身で置き換える */
export function withPersistedOutput(text: string, content: string): string {
  return text.replace(/<persisted-output>[\s\S]*?<\/persisted-output>/, content)
}

/**
 * 実行役の記録（`<sessionId>/subagents/agent-<id>.jsonl`）から 1 件を組み立てる。
 *
 * **親のツール呼び出しには紐付けられない。** `task_started` などの
 * イベントは記録に残らない（実測: `system` に出るのは `away_summary` /
 * `turn_duration` などだけ）。だから**ファイルそのものを 1 件の実行役**として扱う。
 */
export function replayTask(agentId: string, lines: string[]): TaskRun | null {
  const t = replay(lines, true)
  const blocks = t.items.flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
  const firstPrompt = t.items.find((i) => i.kind === 'user')
  if (blocks.length === 0 && !firstPrompt) return null
  return {
    taskId: agentId,
    toolUseId: null,
    description: firstPrompt?.kind === 'user' ? firstPrompt.text.slice(0, 80) : '(記録のみ)',
    subagentType: null,
    prompt: firstPrompt?.kind === 'user' ? firstPrompt.text : null,
    // 記録から読んでいる時点で、その実行役はもう走っていない
    status: 'completed',
    summary: null,
    lastTool: null,
    backgrounded: false,
    usage: null,
    blocks
  }
}

export function replay(lines: string[], includeSidechain = false): Transcript {
  let t = emptyTranscript()
  let n = 0
  for (const line of lines) {
    const e = parse(line)
    // **実行役の記録は全行が sidechain。** そのファイルを読むときは飛ばさない
    if (!e || (e.isSidechain && !includeSidechain)) continue
    if (isHuman(e)) {
      t = appendUserText(
        t,
        textOf(e.message?.content) ?? '',
        `replay-${n++}`,
        imagesOf(e.message?.content)
      )
      continue
    }
    if (e.type === 'user' || e.type === 'assistant') {
      t = applyMessage(t, stripEmptyThinking(e) as unknown as SDKMessage)
    }
  }
  // 復元した時点では走っていない。**running を引き継ぐと止められない画面になる**
  return { ...t, running: false, draft: null }
}

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * SDKMessage の並び → 画面に描く形、への変換。
 *
 * **段1 の心臓。** プロセスも React も知らない純粋関数にしてあるので、
 * 録った fixture（`test/fixtures/transcript-tools.ndjson`）だけで検査でき、
 * 実 API も要らない。UI をいくら触ってもここが緑なら状態は壊れていない。
 *
 * ## 調停の規則
 *
 * 実測（claude 2.1.263 / SDK 0.3.263）で分かったこと:
 * **SDK は 1 つのコンテンツブロックごとに `assistant` を 1 回出す。**
 * 同じ `message.id` を共有し、順に届く。
 *
 *   message_start(id=X) → assistant(id=X, [thinking]) → assistant(id=X, [tool_use]) → message_stop
 *
 * したがって確定状態は **`assistant` と `user` だけ**から作る。
 * `stream_event` は「いま流れている途中の文字」を出すためだけに使い、
 * ブロックが閉じたら捨てる。両方を状態に混ぜないので、
 * 二重に描かれることも取りこぼすことも原理的に起きない。
 */

export type ToolState = 'running' | 'done' | 'error' | 'denied'

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown; state: ToolState; result: string | null }

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; blocks: Block[] }
  | { kind: 'notice'; id: string; tone: 'warn' | 'bad'; text: string }

/** 表示用の途中経過。確定が来たら捨てる。状態の一部ではない */
export interface Draft {
  messageId: string
  index: number
  kind: 'text' | 'thinking' | 'tool'
  text: string
  toolName: string | null
}

export interface Transcript {
  items: Item[]
  draft: Draft | null
  sessionId: string | null
  model: string | null
  /** init が返した送信可能なコマンド。段2 の / パレットの材料 */
  slashCommands: string[]
  /** turn が走っているか。result で false になる */
  running: boolean
  costUsd: number | null
  /** message_start で覚えた直近の id。draft を紐づけるためだけに持つ */
  streamingMessageId: string | null
}

export function emptyTranscript(): Transcript {
  return {
    items: [], draft: null, sessionId: null, model: null,
    slashCommands: [], running: false, costUsd: null, streamingMessageId: null
  }
}

/**
 * 人間の発話は SDK のストリームに戻ってこない（`--replay-user-messages` を
 * 使っていないため）。送った側で足すこと。
 */
export function appendUserText(t: Transcript, text: string, id: string): Transcript {
  return { ...t, items: [...t.items, { kind: 'user', id, text }], running: true }
}

export function applyMessage(t: Transcript, m: SDKMessage): Transcript {
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init') {
        return { ...t, sessionId: m.session_id, model: m.model, slashCommands: [...m.slash_commands] }
      }
      return t

    case 'stream_event':
      return applyStreamEvent(t, m.event as StreamEvent)

    case 'assistant':
      return { ...t, items: appendBlocks(t.items, m.message.id, m.message.content as RawBlock[]) }

    case 'user':
      return { ...t, items: attachResults(t.items, m.message.content) }

    case 'result':
      return {
        ...t,
        draft: null,
        running: false,
        costUsd: 'total_cost_usd' in m && typeof m.total_cost_usd === 'number' ? m.total_cost_usd : t.costUsd
      }

    default:
      return t
  }
}

export function buildTranscript(messages: SDKMessage[]): Transcript {
  return messages.reduce(applyMessage, emptyTranscript())
}

// ── 途中経過 ────────────────────────────────────────────────

type StreamEvent = {
  type: string
  index?: number
  message?: { id: string }
  content_block?: { type: string; name?: string }
  delta?: { type: string; text?: string; thinking?: string }
}

function applyStreamEvent(t: Transcript, e: StreamEvent): Transcript {
  switch (e.type) {
    case 'message_start':
      return { ...t, streamingMessageId: e.message?.id ?? null }
    case 'content_block_start': {
      const type = e.content_block?.type
      const kind = type === 'text' ? 'text' : type === 'thinking' ? 'thinking' : 'tool'
      return {
        ...t,
        draft: {
          messageId: t.streamingMessageId ?? '',
          index: e.index ?? 0,
          kind,
          text: '',
          toolName: e.content_block?.name ?? null
        }
      }
    }
    case 'content_block_delta': {
      if (!t.draft) return t
      const d = e.delta
      const add = d?.type === 'text_delta' ? d.text : d?.type === 'thinking_delta' ? d.thinking : undefined
      // signature_delta と input_json_delta は人に見せない
      if (add === undefined) return t
      return { ...t, draft: { ...t.draft, text: t.draft.text + add } }
    }
    case 'content_block_stop':
      // ここで捨てる。確定版は直後の assistant が持ってくる
      return { ...t, draft: null }
    case 'message_stop':
      return { ...t, draft: null }
    default:
      return t
  }
}

// ── 確定 ────────────────────────────────────────────────────

type RawBlock = { type: string; text?: string; thinking?: string; id?: string; name?: string; input?: unknown }

function toBlock(b: RawBlock): Block | null {
  if (b.type === 'text') return { kind: 'text', text: b.text ?? '' }
  if (b.type === 'thinking') return { kind: 'thinking', text: b.thinking ?? '' }
  if (b.type === 'tool_use') {
    return { kind: 'tool', id: b.id ?? '', name: b.name ?? '?', input: b.input, state: 'running', result: null }
  }
  return null
}

/**
 * 同じ message id の assistant は**足す**。置き換えない。
 * SDK が 1 ブロックずつ出すので、置き換えると前のブロックが消える。
 */
function appendBlocks(items: Item[], messageId: string, raw: RawBlock[]): Item[] {
  const blocks = raw.map(toBlock).filter((b): b is Block => b !== null)
  if (blocks.length === 0) return items

  const at = items.findIndex((i) => i.kind === 'assistant' && i.id === messageId)
  if (at === -1) return [...items, { kind: 'assistant', id: messageId, blocks }]

  const target = items[at] as Extract<Item, { kind: 'assistant' }>
  const next = [...items]
  next[at] = { ...target, blocks: [...target.blocks, ...blocks] }
  return next
}

type ResultBlock = { type: string; tool_use_id?: string; content?: unknown; is_error?: boolean }

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/** tool_result を、対応する tool ブロックに畳み込む */
function attachResults(items: Item[], content: unknown): Item[] {
  if (!Array.isArray(content)) return items
  const results = (content as ResultBlock[]).filter((c) => c.type === 'tool_result')
  if (results.length === 0) return items

  return items.map((item) => {
    if (item.kind !== 'assistant') return item
    let touched = false
    const blocks = item.blocks.map((b) => {
      if (b.kind !== 'tool') return b
      const r = results.find((x) => x.tool_use_id === b.id)
      if (!r) return b
      touched = true
      const text = textOf(r.content)
      // 承認を拒否したときも is_error で返る。理由が本文に入っている
      const denied = r.is_error === true && /permission|承認|granted/i.test(text)
      return { ...b, state: r.is_error ? (denied ? 'denied' : 'error') : 'done', result: text } as Block
    })
    return touched ? { ...item, blocks } : item
  })
}

/** 画面に出す本文だけを繋げる。検査で二重描画を見つけるのに使う */
export function plainText(t: Transcript): string {
  return t.items
    .flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
    .flatMap((b) => (b.kind === 'text' ? [b.text] : []))
    .join('')
}

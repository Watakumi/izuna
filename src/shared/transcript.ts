import type { PermissionMode, SDKMessage } from '@anthropic-ai/claude-agent-sdk'

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

export type TaskStatus = 'running' | 'completed' | 'failed' | 'stopped'

/**
 * 実行役 1 人ぶん（段4）。
 *
 * ブレインの `Agent` ツール呼び出しと、次の 3 つが同じ id で繋がる（実測）:
 * `task_started.tool_use_id` = 実行役メッセージの `parent_tool_use_id`
 * = ブレインの tool_use の id。承認の `agentId` は `task_id` に一致する。
 */
export interface TaskRun {
  taskId: string
  /** ブレインのどの tool_use から生えたか */
  toolUseId: string | null
  description: string
  subagentType: string | null
  prompt: string | null
  status: TaskStatus
  summary: string | null
  /** いま何のツールを使っているか（task_progress） */
  lastTool: string | null
  backgrounded: boolean
  usage: { totalTokens: number; toolUses: number; durationMs: number } | null
  /** 実行役が出したもの。**ブレインの会話には混ぜない** */
  blocks: Block[]
}

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; blocks: Block[] }
  | { kind: 'notice'; id: string; tone: 'warn' | 'bad' | 'info'; text: string }

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
  /**
   * いまの権限モード。init で来た値を起点に、変えたら UI 側で更新する。
   * **モード変更の通知イベントは無い**ので、状態は持つしかない。
   */
  permissionMode: PermissionMode
  /** CLI が言う稼働状態。result からの推測より正確 */
  state: 'idle' | 'running' | 'requires_action'
  /** 実行役。ブレインの会話とは別に持つ */
  tasks: TaskRun[]
  /** turn が走っているか。result で false になる */
  running: boolean
  /**
   * 定価換算の目安。**請求額ではない**（costBasis: "list"）。
   * 画面には出さない —— 課金されない額を出すと誤解される（CLAUDE.md §14）。
   * 記録として持つだけ。
   */
  costUsd: number | null
  /**
   * サブスクリプションの枠の使用率（0..1）。**こちらが実際の制約**。
   * ターミナルの Claude Code と同じ窓を共有するので、並列で走らせると効く。
   */
  limits: { fiveHour: number; sevenDay: number } | null
  /** message_start で覚えた直近の id。draft を紐づけるためだけに持つ */
  streamingMessageId: string | null
  /**
   * 人間が拒否した tool_use_id。
   *
   * **結果の文面から判定しない。** `EACCES: permission denied` のような
   * ファイルシステムのエラーを人間の拒否と取り違える（実際にやらかした）。
   * 拒否したのは自分なので、自分で覚えるのが唯一正しい。
   */
  deniedToolUseIds: string[]
}

export function emptyTranscript(): Transcript {
  return {
    items: [], draft: null, sessionId: null, model: null,
    slashCommands: [], permissionMode: 'default', state: 'idle', tasks: [],
    running: false, costUsd: null, limits: null, streamingMessageId: null, deniedToolUseIds: []
  }
}

/**
 * 人間の発話は SDK のストリームに戻ってこない（`--replay-user-messages` を
 * 使っていないため）。送った側で足すこと。
 */
/** 人間が拒否したときに呼ぶ。tool_use_id が分かる場合だけ意味がある */
export function markDenied(t: Transcript, toolUseId: string | undefined): Transcript {
  if (!toolUseId || t.deniedToolUseIds.includes(toolUseId)) return t
  return { ...t, deniedToolUseIds: [...t.deniedToolUseIds, toolUseId] }
}

export function setPermissionMode(t: Transcript, permissionMode: PermissionMode): Transcript {
  return { ...t, permissionMode }
}

export function appendUserText(t: Transcript, text: string, id: string): Transcript {
  return { ...t, items: [...t.items, { kind: 'user', id, text }], running: true }
}

export function applyMessage(t: Transcript, m: SDKMessage): Transcript {
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init') {
        return {
          ...t,
          sessionId: m.session_id,
          model: m.model,
          permissionMode: m.permissionMode,
          slashCommands: [...m.slash_commands]
        }
      }
      if (m.subtype === 'session_state_changed') {
        return { ...t, state: m.state }
      }
      if (String(m.subtype).startsWith('task_')) {
        return { ...t, tasks: applyTask(t.tasks, m as unknown as TaskFrame) }
      }
      return t

    case 'stream_event':
      // 実行役の逐次差分でブレインの途中経過を上書きしない
      if (m.parent_tool_use_id) return t
      return applyStreamEvent(t, m.event as StreamEvent)

    case 'assistant': {
      const blocks = (m.message.content as RawBlock[]).map(toBlock).filter((b): b is Block => b !== null)
      // 実行役の発話はブレインの会話に混ぜない。混ぜると誰が言ったのか分からなくなる
      if (m.parent_tool_use_id) {
        return { ...t, tasks: appendToTask(t.tasks, m.parent_tool_use_id, blocks) }
      }
      return { ...t, items: appendBlocks(t.items, m.message.id, m.message.content as RawBlock[]) }
    }

    case 'user':
      if (m.parent_tool_use_id) {
        return {
          ...t,
          tasks: t.tasks.map((task) =>
            task.toolUseId === m.parent_tool_use_id
              ? { ...task, blocks: resultsInto(task.blocks, m.message.content, t.deniedToolUseIds) }
              : task
          )
        }
      }
      return { ...t, items: attachResults(t.items, m.message.content, t.deniedToolUseIds) }

    case 'rate_limit_event': {
      const w = (m as unknown as { rate_limit_info?: { unifiedWindows?: Record<string, { utilization?: number }> } })
        .rate_limit_info?.unifiedWindows
      if (!w) return t
      return {
        ...t,
        limits: {
          fiveHour: w.five_hour?.utilization ?? t.limits?.fiveHour ?? 0,
          sevenDay: w.seven_day?.utilization ?? t.limits?.sevenDay ?? 0
        }
      }
    }

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

// ── 実行役 ──────────────────────────────────────────────────

type TaskFrame = {
  subtype: string
  task_id?: string
  tool_use_id?: string
  description?: string
  subagent_type?: string
  prompt?: string
  status?: string
  summary?: string
  last_tool_name?: string
  is_backgrounded?: boolean
  usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number }
  patch?: { status?: string }
}

const TASK_STATUSES: TaskStatus[] = ['running', 'completed', 'failed', 'stopped']
const asStatus = (v: unknown): TaskStatus | null =>
  typeof v === 'string' && (TASK_STATUSES as string[]).includes(v) ? (v as TaskStatus) : null

function applyTask(tasks: TaskRun[], frame: TaskFrame): TaskRun[] {
  const id = frame.task_id
  if (!id) return tasks

  if (frame.subtype === 'task_started') {
    if (tasks.some((t) => t.taskId === id)) return tasks
    return [...tasks, {
      taskId: id,
      toolUseId: frame.tool_use_id ?? null,
      description: frame.description ?? '',
      subagentType: frame.subagent_type ?? null,
      prompt: frame.prompt ?? null,
      status: 'running',
      summary: null,
      lastTool: null,
      backgrounded: frame.is_backgrounded === true,
      usage: null,
      blocks: []
    }]
  }

  return tasks.map((task) => {
    if (task.taskId !== id) return task
    const usage = frame.usage
      ? {
          totalTokens: frame.usage.total_tokens ?? 0,
          toolUses: frame.usage.tool_uses ?? 0,
          durationMs: frame.usage.duration_ms ?? 0
        }
      : task.usage
    return {
      ...task,
      description: frame.description ?? task.description,
      lastTool: frame.last_tool_name ?? task.lastTool,
      summary: frame.summary ?? task.summary,
      status: asStatus(frame.patch?.status) ?? asStatus(frame.status) ?? task.status,
      usage
    }
  })
}

function appendToTask(tasks: TaskRun[], toolUseId: string, blocks: Block[]): TaskRun[] {
  if (blocks.length === 0) return tasks
  return tasks.map((t) => (t.toolUseId === toolUseId ? { ...t, blocks: [...t.blocks, ...blocks] } : t))
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

/**
 * 端末のエスケープシーケンスを落とす。
 *
 * Claude Code の Bash は TTY 無しで動くので、たいていのツールは自分で色を
 * 落とす（録画でも 0 行だった）。だが `color.ui=always` や `FORCE_COLOR=1`
 * があると混ざり、素の <pre> では `^[[31m` がそのまま見えてしまう。
 *
 * **段6 で ghostty-web を入れたら、落とさずに描く。** それまでの安全側。
 */
export function stripAnsi(text: string): string {
  return text
    // CSI（色・カーソル移動）
    .replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '')
    // OSC（タイトル・ハイパーリンク）
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
    // 単発のエスケープ
    .replace(/\u001B[@-Z\\-_]/g, '')
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return stripAnsi(content)
  if (Array.isArray(content)) {
    return stripAnsi(
      content
        .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
        .filter(Boolean)
        .join('\n')
    )
  }
  return ''
}

/** tool_result をブロック列に畳み込む。ブレインにも実行役にも同じ規則を使う */
export function resultsInto(blocks: Block[], content: unknown, denied: string[]): Block[] {
  if (!Array.isArray(content)) return blocks
  const results = (content as ResultBlock[]).filter((c) => c.type === 'tool_result')
  if (results.length === 0) return blocks

  return blocks.map((b) => {
    if (b.kind !== 'tool') return b
    const r = results.find((x) => x.tool_use_id === b.id)
    if (!r) return b
    return {
      ...b,
      state: denied.includes(b.id) ? 'denied' : r.is_error ? 'error' : 'done',
      result: textOf(r.content)
    } as Block
  })
}

/** tool_result を、対応する tool ブロックに畳み込む */
function attachResults(items: Item[], content: unknown, denied: string[]): Item[] {
  if (!Array.isArray(content)) return items
  return items.map((item) => {
    if (item.kind !== 'assistant') return item
    const blocks = resultsInto(item.blocks, content, denied)
    return blocks === item.blocks ? item : { ...item, blocks }
  })
}

/** 画面に出す本文だけを繋げる。検査で二重描画を見つけるのに使う */
export function plainText(t: Transcript): string {
  return t.items
    .flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
    .flatMap((b) => (b.kind === 'text' ? [b.text] : []))
    .join('')
}

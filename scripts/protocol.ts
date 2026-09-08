/**
 * Claude Code の `--output-format stream-json` が吐く NDJSON のワイヤ型。
 *
 * 出典は claude 2.1.263 の実測。仕様として公開されたものではないため、
 * 未知のフィールドは落とさずに保持し、未知の type は UnknownEvent に落ちる。
 *
 * **アプリはこれを使わない。** Izuna 本体は CLI の標準出力ではなく
 * `@anthropic-ai/claude-agent-sdk` の `query()` から型付きの値を受け取る（§7）。
 * ここが要るのは録画の道具（`record-fixture.ts`）と、
 * 録画に対する門（`test/scripts-protocol.test.ts`）だけである。
 * だから `src/` ではなく `scripts/` に置いてある ——
 * `src/` に置くと「アプリが使っている」ように見え、
 * 上流が変わったとき壊れる範囲を読み違える。
 */

/** Anthropic Messages API のコンテンツブロック（必要な範囲だけ） */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: unknown; is_error?: boolean }
  | { type: string; [k: string]: unknown }

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  [k: string]: unknown
}

/** セッション開始時に一度だけ届く。ここに / コマンドもモデルも全部入っている。 */
export interface InitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  cwd: string
  model: string
  permissionMode:
    'default' | 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk' | 'plan'
  claude_code_version: string
  output_style: string
  apiKeySource: string
  tools: string[]
  /** 送信可能なスラッシュコマンド名。プロジェクト・ユーザー・プラグインが解決済みで混ざっている */
  slash_commands: string[]
  /** CLI 本体が処理する端末専用コマンド。ヘッドレスでは送っても意味がない */
  terminal_slash_commands: string[]
  skills: string[]
  agents: string[]
  plugins: Array<{ name: string; path: string; source: string; version: string }>
  mcp_servers: Array<{ name: string; status: string }>
  capabilities: string[]
  memory_paths?: Record<string, string>
  messaging_socket_path?: string
  uuid: string
}

export interface HookEvent {
  type: 'system'
  subtype: 'hook_started' | 'hook_response'
  hook_id: string
  hook_name: string
  hook_event: string
  output?: string
  session_id: string
  uuid: string
}

export interface AssistantEvent {
  type: 'assistant'
  message: {
    id: string
    model: string
    role: 'assistant'
    content: ContentBlock[]
    stop_reason: string | null
    usage?: Usage
  }
  /** サブエージェント発話ならその tool_use の id が入る */
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
  timestamp?: string
}

/** ツール結果はここに来る（role は user だが人間の発話ではない） */
export interface UserEvent {
  type: 'user'
  message: { role: 'user'; content: ContentBlock[] | string }
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

/** --include-partial-messages を付けたときだけ届く逐次差分 */
export interface StreamEvent {
  type: 'stream_event'
  event: { type: string; [k: string]: unknown }
  parent_tool_use_id: string | null
  session_id: string
  uuid: string
}

export interface RateLimitEvent {
  type: 'rate_limit_event'
  rate_limit_info: {
    status: string
    resetsAt?: number
    rateLimitType?: string
    isUsingOverage?: boolean
    unifiedWindows?: Record<string, { utilization: number; resetsAt: number }>
    [k: string]: unknown
  }
  session_id: string
  uuid: string
}

export interface ResultEvent {
  type: 'result'
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | string
  session_id: string
  stop_reason?: string
  terminal_reason?: string
  duration_api_ms?: number
  total_cost_usd?: number
  usage?: Usage
  permission_denials?: unknown[]
  is_error?: boolean
  result?: string
}

export interface UnknownEvent {
  type: string
  [k: string]: unknown
}

export type ClaudeEvent =
  | InitEvent
  | HookEvent
  | AssistantEvent
  | UserEvent
  | StreamEvent
  | RateLimitEvent
  | ResultEvent
  | UnknownEvent

export function isInit(e: ClaudeEvent): e is InitEvent {
  return e.type === 'system' && (e as InitEvent).subtype === 'init'
}
export function isAssistant(e: ClaudeEvent): e is AssistantEvent {
  return e.type === 'assistant'
}
export function isResult(e: ClaudeEvent): e is ResultEvent {
  return e.type === 'result'
}
export function isHook(e: ClaudeEvent): e is HookEvent {
  return e.type === 'system' && String((e as HookEvent).subtype).startsWith('hook_')
}

/** stdin に流す入力。--input-format stream-json はこの形を1行1件で読む。 */
export interface UserInputMessage {
  type: 'user'
  message: { role: 'user'; content: Array<{ type: 'text'; text: string }> }
}

export function userInput(text: string): UserInputMessage {
  return { type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }
}

/**
 * §5 の実測を行った CLI の版。
 *
 * ワイヤ形式は公開仕様ではないので、CLI が上がれば黙って変わりうる。
 * **上がったことを検知する仕掛けが無いと、気づくのは UI が壊れたときになる。**
 * この定数と、録画した fixture と、手元の `claude --version` の 3 つが
 * 一致することをテストで見る。ずれたら §5 を測り直す合図。
 */
export const MEASURED_CLI_VERSION = '2.1.263'

/**
 * NDJSON の 1 行を解釈した結果。
 *
 * プロセスから切り離してあるのは、**録画した NDJSON に対してテストを回すため**。
 * ここが `spawn` に密着していると、CLI を実際に叩かないと何も検証できない
 * (= 実 API の費用がかかるので、結局は手で年に数回しか回らなくなる)。
 */
export type ParsedLine =
  | { kind: 'event'; event: ClaudeEvent }
  /** JSON として読めなかった行。CLI の警告などの診断情報であることが多い */
  | { kind: 'diagnostic'; text: string }
  | { kind: 'blank' }

export function parseLine(line: string): ParsedLine {
  const trimmed = line.trim()
  if (!trimmed) return { kind: 'blank' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { kind: 'diagnostic', text: trimmed }
  }
  // 配列・数値・null の行はイベントではない。type を持たない object も同じ。
  // 握りつぶさず診断として上へ返す(黙って捨てると、CLI の警告が消える)。
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'diagnostic', text: trimmed }
  }
  if (typeof (parsed as { type?: unknown }).type !== 'string') {
    return { kind: 'diagnostic', text: trimmed }
  }
  return { kind: 'event', event: parsed as ClaudeEvent }
}

/**
 * 実測した版と違う CLI が動いていないか。
 *
 * **アプリは止めない。** 版が上がってもワイヤが変わるとは限らず、
 * 上がるたびに起動しなくなる道具は使われなくなる。
 * 止めるのは `pnpm verify` の側 —— そこなら止まる代償が安い。
 * ここが返すのは UI に出すための事実だけである。
 */
export function versionDrift(init: InitEvent): {
  drifted: boolean
  measured: string
  actual: string
} {
  return {
    drifted: init.claude_code_version !== MEASURED_CLI_VERSION,
    measured: MEASURED_CLI_VERSION,
    actual: init.claude_code_version
  }
}

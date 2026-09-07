import type { PermissionMode, PermissionResult, SDKMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../main/claude/session'

/**
 * renderer と main のあいだの唯一の口。
 *
 * `contextIsolation` は既定のまま維持する。preload は
 * **この型に書かれたものだけ**を出す。ここに無いものは renderer から触れない。
 *
 * セッションは段1 では 1 本だが、識別子は最初から持たせる。
 * 段3（worktree 並列）で複数になったとき、ここを書き直さずに済ませるため。
 */

/** Izuna 側の識別子。claude の session_id とは別物（あちらは init で後から届く） */
export type SessionId = string

export interface StartSessionInput {
  cwd: string
  model?: string
  permissionMode?: PermissionMode
  resume?: string
}

export interface PermissionAnswer {
  id: SessionId
  requestId: string
  result: PermissionResult
}

/** renderer が呼ぶもの。すべて invoke（応答を待つ） */
export interface IzunaApi {
  start(input: StartSessionInput): Promise<SessionId>
  send(id: SessionId, text: string): Promise<void>
  respondPermission(answer: PermissionAnswer): Promise<void>
  slashCommands(id: SessionId): Promise<SlashCommand[]>
  interrupt(id: SessionId): Promise<void>
  stop(id: SessionId): Promise<void>
  /** main からの通知を受ける。返り値を呼ぶと購読をやめる */
  onEvent(handler: (event: SessionEvent) => void): () => void
}

/** main から renderer に流れるもの */
export type SessionEvent =
  | { kind: 'message'; id: SessionId; message: SDKMessage }
  | { kind: 'permission'; id: SessionId; request: PermissionRequest }
  | { kind: 'error'; id: SessionId; message: string }
  | { kind: 'exit'; id: SessionId }

/** チャネル名は 1 箇所で決める。文字列を各所に散らさない */
export const CH = {
  start: 'izuna:session:start',
  send: 'izuna:session:send',
  respondPermission: 'izuna:session:respond-permission',
  slashCommands: 'izuna:session:slash-commands',
  interrupt: 'izuna:session:interrupt',
  stop: 'izuna:session:stop',
  event: 'izuna:session:event'
} as const

import type { PermissionMode, PermissionResult, SDKMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../main/claude/session'
import type { Worktree } from './worktree'
import type { ForgeFacts } from './forge'
import type { FixId } from '../main/forge/setup'
import type { ForgejoPull, ForgejoRepo } from '../main/forge/client'
import type { GitHubIssue, GitHubPull } from '../main/forge/github'
import type { RemoteRef } from './remote'
import type { FoundRepo } from '../main/repos'
import type { WorktreeStatus } from '../main/git/worktree'

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
  /** 共有フォルダの名前。省略すると default */
  team?: string
}

export interface PermissionAnswer {
  id: SessionId
  requestId: string
  result: PermissionResult
}

export interface RepoInfo {
  root: string
  name: string
  worktrees: Worktree[]
}

/** renderer が呼ぶもの。すべて invoke（応答を待つ） */
export interface IzunaApi {
  /** Forgejo の環境を調べる。**検出だけ。何も変えない** */
  forgeFacts(): Promise<ForgeFacts>
  /** 明示的に押されたときだけ走る修正 */
  forgeFix(id: FixId): Promise<string>

  // ── 段5: 二段の PR ───────────────────────────────────────
  /** 作業場（Forgejo） */
  forgeRepos(): Promise<ForgejoRepo[]>
  forgePulls(owner: string, repo: string): Promise<ForgejoPull[]>
  forgeCreatePull(owner: string, repo: string, input: { title: string; head: string; base: string; body?: string }): Promise<ForgejoPull>
  forgeEnsureRepo(name: string): Promise<ForgejoRepo>
  /** 出口（GitHub · gh に任せる） */
  ghStatus(cwd: string): Promise<{ ok: boolean; detail: string }>
  ghIssues(cwd: string): Promise<GitHubIssue[]>
  ghPulls(cwd: string): Promise<GitHubPull[]>
  ghCreatePull(cwd: string, input: { title: string; body: string; head: string; base?: string; draft?: boolean }): Promise<string>
  /** remote と push */
  remotes(cwd: string): Promise<RemoteRef[]>
  ensureSandboxRemote(cwd: string, owner: string, repo: string): Promise<string>
  currentBranch(cwd: string): Promise<string | null>
  /** その remote の既定ブランチ。main と決め打たない */
  defaultBranch(cwd: string, remote: string): Promise<string | null>
  isPushed(cwd: string, remote: string, branch: string): Promise<boolean>
  push(cwd: string, remote: string, branch: string): Promise<string>
  commitsSince(cwd: string, base: string): Promise<string[]>

  // ── 段6: ターミナル ──────────────────────────────────────
  /** worktree のシェルを開く。VT の解釈と描画は renderer の ghostty-web */
  openTerminal(input: { cwd: string; cols: number; rows: number }): Promise<string>
  writeTerminal(id: string, data: string): Promise<void>
  resizeTerminal(id: string, cols: number, rows: number): Promise<void>
  closeTerminal(id: string): Promise<void>
  /** PTY からの出力。返り値を呼ぶと購読をやめる */
  onTerminal(handler: (event: TerminalEvent) => void): () => void
  /** 設定の場所と、読めずに落とした項目 */
  configInfo(): Promise<{ path: string; ignored: string[]; exists: boolean }>
  /** よくある置き場から git リポジトリを探す */
  findRepos(): Promise<FoundRepo[]>
  /** ネイティブのフォルダ選択。探索に出てこない場所のため */
  pickDirectory(): Promise<string | null>
  /** main 側の IPC 版。renderer 側と食い違っていたら再起動が要る */
  ipcVersion(): Promise<number>
  /** 共有フォルダの場所。renderer は homedir を知らない */
  teamPath(name: string): Promise<string>
  /** 作業ディレクトリからリポジトリと worktree 一覧を引く */
  repo(cwd: string): Promise<RepoInfo>
  createWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }>
  removeWorktree(cwd: string, path: string, force?: boolean): Promise<void>
  worktreeStatus(path: string): Promise<WorktreeStatus>
  start(input: StartSessionInput): Promise<SessionId>
  send(id: SessionId, text: string): Promise<void>
  respondPermission(answer: PermissionAnswer): Promise<void>
  slashCommands(id: SessionId): Promise<SlashCommand[]>
  setPermissionMode(id: SessionId, mode: PermissionMode): Promise<void>
  setModel(id: SessionId, model?: string): Promise<void>
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

export type TerminalEvent =
  | { id: string; kind: 'data'; data: string }
  | { id: string; kind: 'exit'; code: number }

/**
 * renderer と main の版。**両方に同じ値が焼かれる。**
 *
 * `pnpm dev` は renderer を HMR で更新するが、**main の再起動は別**である。
 * 食い違ったまま動くと `No handler registered for '...'` のような、
 * 原因を指さないエラーになる（実際に 5 時間古い main で踏んだ）。
 *
 * **口を足したらここを上げること。** 上げ忘れても害はない（検出できないだけ）。
 */
export const IPC_VERSION = 10

/** チャネル名は 1 箇所で決める。文字列を各所に散らさない */
export const CH = {
  forgeFacts: 'izuna:forge:facts',
  forgeFix: 'izuna:forge:fix',
  forgeRepos: 'izuna:forge:repos',
  forgePulls: 'izuna:forge:pulls',
  forgeCreatePull: 'izuna:forge:create-pull',
  forgeEnsureRepo: 'izuna:forge:ensure-repo',
  ghStatus: 'izuna:gh:status',
  ghIssues: 'izuna:gh:issues',
  ghPulls: 'izuna:gh:pulls',
  ghCreatePull: 'izuna:gh:create-pull',
  remotes: 'izuna:git:remotes',
  ensureSandboxRemote: 'izuna:git:ensure-sandbox',
  currentBranch: 'izuna:git:branch',
  defaultBranch: 'izuna:git:default-branch',
  isPushed: 'izuna:git:is-pushed',
  push: 'izuna:git:push',
  commitsSince: 'izuna:git:commits',
  openTerminal: 'izuna:term:open',
  writeTerminal: 'izuna:term:write',
  resizeTerminal: 'izuna:term:resize',
  closeTerminal: 'izuna:term:close',
  terminalEvent: 'izuna:term:event',
  configInfo: 'izuna:config:info',
  findRepos: 'izuna:repos:find',
  pickDirectory: 'izuna:repos:pick',
  ipcVersion: 'izuna:ipc-version',
  teamPath: 'izuna:team:path',
  repo: 'izuna:repo',
  createWorktree: 'izuna:worktree:create',
  removeWorktree: 'izuna:worktree:remove',
  worktreeStatus: 'izuna:worktree:status',
  start: 'izuna:session:start',
  send: 'izuna:session:send',
  respondPermission: 'izuna:session:respond-permission',
  slashCommands: 'izuna:session:slash-commands',
  setPermissionMode: 'izuna:session:set-permission-mode',
  setModel: 'izuna:session:set-model',
  interrupt: 'izuna:session:interrupt',
  stop: 'izuna:session:stop',
  event: 'izuna:session:event'
} as const

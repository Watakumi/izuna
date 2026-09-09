import type { PermissionMode, PermissionResult, SDKMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../main/claude/session'
import type { Worktree } from './worktree'
import type { ForgeFacts } from './forge'
import type { FixId } from '../main/forge/setup'
import type { ForgejoPull, ForgejoRepo, ForgejoRun, ForgejoToken } from '../main/forge/client'
import type { GitHubIssue, GitHubPull } from '../main/forge/github'
import type { RemoteRef } from './remote'
import type { FoundRepo } from '../main/repos'
import type { WorktreeStatus } from '../main/git/worktree'
import type { SessionSummary } from './sessions'
import type { Progress, Stop } from './loop'
import type { Wakeup } from './wakeup'
import type { GhosttySkin } from '../main/ghostty'
import type { Transcript } from './transcript'
import type { Attachment } from './image'
import type { FileDiff } from './diff'
import type { TeamBoard } from '../main/team'
import type { TaskStatus } from './team'
import type { TeammateEvent } from './teammate'

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
  /** PR の差分。読むのは main（`shared/patch.ts`）で、renderer には形にしてから渡す */
  forgePullDiff(owner: string, repo: string, index: number): Promise<FileDiff[]>
  forgeCreatePull(owner: string, repo: string, input: { title: string; head: string; base: string; body?: string }): Promise<ForgejoPull>
  /**
   * Actions の実行（GOAL.md 測り方「Izuna がその状態を読める」）。`ref` を渡せばそのブランチだけ。
   * Actions が無効なら空。畳むのは `shared/ci.ts`
   */
  forgeRuns(owner: string, repo: string, ref?: string): Promise<ForgejoRun[]>
  forgeEnsureRepo(name: string): Promise<ForgejoRepo>
  /**
   * トークンの一覧。**消すのはここからできない**（Forgejo が
   * パスワード認証を要求する）ので、画面は見せるところまでをやる。
   */
  forgeTokens(): Promise<{ tokens: ForgejoToken[]; mineLast8: string | null; settingsUrl: string }>
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
  /** その remote のブランチ一覧。作業ブランチが GitHub に漏れていないかを見る（`shared/remote.ts`） */
  remoteHeads(cwd: string, remote: string): Promise<string[]>
  /** remote のブランチを消す。7 手目「sandbox の作業ブランチは捨てる」。main / master は拒む */
  deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<string>
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
  /**
   * 共有フォルダの盤面（§16）。**`paths` の重なりは実行役を起こす前に見る**。
   * 読むだけ。書くのは札の状態だけで、それも下の 1 本に限る。
   */
  teamBoard(id: SessionId): Promise<TeamBoard | null>
  setTaskStatus(id: SessionId, taskId: string, status: TaskStatus): Promise<boolean>
  /** 作業ディレクトリからリポジトリと worktree 一覧を引く */
  repo(cwd: string): Promise<RepoInfo>
  removeWorktree(cwd: string, path: string, force?: boolean): Promise<void>
  worktreeStatus(path: string): Promise<WorktreeStatus>
  start(input: StartSessionInput): Promise<SessionId>
  /** 画像は本文より前に置いて渡す（指示は画像を見た後でしか意味を持たない） */
  send(id: SessionId, text: string, images?: Attachment[]): Promise<void>
  respondPermission(answer: PermissionAnswer): Promise<void>
  slashCommands(id: SessionId): Promise<SlashCommand[]>
  setPermissionMode(id: SessionId, mode: PermissionMode): Promise<void>
  setModel(id: SessionId, model?: string): Promise<void>
  interrupt(id: SessionId): Promise<void>
  stop(id: SessionId): Promise<void>
  /**
   * 過去のセッション一覧（CLAUDE.md §18）。**保存層は自作していない** ——
   * `~/.claude/projects/` を走査するので、ターミナルの `claude` で
   * 起こしたセッションもここに出る。
   */
  /**
   * 利用者の Ghostty のテーマ。**無ければ null**（既定の色で出る）。
   * ターミナルが既に ghostty なのに、アプリの色だけ別なのは筋が通らない。
   */
  ghosttySkin(): Promise<GhosttySkin | null>

  /**
   * 自律ループ。**文脈を毎回捨てて回す**（§23）。
   * 承認は迂回しない —— 権限モードは人が選んだままである。
   */
  startLoop(input: { id: SessionId; maxIterations: number }): Promise<void>
  stopLoop(id: SessionId): Promise<void>
  loopProgress(id: SessionId): Promise<Progress>

  /** あとで自動的に再開する予約。過ぎたものは勝手に走らせない */
  listWakeups(): Promise<Wakeup[]>
  addWakeup(input: { id: SessionId; minutes: number; prompt: string }): Promise<Wakeup>
  removeWakeup(wakeupId: string): Promise<void>
  fireWakeup(wakeupId: string): Promise<void>

  /** コミット文の下書き。差分の中身は渡さない */
  draftCommitMessage(id: SessionId): Promise<void>
  /**
   * 差分のレビューを、**いまの会話に**頼む。
   * 別のセッションを起こすと、この作業で分かったことが使えない。
   */
  requestReview(id: SessionId, input: { base: string; pull?: number }): Promise<void>

  listSessions(): Promise<SessionSummary[]>
  /**
   * 記録から会話を組み立て直す。**組み立ては main でやる** ——
   * 記録は実測で 19MB あり、行のまま renderer に渡すと IPC が詰まる。
   */
  replaySession(sessionId: string): Promise<Transcript>

  /**
   * 頁を窓の中に埋めて見る（§32）。Forgejo と GitHub の頁だけ。
   * 置く場所は renderer が測って送る。閉じるまで renderer の上に重なる
   */
  previewOpen(url: string, bounds: { x: number; y: number; width: number; height: number }): Promise<void>
  previewBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void>
  previewClose(): Promise<void>

  /** main からの通知を受ける。返り値を呼ぶと購読をやめる */
  onEvent(handler: (event: SessionEvent) => void): () => void
}

/** main から renderer に流れるもの */
export type SessionEvent =
  | { kind: 'message'; id: SessionId; message: SDKMessage }
  /** 誰も答えないまま期限が来た承認。画面から札を消す */
  | { kind: 'permissionExpired'; id: SessionId; requestId: string }
  /** 自律ループが 1 周した */
  | { kind: 'loopProgress'; id: SessionId; progress: Progress; iteration: number }
  /** 自律ループが止まった。理由を必ず持つ */
  | { kind: 'loopStopped'; id: SessionId; stop: Stop }
  /** 予約の時刻が来た */
  | { kind: 'wokeUp'; id: SessionId; prompt: string }
  /** 実行役の節目（開いた・手を止めた・worktree を作った…）。hook で拾う（§12） */
  | { kind: 'teammate'; id: SessionId; event: TeammateEvent }
  | { kind: 'permission'; id: SessionId; request: PermissionRequest }
  | { kind: 'error'; id: SessionId; message: string }
  | { kind: 'exit'; id: SessionId }

export type TerminalEvent =
  | { id: string; kind: 'data'; data: string }
  | { id: string; kind: 'exit'; code: number }


/** チャネル名は 1 箇所で決める。文字列を各所に散らさない */
export const CH = {
  forgeFacts: 'izuna:forge:facts',
  forgeFix: 'izuna:forge:fix',
  forgeRepos: 'izuna:forge:repos',
  forgePulls: 'izuna:forge:pulls',
  forgePullDiff: 'izuna:forge:pull-diff',
  forgeCreatePull: 'izuna:forge:create-pull',
  forgeRuns: 'izuna:forge:runs',
  forgeEnsureRepo: 'izuna:forge:ensure-repo',
  forgeTokens: 'izuna:forge:tokens',
  ghStatus: 'izuna:gh:status',
  ghIssues: 'izuna:gh:issues',
  ghPulls: 'izuna:gh:pulls',
  ghCreatePull: 'izuna:gh:create-pull',
  remotes: 'izuna:git:remotes',
  ensureSandboxRemote: 'izuna:git:ensure-sandbox',
  currentBranch: 'izuna:git:branch',
  defaultBranch: 'izuna:git:default-branch',
  isPushed: 'izuna:git:is-pushed',
  remoteHeads: 'izuna:git:remote-heads',
  deleteRemoteBranch: 'izuna:git:delete-remote-branch',
  push: 'izuna:git:push',
  commitsSince: 'izuna:git:commits',
  openTerminal: 'izuna:term:open',
  writeTerminal: 'izuna:term:write',
  resizeTerminal: 'izuna:term:resize',
  closeTerminal: 'izuna:term:close',
  terminalEvent: 'izuna:term:event',
  configInfo: 'izuna:config:info',
  ghosttySkin: 'izuna:ghostty:skin',
  startLoop: 'izuna:loop:start',
  stopLoop: 'izuna:loop:stop',
  loopProgress: 'izuna:loop:progress',
  listWakeups: 'izuna:wakeup:list',
  addWakeup: 'izuna:wakeup:add',
  removeWakeup: 'izuna:wakeup:remove',
  fireWakeup: 'izuna:wakeup:fire',
  draftCommitMessage: 'izuna:commit:draft',
  requestReview: 'izuna:review:request',
  listSessions: 'izuna:sessions:list',
  replaySession: 'izuna:sessions:replay',
  previewOpen: 'izuna:preview:open',
  previewBounds: 'izuna:preview:bounds',
  previewClose: 'izuna:preview:close',
  findRepos: 'izuna:repos:find',
  pickDirectory: 'izuna:repos:pick',
  ipcVersion: 'izuna:ipc-version',
  teamPath: 'izuna:team:path',
  teamBoard: 'izuna:team:board',
  setTaskStatus: 'izuna:team:task-status',
  repo: 'izuna:repo',
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

/**
 * renderer と main の版。**両方に同じ値が焼かれる。**
 *
 * `pnpm dev` は renderer を HMR で更新するが、**main の再起動は別**である。
 * 食い違ったまま動くと `No handler registered for '...'` のような、
 * 原因を指さないエラーになる（実際に 5 時間古い main で踏んだ）。
 *
 * **手で上げない。** 以前は口を足すたびに数字を上げる決まりで、上げ忘れても
 * 害は無い（検出できないだけ）とされていた。それは「検出しない」と同じである。
 * `CH` の鍵から導けば、口が増えたり減ったりした時点で必ず変わる（§27）。
 */
export const IPC_VERSION = ((): number => {
  let h = 5381
  for (const c of Object.keys(CH).sort().join('|')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0
  return h
})()

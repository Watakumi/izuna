import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { settle } from '../../shared/wait'
import { appendLog, ensureTeam, readBoard, setTaskStatus, teamInstructions, teamPathFor } from '../team'
import { applyFix, gatherFacts, type FixId } from '../forge/setup'
import { createPull, ensureRepo, listPulls, listRepos, listTokens, whoami } from '../forge/client'
import { loadToken } from '../forge/store'
import * as gh from '../forge/github'
import * as remote from '../git/remote'
import * as term from '../terminal'
import { findRepos, pickDirectory } from '../repos'
import { scanSessions, replaySession } from '../sessions'
import { loadGhosttySkin } from '../ghostty'
import { progressServer, readProgress, runLoop, type RunningLoop } from '../loop'
import { Wakeups } from '../wakeup'
import { canDraft, draftPrompt } from '../../shared/commit'
import { canReview, reviewPrompt } from '../../shared/review'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { TaskStatus } from '../../shared/team'
import type { Attachment } from '../../shared/image'
import { CONFIG_PATH, loadConfig } from '../config'
import { access } from 'node:fs/promises'
import { ClaudeSession } from '../claude/session'
import {
  listWorktrees,
  removeWorktree,
  repoName,
  repoRoot,
  worktreeStatus
} from '../git/worktree'
import { CH, IPC_VERSION, type PermissionAnswer, type RepoInfo, type SessionEvent, type SessionId, type StartSessionInput } from '../../shared/ipc'

/**
 * ClaudeSession を renderer に橋渡しする。
 *
 * セッション層は UI を知らない（§4 の原則）ので、知っているのはここだけ。
 * renderer には `shared/ipc.ts` に書いた面しか出さない。
 */

const sessions = new Map<SessionId, ClaudeSession>()
/** 回っているループ。セッションが終わったら必ず止める */
const loops = new Map<string, RunningLoop>()
/** セッションごとの共有フォルダと作業ディレクトリ。ループと予約が使う */
const teams = new Map<string, string>()
const cwds = new Map<string, string>()
const wakeups = new Wakeups()

function must(id: SessionId): ClaudeSession {
  const s = sessions.get(id)
  if (!s) throw new Error(`セッションが見つかりません: ${id}`)
  return s
}

export function registerSessionIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (event: SessionEvent): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(CH.event, event)
  }

  /** rootUrl は main 側で解決する。renderer に持たせない */
  const forgeRoot = async (): Promise<string> => {
    const url = (await gatherFacts()).config?.rootUrl
    if (!url) throw new Error('Forgejo の ROOT_URL が読めません。「Forgejo」画面で確認してください')
    return url
  }

  // 過去のセッション（§18）。走査するだけで、保存層は持たない
  ipcMain.handle(CH.ghosttySkin, () => loadGhosttySkin().catch(() => null))
  ipcMain.handle(CH.listSessions, () => scanSessions())
  ipcMain.handle(CH.replaySession, (_e, sessionId: string) => replaySession(sessionId))

  ipcMain.handle(CH.forgeFacts, () => gatherFacts())
  ipcMain.handle(CH.forgeRepos, async () => listRepos(await forgeRoot()))
  ipcMain.handle(CH.forgePulls, async (_e, owner: string, repo: string) =>
    listPulls(await forgeRoot(), owner, repo))
  ipcMain.handle(CH.forgeCreatePull, async (_e, owner: string, repo: string, input) =>
    createPull(await forgeRoot(), owner, repo, input))
  ipcMain.handle(CH.forgeEnsureRepo, async (_e, name: string) => ensureRepo(await forgeRoot(), name))
  ipcMain.handle(CH.forgeTokens, async () => {
    const root = await forgeRoot()
    const [user, token] = await Promise.all([whoami(root), loadToken()])
    return {
      tokens: await listTokens(root, user),
      mineLast8: token ? token.slice(-8) : null,
      settingsUrl: new URL('user/settings/applications', root).toString()
    }
  })

  ipcMain.handle(CH.ghStatus, (_e, cwd: string) => gh.ghStatus(cwd))
  ipcMain.handle(CH.ghIssues, (_e, cwd: string) => gh.listIssues(cwd))
  ipcMain.handle(CH.ghPulls, (_e, cwd: string) => gh.listPulls(cwd))
  ipcMain.handle(CH.ghCreatePull, (_e, cwd: string, input: gh.CreatePrInput) => gh.createPull(cwd, input))

  ipcMain.handle(CH.remotes, async (_e, cwd: string) =>
    remote.listRemotes(cwd, (await gatherFacts()).config?.rootUrl ?? null))
  ipcMain.handle(CH.ensureSandboxRemote, async (_e, cwd: string, owner: string, repo: string) =>
    remote.ensureSandboxRemote(cwd, await forgeRoot(), owner, repo))
  ipcMain.handle(CH.currentBranch, (_e, cwd: string) => remote.currentBranch(cwd))
  ipcMain.handle(CH.defaultBranch, (_e, cwd: string, r: string) => remote.defaultBranch(cwd, r))
  // sandbox は private なので資格情報が要る。**その根の URL を渡す**
  ipcMain.handle(CH.isPushed, async (_e, cwd: string, r: string, b: string) =>
    remote.isPushed(cwd, r, b, await forgeRoot().catch(() => null)))
  ipcMain.handle(CH.push, async (_e, cwd: string, r: string, b: string) =>
    remote.push(cwd, r, b, await forgeRoot().catch(() => null)))
  ipcMain.handle(CH.commitsSince, (_e, cwd: string, base: string) => remote.commitsSince(cwd, base))

  ipcMain.handle(CH.openTerminal, (_e, input: { cwd: string; cols: number; rows: number }) =>
    term.openTerminal(getWindow, CH.terminalEvent, input))
  ipcMain.handle(CH.writeTerminal, (_e, id: string, data: string) => term.writeTerminal(id, data))
  ipcMain.handle(CH.resizeTerminal, (_e, id: string, c: number, r: number) => term.resizeTerminal(id, c, r))
  ipcMain.handle(CH.closeTerminal, (_e, id: string) => term.closeTerminal(id))
  ipcMain.handle(CH.forgeFix, (_e, id: FixId) => applyFix(id))

  ipcMain.handle(CH.configInfo, async () => {
    const { ignored } = await loadConfig()
    const exists = await access(CONFIG_PATH).then(() => true).catch(() => false)
    return { path: CONFIG_PATH, ignored, exists }
  })
  ipcMain.handle(CH.findRepos, () => findRepos())
  ipcMain.handle(CH.pickDirectory, () => pickDirectory(getWindow()))
  ipcMain.handle(CH.ipcVersion, () => IPC_VERSION)
  ipcMain.handle(CH.teamPath, (_e, name: string) => teamPathFor(name))
  // 盤面は読むだけ。**壊れた札も落とさずに返す**（黙って消すと書いた本人が気づけない）
  ipcMain.handle(CH.teamBoard, async (_e, id: SessionId) => {
    const dir = teams.get(id)
    return dir ? await readBoard(dir) : null
  })
  ipcMain.handle(CH.setTaskStatus, async (_e, id: SessionId, taskId: string, status: TaskStatus) => {
    const dir = teams.get(id)
    if (!dir) return false
    const ok = await setTaskStatus(dir, taskId, status)
    if (ok) await appendLog(dir, { at: new Date().toISOString(), from: 'izuna', to: 'board',
      kind: 'status', target: taskId, note: status })
    return ok
  })

  ipcMain.handle(CH.repo, async (_e, cwd: string): Promise<RepoInfo> => {
    const [root, name, worktrees] = await Promise.all([
      repoRoot(cwd), repoName(cwd), listWorktrees(cwd)
    ])
    return { root, name, worktrees }
  })
  ipcMain.handle(CH.removeWorktree, (_e, cwd: string, path: string, force?: boolean) =>
    removeWorktree(cwd, path, force))
  ipcMain.handle(CH.worktreeStatus, (_e, path: string) => worktreeStatus(path))

  ipcMain.handle(CH.start, async (_e, input: StartSessionInput): Promise<SessionId> => {
    const id = randomUUID()
    // 共有フォルダを先に用意する。場所を教えるだけでは使われないので、
    // 規律ごと申し送りに書いて渡す（§12）
    const team = await ensureTeam(input.team ?? 'default')
    const session = new ClaudeSession({
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      resume: input.resume,
      // 利用者の端末のプラグイン hook を引き継がない（CLAUDE.md §7）。
      // 'project' は残す —— 外すとプロジェクトの CLAUDE.md が読まれなくなる。
      settingSources: ['project', 'local'],
      additionalDirectories: [team],
      appendSystemPrompt: teamInstructions(team),
      // 自律ループが進捗を申告するための口。**ループでなくても渡してよい**
      // （呼ばれなければ何も起きない）
      mcpServers: { izuna: progressServer(team) }
    })

    session.on('message', (message) => emit({ kind: 'message', id, message }))
    session.on('permission', (request) => emit({ kind: 'permission', id, request }))
    session.on('permissionExpired', (requestId) => emit({ kind: 'permissionExpired', id, requestId }))
    session.on('error', (err) => emit({ kind: 'error', id, message: err.message }))
    session.on('done', () => {
      void appendLog(team, { at: new Date().toISOString(), from: 'izuna', to: 'brain',
        kind: 'end', target: input.cwd, note: '終了' })
      sessions.delete(id)
      loops.get(id)?.stop()
      loops.delete(id)
      emit({ kind: 'exit', id })
    })
    teams.set(id, team)
    cwds.set(id, input.cwd)
    // log.md は Izuna が書く（§16）。追記のみ。**エージェントには書かせない**
    void appendLog(team, { at: new Date().toISOString(), from: 'izuna', to: 'brain',
      kind: 'start', target: input.cwd, note: input.resume ? '続きから' : '新規' })

    sessions.set(id, session)
    try {
      await session.start()
    } catch (err) {
      sessions.delete(id)
      throw err
    }
    return id
  })

  ipcMain.handle(CH.send, (_e, id: SessionId, text: string, images?: Attachment[]) => {
    must(id).send(text, images ?? [])
  })

  // ── 自律ループ（§23）──────────────────────────────────────
  // **画面にはファイルの場所を持たせない。** セッションから引く
  ipcMain.handle(CH.loopProgress, (_e, id: SessionId) => readProgress(teams.get(id) ?? ''))
  ipcMain.handle(CH.stopLoop, (_e, id: SessionId) => {
    loops.get(id)?.stop()
    loops.delete(id)
  })
  ipcMain.handle(CH.startLoop, async (_e, input: { id: SessionId; maxIterations: number }) => {
    const session = must(input.id)
    if (loops.has(input.id)) throw new Error('このセッションでは既にループが回っています')
    const teamDir = teams.get(input.id)
    if (!teamDir) throw new Error('共有フォルダが分かりません')

    /**
     * **1 反復 = 1 ターン。** 文脈を捨てるのは CLI 側の仕事ではないので、
     * ここでは「送って、結果が返るまで待つ」だけにする。
     * 引き継ぎは `progress.json` に入っている（`shared/loop.ts` の註）。
     */
    const runIteration = (prompt: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const onMessage = (m: SDKMessage): void => {
          if (m.type !== 'result') return
          cleanup()
          resolve()
        }
        const onError = (err: Error): void => { cleanup(); reject(err) }
        const cleanup = (): void => {
          session.off('message', onMessage)
          session.off('error', onError)
        }
        session.on('message', onMessage)
        session.on('error', onError)
        session.send(prompt)
      })

    const loop = runLoop({
      teamDir,
      maxIterations: input.maxIterations,
      runIteration,
      onProgress: (progress, iteration) => emit({ kind: 'loopProgress', id: input.id, progress, iteration })
    })
    loops.set(input.id, loop)
    void loop.done.then((stop) => {
      loops.delete(input.id)
      emit({ kind: 'loopStopped', id: input.id, stop })
    })
  })

  // ── 起床の予約 ────────────────────────────────────────────
  /**
   * 時が来たら、そのセッションに送る。
   *
   * **もう無いセッションには送らない。** アプリを閉じたあとの予約は
   * `overdue` として残り、人が改めて起こす（§23）。
   */
  wakeups.onFire((w) => {
    const session = sessions.get(w.sessionId)
    if (!session) return
    session.send(w.prompt)
    emit({ kind: 'wokeUp', id: w.sessionId, prompt: w.prompt })
  })
  void wakeups.start()

  ipcMain.handle(CH.listWakeups, () => wakeups.list())
  ipcMain.handle(CH.removeWakeup, (_e, wakeupId: string) => wakeups.remove(wakeupId))
  ipcMain.handle(CH.fireWakeup, async (_e, wakeupId: string) => { await wakeups.fireNow(wakeupId) })
  ipcMain.handle(CH.addWakeup, (_e, input: { id: SessionId; minutes: number; prompt: string }) =>
    wakeups.add({
      sessionId: input.id,
      cwd: cwds.get(input.id) ?? '',
      prompt: input.prompt,
      fireAt: Date.now() + input.minutes * 60_000
    }))

  // ── コミット文の下書き ────────────────────────────────────
  ipcMain.handle(CH.draftCommitMessage, async (_e, id: SessionId) => {
    const session = must(id)
    const context = await remote.commitContext(cwds.get(id) ?? '')
    if (!canDraft(context)) throw new Error('コミットする変更がありません')
    // **会話に流す。** 別のセッションを起こすと、この作業の文脈が使えない
    session.send(draftPrompt(context))
  })
  ipcMain.handle(CH.requestReview, async (_e, id: SessionId, input: { base: string; pull?: number }) => {
    const session = must(id)
    const head = await remote.currentBranch(cwds.get(id) ?? '')
    const context = { head, base: input.base, pull: input.pull ?? null }
    if (!canReview(context)) throw new Error('何と比べるかが決まりません')
    // **差分は渡さない。** エージェントは同じ作業ディレクトリで git を持っている
    session.send(reviewPrompt(context))
  })
  ipcMain.handle(CH.slashCommands, (_e, id: SessionId) => must(id).slashCommands())
  ipcMain.handle(CH.interrupt, (_e, id: SessionId) => must(id).interrupt())
  ipcMain.handle(CH.setPermissionMode, (_e, id: SessionId, mode: PermissionMode) =>
    must(id).setPermissionMode(mode))
  ipcMain.handle(CH.setModel, (_e, id: SessionId, model?: string) => must(id).setModel(model))

  ipcMain.handle(CH.respondPermission, (_e, answer: PermissionAnswer) => {
    must(answer.id).respondToPermission(answer.requestId, answer.result)
  })

  ipcMain.handle(CH.stop, async (_e, id: SessionId) => {
    const s = sessions.get(id)
    if (!s) return
    sessions.delete(id)
    await s.stop()
  })
}

/**
 * アプリ終了時に取り残さない。放置すると claude が孤児プロセスになる。
 *
 * **必ず返る。** 後片付けが終わらないせいでアプリが終了できない、という
 * 事態を作らない（実際にやらかして Ctrl+C が効かなくなった）。
 * 上限を過ぎたら諦めて先へ進む —— 孤児が 1 つ残るほうが、
 * 終われないアプリよりましである。
 */
export async function stopAllSessions(timeoutMs = 3000): Promise<void> {
  // シェルも取り残さない。PTY は同期で閉じられるので待ちに含めない
  term.closeAllTerminals()
  const all = [...sessions.values()]
  sessions.clear()
  if (all.length === 0) return
  await settle(Promise.all(all.map((s) => s.stop())), timeoutMs)
}

import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { settle } from '../../shared/wait'
import { ensureTeam, teamInstructions, teamPathFor } from '../team'
import { applyFix, gatherFacts, type FixId } from '../forge/setup'
import { createPull, ensureRepo, listPulls, listRepos } from '../forge/client'
import * as gh from '../forge/github'
import * as remote from '../git/remote'
import * as term from '../terminal'
import { findRepos, pickDirectory } from '../repos'
import { scanSessions, readSessionLines } from '../sessions'
import { loadGhosttySkin } from '../ghostty'
import { replay } from '../../shared/sessions'
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
  ipcMain.handle(CH.replaySession, async (_e, sessionId: string) => replay(await readSessionLines(sessionId)))

  ipcMain.handle(CH.forgeFacts, () => gatherFacts())
  ipcMain.handle(CH.forgeRepos, async () => listRepos(await forgeRoot()))
  ipcMain.handle(CH.forgePulls, async (_e, owner: string, repo: string) =>
    listPulls(await forgeRoot(), owner, repo))
  ipcMain.handle(CH.forgeCreatePull, async (_e, owner: string, repo: string, input) =>
    createPull(await forgeRoot(), owner, repo, input))
  ipcMain.handle(CH.forgeEnsureRepo, async (_e, name: string) => ensureRepo(await forgeRoot(), name))

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
      appendSystemPrompt: teamInstructions(team)
    })

    session.on('message', (message) => emit({ kind: 'message', id, message }))
    session.on('permission', (request) => emit({ kind: 'permission', id, request }))
    session.on('error', (err) => emit({ kind: 'error', id, message: err.message }))
    session.on('done', () => {
      sessions.delete(id)
      emit({ kind: 'exit', id })
    })

    sessions.set(id, session)
    try {
      await session.start()
    } catch (err) {
      sessions.delete(id)
      throw err
    }
    return id
  })

  ipcMain.handle(CH.send, (_e, id: SessionId, text: string) => { must(id).send(text) })
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

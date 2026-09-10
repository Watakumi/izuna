import { ipcMain, type BrowserWindow } from 'electron'
import { access } from 'node:fs/promises'
import { teamPathFor } from '../team'
import { adoptToken, applyFix, gatherFacts } from '../forge/setup'
import { claudeStatus } from '../claude/status'
import {
  createPull,
  ensureRepo,
  listPulls,
  listRepos,
  listRuns,
  listTokens,
  pullDiff,
  whoami,
  closePull,
  deleteRepo
} from '../forge/client'
import { loadToken } from '../forge/store'
import * as gh from '../forge/github'
import * as remote from '../git/remote'
import * as term from '../terminal'
import { findRepos, pickDirectory } from '../repos'
import { scanSessions, replaySession } from '../sessions'
import { loadGhosttySkin } from '../ghostty'
import { CONFIG_PATH, loadConfig } from '../config'
import { listWorktrees, removeWorktree, repoName, repoRoot, worktreeStatus } from '../git/worktree'
import { SessionHub } from '../hub'
import { notify } from '../notify'
import { noticeFor } from '../../shared/notice'
import { parseUnifiedDiff } from '../../shared/patch'
import { canPreview } from '../../shared/links'
import { closePreview, movePreview, openPreview } from '../preview'
import { CH, IPC_VERSION, type IzunaApi, type SessionEvent } from '../../shared/ipc'

/**
 * renderer の口を main の関数に繋ぐ。**ここには判断を置かない。**
 *
 * セッションに紐づくもの（起動・ループ・起床・レビュー依頼）は `main/hub.ts` が持ち、
 * 検査もそちらでする。ここに残るのは 1 行ずつの橋渡しだけで、
 * それも `Handlers` の型で「口の数だけ手がある」ことを型検査に見させる（§28）。
 */

/** 購読以外の口すべて。1 つ欠けても 1 つ余っても型検査で落ちる */
type Handlers = {
  [K in Exclude<keyof IzunaApi, 'onEvent' | 'onTerminal'>]: (
    ...args: Parameters<IzunaApi[K]>
  ) => ReturnType<IzunaApi[K]> | Awaited<ReturnType<IzunaApi[K]>>
}

let hub: SessionHub | null = null

/** WebContentsView は整数の px しか受けない。renderer の実測は小数で来る */
const roundRect = (r: {
  x: number
  y: number
  width: number
  height: number
}): { x: number; y: number; width: number; height: number } => ({
  x: Math.round(r.x),
  y: Math.round(r.y),
  width: Math.round(r.width),
  height: Math.round(r.height)
})

export function registerSessionIpc(getWindow: () => BrowserWindow | null): void {
  const emit = (event: SessionEvent): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(CH.event, event)
    /**
     * **窓が前に無いときだけ OS の通知を出す。** 見ているときに鳴らすと邪魔で、
     * 見ていないときに黙っていると承認を取りこぼす（docs/NIMBALYST.md §7 の 1）。
     * 押されたら窓を前に出す。
     */
    if (win && !win.isDestroyed() && !win.isFocused()) {
      const notice = noticeFor(event, h.labelOf(event.id))
      if (notice)
        notify(notice, () => {
          if (!win.isDestroyed()) {
            win.show()
            win.focus()
          }
        })
    }
  }
  // emit は h を閉じ込めるが、呼ばれるのは登録より後（constructor は購読を張るだけ）
  const h: SessionHub = new SessionHub(emit)
  hub = h
  void h.open()

  /** rootUrl は main 側で解決する。renderer に持たせない */
  const forgeRoot = async (): Promise<string> => {
    const url = (await gatherFacts()).config?.rootUrl
    if (!url) throw new Error('Forgejo の ROOT_URL が読めません。「Forgejo」画面で確認してください')
    return url
  }

  const handlers: Handlers = {
    // 過去のセッション（§18）。走査するだけで、保存層は持たない
    ghosttySkin: () => loadGhosttySkin().catch(() => null),
    listSessions: () => scanSessions(),
    replaySession: (sessionId) => replaySession(sessionId),

    // 頁の埋め込み（§32）。行き先は Forgejo と GitHub だけ
    previewOpen: async (url, bounds) => {
      const root = (await gatherFacts()).config?.rootUrl ?? null
      if (!canPreview(url, root))
        throw new Error(`中で見られるのは Forgejo と GitHub の頁だけです: ${url}`)
      const win = getWindow()
      if (!win) throw new Error('窓がありません')
      openPreview(win, url, roundRect(bounds))
    },
    previewBounds: (bounds) => movePreview(roundRect(bounds)),
    previewClose: () => closePreview(),

    claudeStatus: () => claudeStatus(),
    forgeFacts: () => gatherFacts(),
    forgeFix: (id) => applyFix(id),
    forgeRepos: async () => listRepos(await forgeRoot()),
    forgePulls: async (owner, repo) => listPulls(await forgeRoot(), owner, repo),
    forgePullDiff: async (owner, repo, index) =>
      parseUnifiedDiff(await pullDiff(await forgeRoot(), owner, repo, index)),
    forgeCreatePull: async (owner, repo, input) =>
      createPull(await forgeRoot(), owner, repo, input),
    forgeRuns: async (owner, repo, ref) => listRuns(await forgeRoot(), owner, repo, ref),
    forgeClosePull: async (owner, repo, index) => closePull(await forgeRoot(), owner, repo, index),
    forgeDeleteRepo: async (owner, repo) => {
      await deleteRepo(await forgeRoot(), owner, repo)
      return `${owner}/${repo} を消しました`
    },
    forgeEnsureRepo: async (name) => ensureRepo(await forgeRoot(), name),
    forgeSetToken: async (token) => adoptToken(await forgeRoot(), token),
    forgeTokens: async () => {
      const root = await forgeRoot()
      const [user, token] = await Promise.all([whoami(root), loadToken()])
      return {
        tokens: await listTokens(root, user),
        mineLast8: token ? token.slice(-8) : null,
        settingsUrl: new URL('user/settings/applications', root).toString()
      }
    },

    ghStatus: (cwd) => gh.ghStatus(cwd),
    ghIssues: (cwd) => gh.listIssues(cwd),
    ghPulls: (cwd) => gh.listPulls(cwd),
    ghCreatePull: (cwd, input) => gh.createPull(cwd, input),

    remotes: async (cwd) => remote.listRemotes(cwd, (await gatherFacts()).config?.rootUrl ?? null),
    ensureSandboxRemote: async (cwd, owner, repo) =>
      remote.ensureSandboxRemote(cwd, await forgeRoot(), owner, repo),
    currentBranch: (cwd) => remote.currentBranch(cwd),
    defaultBranch: (cwd, r) => remote.defaultBranch(cwd, r),
    // sandbox は private なので資格情報が要る。**その根の URL を渡す**
    isPushed: async (cwd, r, b) => remote.isPushed(cwd, r, b, await forgeRoot().catch(() => null)),
    push: async (cwd, r, b) => remote.push(cwd, r, b, await forgeRoot().catch(() => null)),
    remoteHeads: async (cwd, r) => remote.remoteHeads(cwd, r, await forgeRoot().catch(() => null)),
    deleteRemoteBranch: async (cwd, r, b) =>
      remote.deleteRemoteBranch(cwd, r, b, await forgeRoot().catch(() => null)),
    commitsSince: (cwd, base) => remote.commitsSince(cwd, base),

    openTerminal: (input) => term.openTerminal(getWindow, CH.terminalEvent, input),
    writeTerminal: (id, data) => term.writeTerminal(id, data),
    resizeTerminal: (id, c, r) => term.resizeTerminal(id, c, r),
    closeTerminal: (id) => term.closeTerminal(id),

    configInfo: async () => {
      const { ignored } = await loadConfig()
      const exists = await access(CONFIG_PATH)
        .then(() => true)
        .catch(() => false)
      return { path: CONFIG_PATH, ignored, exists }
    },
    findRepos: () => findRepos(),
    pickDirectory: () => pickDirectory(getWindow()),
    ipcVersion: () => IPC_VERSION,
    teamPath: (name) => teamPathFor(name),

    repo: async (cwd) => {
      const [root, name, worktrees] = await Promise.all([
        repoRoot(cwd),
        repoName(cwd),
        listWorktrees(cwd)
      ])
      return { root, name, worktrees }
    },
    removeWorktree: (cwd, path, force) => removeWorktree(cwd, path, force),
    worktreeStatus: (path) => worktreeStatus(path),

    // ── セッションに紐づくもの。判断は hub ──────────────────
    start: (input) => h.start(input),
    send: (id, text, images) => h.send(id, text, images ?? []),
    respondPermission: (answer) => h.respondPermission(answer.id, answer.requestId, answer.result),
    slashCommands: (id) => h.slashCommands(id),
    setPermissionMode: (id, mode) => h.setPermissionMode(id, mode),
    setModel: (id, model) => h.setModel(id, model),
    interrupt: (id) => h.interrupt(id),
    stop: (id) => h.stop(id),
    teamBoard: (id) => h.teamBoard(id),
    setTaskStatus: (id, taskId, status) => h.setTaskStatus(id, taskId, status),
    startLoop: (input) => h.startLoop(input.id, input.maxIterations),
    stopLoop: (id) => h.stopLoop(id),
    loopProgress: (id) => h.loopProgress(id),
    listWakeups: () => h.listWakeups(),
    addWakeup: (input) => h.addWakeup(input.id, input.minutes, input.prompt),
    removeWakeup: (wakeupId) => h.removeWakeup(wakeupId),
    fireWakeup: (wakeupId) => h.fireWakeup(wakeupId),
    draftCommitMessage: (id) => h.draftCommitMessage(id),
    requestReview: (id, input) => h.requestReview(id, input.base, input.pull)
  }

  for (const [name, fn] of Object.entries(handlers)) {
    ipcMain.handle(CH[name as keyof typeof CH], (_e, ...args: unknown[]) =>
      (fn as (...a: unknown[]) => unknown)(...args)
    )
  }
}

/** アプリ終了時。シェルも取り残さない。PTY は同期で閉じられるので待ちに含めない */
export async function stopAllSessions(timeoutMs = 3000): Promise<void> {
  term.closeAllTerminals()
  await hub?.stopAll(timeoutMs)
}

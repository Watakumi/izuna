import { contextBridge, ipcRenderer } from 'electron'
import { CH, type IzunaApi, type TerminalEvent, type PermissionAnswer, type SessionEvent, type SessionId, type StartSessionInput } from '../shared/ipc'
import type { Attachment } from '../shared/image'

/**
 * renderer に出す面はここだけ。`contextIsolation` は既定のまま維持し、
 * `require` は渡さない。`shared/ipc.ts` の `IzunaApi` に無いものは出さない。
 *
 * **`@electron-toolkit/preload` の `electronAPI` は出さない。** あれは
 * `process.env` を丸ごと返すゲッターと、任意チャネルの `ipcRenderer` を
 * 持っている。renderer は一度も使っていなかった（2026-09-08 に数えた）。
 */
const izuna: IzunaApi = {
  forgeFacts: () => ipcRenderer.invoke(CH.forgeFacts),
  forgeFix: (id) => ipcRenderer.invoke(CH.forgeFix, id),
  forgeRepos: () => ipcRenderer.invoke(CH.forgeRepos),
  forgePulls: (owner, repo) => ipcRenderer.invoke(CH.forgePulls, owner, repo),
  forgeCreatePull: (owner, repo, input) => ipcRenderer.invoke(CH.forgeCreatePull, owner, repo, input),
  forgeEnsureRepo: (name) => ipcRenderer.invoke(CH.forgeEnsureRepo, name),
  forgeTokens: () => ipcRenderer.invoke(CH.forgeTokens),
  ghStatus: (cwd) => ipcRenderer.invoke(CH.ghStatus, cwd),
  ghIssues: (cwd) => ipcRenderer.invoke(CH.ghIssues, cwd),
  ghPulls: (cwd) => ipcRenderer.invoke(CH.ghPulls, cwd),
  ghCreatePull: (cwd, input) => ipcRenderer.invoke(CH.ghCreatePull, cwd, input),
  remotes: (cwd) => ipcRenderer.invoke(CH.remotes, cwd),
  ensureSandboxRemote: (cwd, owner, repo) => ipcRenderer.invoke(CH.ensureSandboxRemote, cwd, owner, repo),
  currentBranch: (cwd) => ipcRenderer.invoke(CH.currentBranch, cwd),
  defaultBranch: (cwd, r) => ipcRenderer.invoke(CH.defaultBranch, cwd, r),
  isPushed: (cwd, r, b) => ipcRenderer.invoke(CH.isPushed, cwd, r, b),
  push: (cwd, r, b) => ipcRenderer.invoke(CH.push, cwd, r, b),
  commitsSince: (cwd, base) => ipcRenderer.invoke(CH.commitsSince, cwd, base),
  ghosttySkin: () => ipcRenderer.invoke(CH.ghosttySkin),
  startLoop: (input) => ipcRenderer.invoke(CH.startLoop, input),
  stopLoop: (id) => ipcRenderer.invoke(CH.stopLoop, id),
  loopProgress: (id) => ipcRenderer.invoke(CH.loopProgress, id),
  listWakeups: () => ipcRenderer.invoke(CH.listWakeups),
  addWakeup: (input) => ipcRenderer.invoke(CH.addWakeup, input),
  removeWakeup: (wakeupId) => ipcRenderer.invoke(CH.removeWakeup, wakeupId),
  fireWakeup: (wakeupId) => ipcRenderer.invoke(CH.fireWakeup, wakeupId),
  draftCommitMessage: (id) => ipcRenderer.invoke(CH.draftCommitMessage, id),
  requestReview: (id: SessionId, input) => ipcRenderer.invoke(CH.requestReview, id, input),
  listSessions: () => ipcRenderer.invoke(CH.listSessions),
  replaySession: (sessionId) => ipcRenderer.invoke(CH.replaySession, sessionId),
  openTerminal: (input) => ipcRenderer.invoke(CH.openTerminal, input),
  writeTerminal: (id, data) => ipcRenderer.invoke(CH.writeTerminal, id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.invoke(CH.resizeTerminal, id, cols, rows),
  closeTerminal: (id) => ipcRenderer.invoke(CH.closeTerminal, id),
  onTerminal: (handler: (event: TerminalEvent) => void) => {
    const listener = (_e: unknown, event: TerminalEvent): void => handler(event)
    ipcRenderer.on(CH.terminalEvent, listener)
    return () => { ipcRenderer.off(CH.terminalEvent, listener) }
  },
  configInfo: () => ipcRenderer.invoke(CH.configInfo),
  findRepos: () => ipcRenderer.invoke(CH.findRepos),
  pickDirectory: () => ipcRenderer.invoke(CH.pickDirectory),
  ipcVersion: () => ipcRenderer.invoke(CH.ipcVersion),
  teamPath: (name: string) => ipcRenderer.invoke(CH.teamPath, name),
  teamBoard: (id) => ipcRenderer.invoke(CH.teamBoard, id),
  setTaskStatus: (id, taskId, status) => ipcRenderer.invoke(CH.setTaskStatus, id, taskId, status),
  repo: (cwd: string) => ipcRenderer.invoke(CH.repo, cwd),
  removeWorktree: (cwd: string, path: string, force?: boolean) =>
    ipcRenderer.invoke(CH.removeWorktree, cwd, path, force),
  worktreeStatus: (path: string) => ipcRenderer.invoke(CH.worktreeStatus, path),
  start: (input: StartSessionInput) => ipcRenderer.invoke(CH.start, input),
  send: (id: SessionId, text: string, images?: Attachment[]) => ipcRenderer.invoke(CH.send, id, text, images),
  respondPermission: (answer: PermissionAnswer) => ipcRenderer.invoke(CH.respondPermission, answer),
  slashCommands: (id: SessionId) => ipcRenderer.invoke(CH.slashCommands, id),
  setPermissionMode: (id: SessionId, mode) => ipcRenderer.invoke(CH.setPermissionMode, id, mode),
  setModel: (id: SessionId, model?: string) => ipcRenderer.invoke(CH.setModel, id, model),
  interrupt: (id: SessionId) => ipcRenderer.invoke(CH.interrupt, id),
  stop: (id: SessionId) => ipcRenderer.invoke(CH.stop, id),
  onEvent: (handler: (event: SessionEvent) => void) => {
    const listener = (_e: unknown, event: SessionEvent): void => handler(event)
    ipcRenderer.on(CH.event, listener)
    return () => { ipcRenderer.off(CH.event, listener) }
  }
}

// contextIsolation を切った構成は作らない。切れていたら露出せずに落とす
if (!process.contextIsolated) throw new Error('contextIsolation が無効です。Izuna はこの構成では動かしません')
contextBridge.exposeInMainWorld('izuna', izuna)

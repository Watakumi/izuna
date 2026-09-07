import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { CH, type IzunaApi, type PermissionAnswer, type SessionEvent, type SessionId, type StartSessionInput } from '../shared/ipc'

/**
 * renderer に出す面はここだけ。`contextIsolation` は既定のまま維持し、
 * `require` は渡さない。`shared/ipc.ts` の `IzunaApi` に無いものは出さない。
 */
const izuna: IzunaApi = {
  forgeFacts: () => ipcRenderer.invoke(CH.forgeFacts),
  forgeFix: (id) => ipcRenderer.invoke(CH.forgeFix, id),
  forgeRepos: () => ipcRenderer.invoke(CH.forgeRepos),
  forgePulls: (owner, repo) => ipcRenderer.invoke(CH.forgePulls, owner, repo),
  forgeCreatePull: (owner, repo, input) => ipcRenderer.invoke(CH.forgeCreatePull, owner, repo, input),
  forgeEnsureRepo: (name) => ipcRenderer.invoke(CH.forgeEnsureRepo, name),
  ghStatus: (cwd) => ipcRenderer.invoke(CH.ghStatus, cwd),
  ghIssues: (cwd) => ipcRenderer.invoke(CH.ghIssues, cwd),
  ghPulls: (cwd) => ipcRenderer.invoke(CH.ghPulls, cwd),
  ghCreatePull: (cwd, input) => ipcRenderer.invoke(CH.ghCreatePull, cwd, input),
  remotes: (cwd) => ipcRenderer.invoke(CH.remotes, cwd),
  ensureWorkshopRemote: (cwd, owner, repo) => ipcRenderer.invoke(CH.ensureWorkshopRemote, cwd, owner, repo),
  currentBranch: (cwd) => ipcRenderer.invoke(CH.currentBranch, cwd),
  isPushed: (cwd, r, b) => ipcRenderer.invoke(CH.isPushed, cwd, r, b),
  push: (cwd, r, b) => ipcRenderer.invoke(CH.push, cwd, r, b),
  commitsSince: (cwd, base) => ipcRenderer.invoke(CH.commitsSince, cwd, base),
  repo: (cwd: string) => ipcRenderer.invoke(CH.repo, cwd),
  createWorktree: (cwd: string, branch: string) => ipcRenderer.invoke(CH.createWorktree, cwd, branch),
  removeWorktree: (cwd: string, path: string, force?: boolean) =>
    ipcRenderer.invoke(CH.removeWorktree, cwd, path, force),
  worktreeStatus: (path: string) => ipcRenderer.invoke(CH.worktreeStatus, path),
  start: (input: StartSessionInput) => ipcRenderer.invoke(CH.start, input),
  send: (id: SessionId, text: string) => ipcRenderer.invoke(CH.send, id, text),
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

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('izuna', izuna)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.izuna = izuna
}

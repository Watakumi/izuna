import { randomUUID } from 'node:crypto'
import { ipcMain, type BrowserWindow } from 'electron'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeSession } from '../claude/session'
import { CH, type PermissionAnswer, type SessionEvent, type SessionId, type StartSessionInput } from '../../shared/ipc'

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

  ipcMain.handle(CH.start, async (_e, input: StartSessionInput): Promise<SessionId> => {
    const id = randomUUID()
    const session = new ClaudeSession({
      cwd: input.cwd,
      model: input.model,
      permissionMode: input.permissionMode,
      resume: input.resume,
      // 利用者の端末のプラグイン hook を引き継がない（CLAUDE.md §7）。
      // 'project' は残す —— 外すとプロジェクトの CLAUDE.md が読まれなくなる。
      settingSources: ['project', 'local']
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

/** アプリ終了時に取り残さない。放置すると claude が孤児プロセスになる */
export async function stopAllSessions(): Promise<void> {
  const all = [...sessions.values()]
  sessions.clear()
  await Promise.all(all.map((s) => s.stop().catch(() => undefined)))
}

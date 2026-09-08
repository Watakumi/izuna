import { useCallback, useEffect, useState } from 'react'
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { PermissionRequest } from '../../main/claude/session'
import type { SessionId, StartSessionInput } from '../../shared/ipc'
import type { Progress, Stop } from '../../shared/loop'
import { appendUserText, applyMessage, emptyTranscript, type Transcript } from '../../shared/transcript'
import { teammateNotice } from '../../shared/teammate'

/**
 * 複数セッションの状態（段3）。
 *
 * セッションごとに worktree が分かれるので、**状態も完全に分ける**。
 * 取り違えると、片方の承認をもう片方に返すような事故になる。
 * 届いたイベントは必ず `event.id` で宛先を決め、「いま開いている方」には送らない。
 */

export interface Panel {
  id: SessionId
  /** 一覧に出す名前。ブランチ名、無ければディレクトリ名 */
  label: string
  cwd: string
  branch: string | null
  /** 共有フォルダの名前（§12） */
  team: string
  transcript: Transcript
  pending: PermissionRequest | null
  /** 入力欄はセッションごとに保つ。切り替えで書きかけが消えない */
  prompt: string
  commands: SlashCommand[]
  /** 終了したセッション。閉じるまで一覧には残す */
  ended: boolean
  /** 自律ループが回っているか（§23）。回っていなければ null */
  loop: { progress: Progress; iteration: number; stop: Stop | null } | null
}

export interface Sessions {
  panels: Panel[]
  activeId: SessionId | null
  active: Panel | null
  setActive: (id: SessionId) => void
  open: (
    input: StartSessionInput & {
      label: string; branch: string | null; team: string
      /** 起こしたあとに最初に送る依頼。空なら送らない */
      initialPrompt?: string
    }
  ) => Promise<SessionId>
  close: (id: SessionId) => Promise<void>
  update: (id: SessionId, change: (panel: Panel) => Panel) => void
  /** 承認待ちを抱えているもの。並列で一番埋もれやすいので数えて出す */
  waiting: Panel[]
}

export function useSessions(): Sessions {
  const [panels, setPanels] = useState<Panel[]>([])
  const [activeId, setActiveId] = useState<SessionId | null>(null)

  const update = useCallback((id: SessionId, change: (panel: Panel) => Panel) => {
    setPanels((prev) => prev.map((p) => (p.id === id ? change(p) : p)))
  }, [])

  useEffect(() => window.izuna.onEvent((event) => {
    // 宛先は必ず event.id で決める。active に流し込むと取り違える
    setPanels((prev) => prev.map((p) => {
      if (p.id !== event.id) return p
      switch (event.kind) {
        case 'message':
          return { ...p, transcript: applyMessage(p.transcript, event.message) }
        case 'permission':
          return { ...p, pending: event.request }
        case 'permissionExpired':
          // **出したままの札を消す。** 期限が来た要求はもう答えられない
          return p.pending?.id === event.requestId ? { ...p, pending: null } : p
        case 'loopProgress':
          return { ...p, loop: { progress: event.progress, iteration: event.iteration, stop: null } }
        case 'loopStopped':
          return {
            ...p,
            loop: p.loop ? { ...p.loop, stop: event.stop } : null,
            transcript: {
              ...p.transcript,
              items: [...p.transcript.items, {
                kind: 'notice', id: `loop${p.transcript.items.length}`,
                tone: event.stop.reason === 'completed' ? 'info' : 'bad',
                text: `ループが止まりました: ${event.stop.detail}`
              }]
            }
          }
        case 'wokeUp':
          return {
            ...p,
            transcript: {
              ...p.transcript,
              items: [...p.transcript.items, {
                kind: 'notice', id: `wake${p.transcript.items.length}`, tone: 'info',
                text: `予約の時刻になったので送りました: ${event.prompt.slice(0, 60)}`
              }]
            }
          }
        case 'teammate':
          // 実行役の節目は会話に一言で挟む。埋もれさせない（柱 1）
          return {
            ...p,
            transcript: {
              ...p.transcript,
              items: [...p.transcript.items, {
                kind: 'notice', id: `tm${p.transcript.items.length}`, tone: 'info',
                text: teammateNotice(event.event)
              }]
            }
          }
        case 'error':
          return {
            ...p,
            transcript: {
              ...p.transcript,
              running: false,
              items: [...p.transcript.items,
                { kind: 'notice', id: `e${p.transcript.items.length}`, tone: 'bad', text: event.message }]
            }
          }
        case 'exit':
          return { ...p, ended: true, pending: null }
        default:
          return p
      }
    }))
  }), [])

  const open = useCallback(async (
    input: StartSessionInput & { label: string; branch: string | null; team: string; initialPrompt?: string }
  ): Promise<SessionId> => {
    const id = await window.izuna.start({
      cwd: input.cwd, model: input.model, permissionMode: input.permissionMode,
      resume: input.resume, team: input.team
    })
    const commands = await window.izuna.slashCommands(id)

    // 続きから起こしたときは、**記録から会話を戻す**（CLAUDE.md §18）。
    // 戻さないと、resume したのに真っ白な画面から始まって
    // 「本当に続いているのか」が分からない。
    const prior = input.resume
      ? await window.izuna.replaySession(input.resume).catch(() => null)
      : null

    setPanels((prev) => [...prev, {
      id, label: input.label, cwd: input.cwd, branch: input.branch, team: input.team,
      transcript: prior ?? emptyTranscript(), pending: null, prompt: '', commands, ended: false, loop: null
    }])
    setActiveId(id)

    // 起こす理由がそのまま最初の依頼になる。人に打ち直させない
    const first = input.initialPrompt?.trim()
    if (first) {
      setPanels((prev) => prev.map((p) => (p.id === id
        ? { ...p, transcript: appendUserText(p.transcript, first, 'u0') }
        : p)))
      void window.izuna.send(id, first)
    }
    return id
  }, [])

  const close = useCallback(async (id: SessionId): Promise<void> => {
    setPanels((prev) => {
      const next = prev.filter((p) => p.id !== id)
      setActiveId((current) => (current === id ? (next.at(-1)?.id ?? null) : current))
      return next
    })
    await window.izuna.stop(id).catch(() => undefined)
  }, [])

  const active = panels.find((p) => p.id === activeId) ?? null
  const waiting = panels.filter((p) => p.pending !== null)

  return { panels, activeId, active, setActive: setActiveId, open, close, update, waiting }
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Meeting } from '../../src/renderer/src/components/Meeting'
import { DEFAULT_ROLES, type MeetingSummary, type MeetingView } from '../../src/shared/meeting'
import type { SessionEvent } from '../../src/shared/ipc'

afterEach(cleanup)

let listeners: Array<(e: SessionEvent) => void> = []
let started: unknown[] = []
let said: Array<[string, string]> = []
let closed: string[] = []
let stopped: string[] = []
let list: MeetingSummary[] = []
let view: MeetingView

const emit = (e: SessionEvent): void => act(() => listeners.forEach((l) => l(e)))

beforeEach(() => {
  listeners = []
  started = []
  said = []
  closed = []
  stopped = []
  list = [
    {
      id: '20261006-131000',
      agenda: '同期をどうするか',
      cwd: '/w/notes',
      created: '2026-10-06T04:10:00.000Z',
      state: 'closed',
      roles: ['architect'],
      running: false
    }
  ]
  view = {
    meta: {
      id: '20261006-131000',
      agenda: '同期をどうするか',
      cwd: '/w/notes',
      roles: ['architect', 'security'],
      created: '2026-10-06T04:10:00.000Z',
      state: 'open'
    },
    entries: [
      { at: '2026-10-06T04:10:00.000Z', who: 'human', text: '同期をどうするか' },
      { at: '2026-10-06T04:10:05.000Z', who: 'moderator', text: '設計へ: どう思う' }
    ],
    minutes: '',
    running: true
  }
  ;(window as unknown as { izuna: unknown }).izuna = {
    meetings: async () => list,
    meetingRoles: async () => DEFAULT_ROLES,
    meetingRead: async () => view,
    meetingStart: async (input: unknown) => {
      started.push(input)
      return '20261006-131000'
    },
    meetingSay: async (id: string, text: string) => {
      said.push([id, text])
    },
    meetingClose: async (id: string) => {
      closed.push(id)
    },
    meetingStop: async (id: string) => {
      stopped.push(id)
    },
    findRepos: async () => [{ path: '/w/notes', name: 'notes', group: 'w' }],
    onEvent: (l: (e: SessionEvent) => void) => {
      listeners.push(l)
      return () => {
        listeners = listeners.filter((x) => x !== l)
      }
    }
  }
})

/** 会議（§39）。押した結果はその場に出る */
describe('会議', () => {
  it('新しい会議は、議題と参加者が揃うまで始められない', async () => {
    render(<Meeting cwd="/w/notes" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('同期をどうするか')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('反論')).toBeTruthy())
    const start = screen.getByText('始める') as HTMLButtonElement
    expect(start.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('議題'), { target: { value: '設定画面を作るか' } })
    // 既定の 3 人に検査を足す
    fireEvent.click(screen.getByText('検査'))
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    await waitFor(() => expect(started).toHaveLength(1))
    expect(started[0]).toEqual({
      cwd: '/w/notes',
      agenda: '設定画面を作るか',
      roles: ['architect', 'pdm', 'critic', 'tester']
    })
    // 始めたら、その会議を開く
    await waitFor(() => expect(screen.getByText('発言録')).toBeTruthy())
  })

  it('開いた会議は発言を順に出し、届いた発言と議事録をその場で足す', async () => {
    render(<Meeting cwd={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('議事録あり')).toBeTruthy())
    fireEvent.click(screen.getByText('同期をどうするか'))
    await waitFor(() => expect(screen.getByText('設計へ: どう思う')).toBeTruthy())
    expect(screen.getByText('司会が進めています…')).toBeTruthy()

    emit({ kind: 'meeting', id: '20261006-131000', event: { kind: 'speaking', who: 'architect' } })
    expect(screen.getByText('設計が話しています…')).toBeTruthy()
    emit({
      kind: 'meeting',
      id: '20261006-131000',
      event: {
        kind: 'said',
        entry: { at: '2026-10-06T04:10:09.000Z', who: 'architect', text: '同期しない' }
      }
    })
    expect(screen.getByText('同期しない')).toBeTruthy()
    // ほかの会議の出来事は混ぜない
    emit({ kind: 'meeting', id: 'other', event: { kind: 'error', message: 'よその失敗' } })
    expect(screen.queryByText('よその失敗')).toBeNull()

    emit({
      kind: 'meeting',
      id: '20261006-131000',
      event: {
        kind: 'closed',
        minutes:
          '# 同期\n\nIzuna が書く。追記のみ。\n\n## 2026-10-06T04:11:00.000Z\n\n### 決まったこと\n\n- 境界を切る\n'
      }
    })
    expect(screen.getByText('議事録')).toBeTruthy()
    expect(screen.getByText('境界を切る')).toBeTruthy()
    // 回の見出しは ISO のまま出さない
    expect(screen.queryByText('2026-10-06T04:11:00.000Z')).toBeNull()
    expect(screen.queryByText('Izuna が書く。追記のみ。')).toBeNull()
    emit({ kind: 'meeting', id: '20261006-131000', event: { kind: 'running', running: false } })
    await waitFor(() => expect(screen.queryByText('締める')).toBeNull())
    emit({ kind: 'meeting', id: '20261006-131000', event: { kind: 'error', message: '落ちた' } })
    expect(screen.getByText('落ちた')).toBeTruthy()
    // 続きを話して走り始めたら、前の失敗の文字は消える
    emit({ kind: 'meeting', id: '20261006-131000', event: { kind: 'running', running: true } })
    expect(screen.queryByText('落ちた')).toBeNull()
  })

  it('読み込みの途中に届いた出来事を、読み終わった中身に重ねる（同じ発言は 2 度足さない）', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    let reads = 0
    const already = { at: '2026-10-06T04:10:05.000Z', who: 'moderator', text: '設計へ: どう思う' }
    ;(window.izuna as unknown as { meetingRead: () => Promise<MeetingView> }).meetingRead =
      async () => {
        reads++
        await gate
        return { ...view, running: false }
      }
    render(<Meeting cwd={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('同期をどうするか')).toBeTruthy())
    fireEvent.click(screen.getByText('同期をどうするか'))
    await waitFor(() => expect(reads).toBe(1))
    // 読み込みの途中に: 既に読んだ発言（重複）、新しい発言、走り始めた印
    const id = '20261006-131000'
    emit({ kind: 'meeting', id, event: { kind: 'said', entry: already } })
    emit({
      kind: 'meeting',
      id,
      event: {
        kind: 'said',
        entry: { at: '2026-10-06T04:10:09.000Z', who: 'architect', text: '途中で届いた発言' }
      }
    })
    emit({ kind: 'meeting', id, event: { kind: 'running', running: true } })
    emit({ kind: 'meeting', id, event: { kind: 'speaking', who: 'architect' } })
    release()
    await waitFor(() => expect(screen.getByText('途中で届いた発言')).toBeTruthy())
    expect(screen.getAllByText('設計へ: どう思う')).toHaveLength(1)
    expect(screen.getByText('締める')).toBeTruthy()
    expect(screen.getByText('設計が話しています…')).toBeTruthy()
    expect(reads).toBe(1)
  })

  it('話している最中は、割り込む・締める・止めるができる', async () => {
    render(<Meeting cwd={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('同期をどうするか')).toBeTruthy())
    fireEvent.click(screen.getByText('同期をどうするか'))
    await waitFor(() => expect(screen.getByText('締める')).toBeTruthy())

    const box = screen.getByLabelText('発言')
    expect(box.getAttribute('placeholder')).toContain('割り込んで話す')
    fireEvent.change(box, { target: { value: 'iCloud は使わない' } })
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(said).toEqual([['20261006-131000', 'iCloud は使わない']]))
    expect((box as HTMLTextAreaElement).value).toBe('')

    fireEvent.click(screen.getByText('締める'))
    expect(closed).toEqual(['20261006-131000'])
    // 押した場所で何が起きるかを言う
    expect(screen.getByText('次の指名で締めます')).toBeTruthy()
    fireEvent.click(screen.getByText('止める'))
    expect(stopped).toEqual(['20261006-131000'])
  })

  it('止まっている会議に送ると続きを話す。読めなければそう言う', async () => {
    view = { ...view, running: false }
    render(<Meeting cwd={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('同期をどうするか')).toBeTruthy())
    fireEvent.click(screen.getByText('同期をどうするか'))
    await waitFor(() => expect(screen.getByLabelText('発言')).toBeTruthy())
    expect(screen.getByLabelText('発言').getAttribute('placeholder')).toContain('続きを話す')
    expect(screen.queryByText('締める')).toBeNull()
    fireEvent.change(screen.getByLabelText('発言'), { target: { value: '続き' } })
    fireEvent.click(screen.getByText('送る'))
    await waitFor(() => expect(said).toHaveLength(1))

    cleanup()
    ;(window.izuna as unknown as { meetingRead: () => Promise<never> }).meetingRead = async () => {
      throw new Error('会議が見つかりません')
    }
    render(<Meeting cwd={null} onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('同期をどうするか')).toBeTruthy())
    fireEvent.click(screen.getByText('同期をどうするか'))
    await waitFor(() => expect(screen.getByText('会議が見つかりません')).toBeTruthy())
  })

  it('一覧が読めなければそう言う。覆いの外を押すと閉じる', async () => {
    let closedOverlay = 0
    ;(window.izuna as unknown as { meetings: () => Promise<never> }).meetings = async () => {
      throw new Error('読めません')
    }
    const { container } = render(<Meeting cwd={null} onClose={() => closedOverlay++} />)
    await waitFor(() => expect(screen.getByText('読めません')).toBeTruthy())
    expect(screen.getByText('まだありません')).toBeTruthy()
    fireEvent.click(container.firstChild as Element)
    expect(closedOverlay).toBe(1)
  })
})

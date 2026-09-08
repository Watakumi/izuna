// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Loop } from '../../src/renderer/src/components/Loop'
import type { Panel } from '../../src/renderer/src/useSessions'
import { emptyTranscript } from '../../src/shared/transcript'
import type { Wakeup } from '../../src/shared/wakeup'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

/** 時刻を決めて送る予約の画面（docs/NIMBALYST.md §7 の 2）。口は前からあり、釦が無かった */
let wakeups: Wakeup[] = []
let calls: string[] = []

const panel = (over: Partial<Panel> = {}): Panel => ({
  id: 's1', label: 'izuna', cwd: '/w', branch: null, team: 't', transcript: emptyTranscript(),
  pending: null, prompt: '', commands: [], ended: false, loop: null, ...over
})

const w = (over: Partial<Wakeup>): Wakeup => ({
  id: 'w1', sessionId: 's1', cwd: '/w', prompt: '続きを', fireAt: Date.now() + 30 * 60_000,
  state: 'pending', createdAt: 0, ...over
})

beforeEach(() => {
  wakeups = []
  calls = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    listWakeups: async () => wakeups,
    addWakeup: async (input: { minutes: number; prompt: string }) => { calls.push(`add:${input.minutes}:${input.prompt}`); return w({}) },
    removeWakeup: async (id: string) => { calls.push(`remove:${id}`) },
    fireWakeup: async (id: string) => { calls.push(`fire:${id}`) },
    startLoop: async () => {},
    stopLoop: async () => {}
  }
})

describe('時刻を決めて送る', () => {
  it('無ければそう言う。依頼が空なら予約できない', async () => {
    render(<Loop panel={panel()} />)
    await waitFor(() => expect(screen.getByText('予約はありません')).toBeTruthy())
    expect((screen.getByText('予約する') as HTMLButtonElement).disabled).toBe(true)
  })

  it('分と依頼を渡して予約する', async () => {
    render(<Loop panel={panel()} />)
    fireEvent.change(screen.getByPlaceholderText('時刻が来たら送る依頼'), { target: { value: '続きを' } })
    fireEvent.click(screen.getByText('予約する'))
    await waitFor(() => expect(calls).toEqual(['add:30:続きを']))
  })

  it('**過ぎたものは人が送る**。自分のセッションの分だけ出す', async () => {
    wakeups = [
      w({ id: 'a', state: 'overdue', prompt: '昨夜の' }),
      w({ id: 'b', sessionId: 'other', prompt: '他人の' }),
      w({ id: 'c', state: 'rejected', prompt: '覚えの無い' })
    ]
    const { container } = render(<Loop panel={panel()} />)
    await waitFor(() => expect(screen.getByText('昨夜の')).toBeTruthy())
    expect(container.textContent).not.toContain('他人の')
    expect(container.textContent).toContain('覚えが無い（送らない）')
    fireEvent.click(screen.getByText('いま送る'))
    await waitFor(() => expect(calls).toEqual(['fire:a']))
  })

  it('予約中のものは待ち時間を出し、消せる', async () => {
    wakeups = [w({ id: 'p', fireAt: Date.now() + 3 * 3600_000 })]
    const { container } = render(<Loop panel={panel()} />)
    await waitFor(() => expect(container.textContent).toContain('3時間後'))
    fireEvent.click(screen.getByText('消す'))
    await waitFor(() => expect(calls).toEqual(['remove:p']))
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Inspector } from '../../src/renderer/src/components/Inspector'
import type { Panel } from '../../src/renderer/src/useSessions'
import { emptyTranscript, type Transcript } from '../../src/shared/transcript'

afterEach(cleanup)

const panel = (over: Partial<Panel>, transcript: Partial<Transcript> = {}): Panel => ({
  id: 's1',
  label: 'x',
  cwd: '/p',
  branch: 'feat',
  team: 't',
  transcript: { ...emptyTranscript(), ...transcript },
  pending: null,
  prompt: '',
  commands: [],
  ended: false,
  loop: null,
  ...over
})

let calls: string[] = []

beforeEach(() => {
  calls = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    worktreeStatus: async () => ({
      changed: 2,
      added: 10,
      removed: 4,
      ahead: 1,
      behind: 3,
      branch: 'feat'
    }),
    teamPath: async (team: string) => `/teams/${team}`,
    // 落とした事実は聞きもしない。呼んだら記録されて落ちる
    remotes: async () => {
      calls.push('remotes')
      return []
    },
    isPushed: async () => {
      calls.push('isPushed')
      return true
    },
    ghIssues: async () => {
      calls.push('ghIssues')
      return []
    },
    forgeIssues: async () => {
      calls.push('forgeIssues')
      return []
    }
  }
})

/** `Status` タブの上半分（§35）。どこで作業しているか、あと何回頼めるか */
describe('Inspector', () => {
  it('worktree の状態を出す。上限が未着なら断定しない', async () => {
    render(<Inspector panel={panel({ cwd: '/p1' })} />)
    await waitFor(() => expect(screen.getByText('/p1')).toBeTruthy())
    expect(screen.getByText('feat')).toBeTruthy()
    expect(screen.getByText('+10')).toBeTruthy()
    expect(screen.getByText('−4')).toBeTruthy()
    expect(screen.getByText('↑1')).toBeTruthy()
    expect(screen.getByText('↓3')).toBeTruthy()
    expect(screen.getByText('まだ届いていません')).toBeTruthy()
  })

  it('**PR タブと新しいセッションの画面にある事実は持たない**（§35。重複を消した）', async () => {
    const { container } = render(<Inspector panel={panel({ cwd: '/p2' })} />)
    await waitFor(() => expect(screen.getByText('/p2')).toBeTruthy())
    const text = container.textContent ?? ''
    for (const w of ['push', 'PR を作る', 'remote を用意する', 'Issue'])
      expect(text).not.toContain(w)
    // 出さないものは読みにも行かない
    expect(calls).toEqual([])
  })

  it('上限は割合で出し、共有フォルダは畳んである', async () => {
    render(
      <Inspector
        panel={panel(
          { cwd: '/p3', team: 'alpha' },
          {
            limits: [
              { key: 'five_hour', utilization: 0.31, resetsAt: Date.now() + 3_600_000 },
              { key: 'seven_day', utilization: 0.5, resetsAt: Date.now() + 86_400_000 },
              // 上流が増やした窓も出る。**一番効いている制約を落とさない**
              { key: 'seven_day_fable', utilization: 1, resetsAt: Date.now() - 1 }
            ]
          }
        )}
      />
    )
    await waitFor(() => expect(screen.getByText('31%')).toBeTruthy())
    expect(screen.getByText('50%')).toBeTruthy()
    // 知らない鍵は上流の字のまま、尽きた窓は 100%
    expect(screen.getByText('seven_day_fable')).toBeTruthy()
    expect(screen.getByText('100%')).toBeTruthy()
    // 空く時刻を過ぎている窓は、前の窓の数字だと言う
    expect(screen.getByText('空いたあとの数字はまだ来ていません（前の窓のもの）')).toBeTruthy()
    expect(screen.queryByText('/teams/alpha')).toBeNull()
    fireEvent.click(screen.getByText('共有フォルダ'))
    expect(screen.getByText('/teams/alpha')).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Inspector } from '../../src/renderer/src/components/Inspector'
import type { Panel } from '../../src/renderer/src/useSessions'
import type { RemoteRef } from '../../src/shared/remote'
import { emptyTranscript, type Transcript } from '../../src/shared/transcript'

afterEach(cleanup)

const remote = (name: string, role: RemoteRef['role']): RemoteRef => ({
  name,
  url: `https://${role}.example/o/r.git`,
  host: `${role}.example`,
  owner: 'o',
  repo: 'r',
  role
})

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

let remotes: RemoteRef[] = []
let issues: Array<{ number: number; title: string }> | null = null
let pushed = false
let calls: string[] = []
let forgeIssues: Array<{ number: number; title: string; url: string }> = []

beforeEach(() => {
  remotes = []
  issues = null
  pushed = false
  calls = []
  forgeIssues = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    worktreeStatus: async () => ({
      changed: 2,
      added: 10,
      removed: 4,
      ahead: 1,
      behind: 3,
      branch: 'feat'
    }),
    remotes: async () => remotes,
    teamPath: async (team: string) => `/teams/${team}`,
    isPushed: async (cwd: string, remote: string, branch: string) => {
      calls.push(`isPushed:${remote}:${branch}`)
      return pushed
    },
    forgeIssues: async () => forgeIssues,
    ghIssues: async () => {
      if (issues === null) throw new Error('gh: not logged in')
      return issues
    }
  }
})

/** 右ペインの「情報」タブ。読み終わるまで断定しない */
describe('Inspector', () => {
  it('worktree の状態と、GitHub に繋がらないこと、sandbox が無いことを出す', async () => {
    render(<Inspector panel={panel({ cwd: '/p1' })} onOpenForge={() => {}} />)
    await waitFor(() => expect(screen.getByText('sandbox 未設定')).toBeTruthy())
    expect(screen.getByText('feat')).toBeTruthy()
    expect(screen.getByText('/p1')).toBeTruthy()
    expect(screen.getByText('+10')).toBeTruthy()
    expect(screen.getByText('↑1')).toBeTruthy()
    expect(screen.getByText('↓3')).toBeTruthy()
    expect(screen.getByText('GitHub にも Forgejo にも繋がっていません')).toBeTruthy()
    expect(screen.getByText('remote を用意する')).toBeTruthy()
    expect(screen.getByText('まだ届いていません')).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('sandbox があれば push 済みかを聞き、upstream があれば「PR を作る」になる。Issue は 2 件まで', async () => {
    remotes = [remote('forgejo', 'sandbox'), remote('upstream', 'upstream')]
    pushed = true
    issues = [
      { number: 1, title: 'one' },
      { number: 2, title: 'two' },
      { number: 3, title: 'three' }
    ]
    const opened: number[] = []
    render(<Inspector panel={panel({ cwd: '/p2' })} onOpenForge={() => opened.push(1)} />)
    await waitFor(() => expect(screen.getByText('sandbox に push 済み')).toBeTruthy())
    expect(calls).toEqual(['isPushed:forgejo:feat'])
    await waitFor(() => expect(screen.getByText('two')).toBeTruthy())
    expect(screen.queryByText('three')).toBeNull()
    fireEvent.click(screen.getByText('PR を作る'))
    expect(opened).toEqual([1])
  })

  it('open な Issue が無ければそう言う。上限は割合で出し、共有フォルダは畳んである', async () => {
    issues = []
    render(
      <Inspector
        panel={panel({ cwd: '/p3', team: 'alpha' }, { limits: { fiveHour: 0.31, sevenDay: 0.5 } })}
        onOpenForge={() => {}}
      />
    )
    await waitFor(() => expect(screen.getByText('open な Issue はありません')).toBeTruthy())
    expect(screen.getByText('31%')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.queryByText('/teams/alpha')).toBeNull()
    fireEvent.click(screen.getByText('共有フォルダ'))
    expect(screen.getByText('/teams/alpha')).toBeTruthy()
  })

  it('GitHub が無くても、sandbox の Forgejo の Issue が出どころの札つきで出る', async () => {
    remotes = [remote('forgejo', 'sandbox')]
    forgeIssues = [
      { number: 5, title: 'Forgejo の五', url: 'https://sandbox.example/o/r/issues/5' }
    ]
    render(<Inspector panel={panel({ cwd: '/p4' })} onOpenForge={() => {}} />)
    await waitFor(() => expect(screen.getByText('Forgejo の五')).toBeTruthy())
    expect(screen.getByText('Forgejo')).toBeTruthy()
    expect(screen.queryByText(/繋がっていません/)).toBeNull()
  })
})

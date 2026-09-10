// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Worktrees } from '../../src/renderer/src/components/Worktrees'
import type { Panel } from '../../src/renderer/src/useSessions'
import type { Worktree } from '../../src/shared/worktree'
import { emptyTranscript } from '../../src/shared/transcript'

afterEach(cleanup)

const wt = (over: Partial<Worktree>): Worktree => ({
  path: '/r',
  head: 'abc',
  branch: 'main',
  detached: false,
  bare: false,
  locked: null,
  prunable: null,
  main: false,
  ...over
})

const panel = (over: Partial<Panel>): Panel => ({
  id: 's1',
  label: 'x',
  cwd: '/r',
  branch: null,
  team: 't',
  transcript: emptyTranscript(),
  pending: null,
  prompt: '',
  commands: [],
  ended: false,
  loop: null,
  ...over
})

let worktrees: Worktree[] = []
let ahead = 0
let calls: string[] = []
let fail: string | null = null

beforeEach(() => {
  worktrees = []
  ahead = 0
  calls = []
  fail = null
  ;(window as unknown as { izuna: unknown }).izuna = {
    repo: async (cwd: string) => ({ root: cwd, name: 'r', worktrees }),
    worktreeStatus: async (path: string) => ({
      changed: 0,
      added: 3,
      removed: 1,
      ahead: path.endsWith('feat') ? ahead : 0,
      behind: 0,
      branch: null
    }),
    removeWorktree: async (cwd: string, path: string, force: boolean) => {
      calls.push(`remove:${path}:${force}`)
      if (fail) throw new Error(fail)
      worktrees = worktrees.filter((w) => w.path !== path)
    }
  }
})

/** worktree の一覧。**作らない、消すだけ**（§12）。消す前に未 push を警告する */
describe('Worktrees', () => {
  it('本体は消せず、他のものは開ける。セッションが乗っているものは開かない', async () => {
    worktrees = [
      wt({ path: '/w1', branch: 'main', main: true }),
      wt({ path: '/w1/feat', branch: 'feat' }),
      wt({ path: '/w1/busy', branch: 'busy' })
    ]
    const opened: string[] = []
    render(
      <Worktrees
        cwd="/w1"
        panels={[panel({ cwd: '/w1/busy' })]}
        onOpen={(w) => opened.push(w.path)}
      />
    )
    await waitFor(() => expect(screen.getByText('feat')).toBeTruthy())
    expect(screen.getByText('本体')).toBeTruthy()
    expect(screen.getByText('本体の作業ツリーは消せません')).toBeTruthy()
    // 開けるのは、セッションの乗っていない worktree だけ
    expect(screen.getAllByText('ここで開く').length).toBe(1)
    fireEvent.click(screen.getByText('ここで開く'))
    expect(opened).toEqual(['/w1/feat'])
    expect(screen.getAllByText('+3').length).toBe(3)
  })

  it('未 push があれば警告してから force で消し、結果を出す', async () => {
    worktrees = [wt({ path: '/w2', main: true }), wt({ path: '/w2/feat', branch: 'feat' })]
    ahead = 2
    render(<Worktrees cwd="/w2" panels={[]} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('↑2')).toBeTruthy())
    fireEvent.click(screen.getByText('消す'))
    expect(screen.getByText('未 push の変更があります。消すと戻せません')).toBeTruthy()
    fireEvent.click(screen.getByText('消す'))
    await waitFor(() => expect(screen.getByText('feat を消しました')).toBeTruthy())
    expect(calls).toEqual(['remove:/w2/feat:true'])
    expect(screen.queryByText('feat')).toBeNull()
  })

  it('push 済みなら force を付けず、失敗は git の言い分をそのまま出す。やめれば消さない', async () => {
    worktrees = [wt({ path: '/w3', main: true }), wt({ path: '/w3/feat', branch: 'feat' })]
    fail = 'contains modified or untracked files'
    render(<Worktrees cwd="/w3" panels={[]} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('feat')).toBeTruthy())
    fireEvent.click(screen.getByText('消す'))
    fireEvent.click(screen.getByText('やめる'))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByText('消す'))
    expect(screen.getByText('ディレクトリを消します')).toBeTruthy()
    fireEvent.click(screen.getByText('消す'))
    await waitFor(() =>
      expect(screen.getByText('contains modified or untracked files')).toBeTruthy()
    )
    expect(calls).toEqual(['remove:/w3/feat:false'])
  })

  it('生きているロックは拒み、主が死んだロックは消せる', async () => {
    worktrees = [
      wt({ path: '/w4', main: true }),
      wt({ path: '/w4/a', branch: 'a', locked: 'claude agent x (pid 1 …)' }),
      wt({ path: '/w4/b', branch: 'b', locked: 'claude agent y (pid 2 …)', lockStale: true })
    ]
    render(<Worktrees cwd="/w4" panels={[]} onOpen={() => {}} />)
    await waitFor(() => expect(screen.getByText('b')).toBeTruthy())
    expect(screen.getAllByText('ロック').length).toBe(2)
    expect(screen.getByText('ロックされています: claude agent x (pid 1 …)')).toBeTruthy()
    // 消せるのは b だけ
    expect(screen.getAllByText('消す').length).toBe(1)
  })
})

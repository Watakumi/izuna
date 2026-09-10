// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NewSession, type StartInput } from '../../src/renderer/src/components/NewSession'
import type { SessionSummary } from '../../src/shared/sessions'

afterEach(cleanup)

const past = (over: Partial<SessionSummary>): SessionSummary => ({
  id: 'abcdefgh-1',
  cwd: '/repos/a',
  title: null,
  slug: null,
  firstPrompt: null,
  branch: null,
  cliVersion: null,
  updatedAt: Date.now() - 5 * 60_000,
  bytes: 1,
  ...over
})

let sessions: SessionSummary[] = []
let issues: Array<{ number: number; title: string; url: string }> | null = null
let started: StartInput[] = []
let failWith: string | null = null

beforeEach(() => {
  sessions = []
  issues = null
  started = []
  failWith = null
  ;(window as unknown as { izuna: unknown }).izuna = {
    findRepos: async () => [
      { path: '/repos/a', name: 'alpha', group: 'work' },
      { path: '/repos/b', name: 'beta', group: 'personal' }
    ],
    listSessions: async () => sessions,
    repo: async (path: string) => {
      if (path === '/nowhere') throw new Error('not a git repository')
      return { root: path, name: path.split('/').pop(), worktrees: [] }
    },
    ghIssues: async () => {
      if (issues === null) throw new Error('gh: not logged in')
      return issues
    },
    pickDirectory: async () => '/picked'
  }
})

const onStart = async (input: StartInput): Promise<void> => {
  started.push(input)
  if (failWith) throw new Error(failWith)
}

/** セッションを開く入口。Issue から始められ、依頼は必須にしない（§17.5） */
describe('NewSession', () => {
  it('場所が無ければ開けない。一覧を絞り、選ぶと Issue を引いて最初の依頼にできる', async () => {
    issues = [
      { number: 7, title: 'greet に検査を足す', url: 'https://github.com/o/r/issues/7' },
      { number: 8, title: 'math も', url: 'https://github.com/o/r/issues/8' }
    ]
    render(<NewSession initialCwd="" onCancel={() => {}} onStart={onStart} />)
    await waitFor(() => expect(screen.getByPlaceholderText('2 本から絞り込む')).toBeTruthy())
    expect((screen.getByText('開く') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText('2 本から絞り込む'), { target: { value: 'be' } })
    expect(screen.queryByText('alpha')).toBeNull()
    fireEvent.click(screen.getByText('beta'))
    await waitFor(() => expect(screen.getByText('greet に検査を足す')).toBeTruthy())
    fireEvent.click(screen.getByText('greet に検査を足す'))
    expect(screen.getByText('開くと、選んだ内容がそのまま最初の依頼になります')).toBeTruthy()
    fireEvent.click(screen.getByText('開く'))
    await waitFor(() => expect(started.length).toBe(1))
    expect(started[0]).toMatchObject({ cwd: '/repos/b', label: 'b', team: 'b', branch: null })
    expect(started[0].initialPrompt).toContain('Issue #7「greet に検査を足す」')
    expect(started[0].initialPrompt).toContain('https://github.com/o/r/issues/7')
  })

  it('GitHub に繋がらなくても直接書ける。空なら何も送らずに開く', async () => {
    render(<NewSession initialCwd="/repos/a" onCancel={() => {}} onStart={onStart} />)
    await waitFor(() =>
      expect(screen.getByText('GitHub に繋がっていません。下に直接書けます')).toBeTruthy()
    )
    expect(screen.getByText('そのまま開きます。依頼は会話で伝えられます')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('依頼を書く（後で会話でも伝えられます）'), {
      target: { value: '  README を直して ' }
    })
    fireEvent.click(screen.getByText('開く'))
    await waitFor(() => expect(started.length).toBe(1))
    expect(started[0].initialPrompt).toBe('README を直して')
  })

  it('このリポジトリの記録だけを「続きから」に出し、選ぶと記録の cwd と id で開く', async () => {
    sessions = [
      past({ id: 'aaaa0000-1', title: '盤面を直す', cwd: '/repos/a', branch: 'fix' }),
      past({ id: 'bbbb0000-1', firstPrompt: 'よその依頼', cwd: '/repos/zzz' })
    ]
    render(<NewSession initialCwd="/repos/a" onCancel={() => {}} onStart={onStart} />)
    await waitFor(() => expect(screen.getByText('盤面を直す')).toBeTruthy())
    expect(screen.queryByText('よその依頼')).toBeNull()
    expect(screen.getByText('5分前')).toBeTruthy()
    fireEvent.click(screen.getByText('盤面を直す'))
    await waitFor(() => expect(started.length).toBe(1))
    expect(started[0]).toEqual({
      cwd: '/repos/a',
      label: '盤面を直す',
      branch: 'fix',
      team: 'a',
      initialPrompt: '',
      resume: 'aaaa0000-1'
    })
  })

  it('5 件を超えたら絞り込みの欄と「ほか n 件」が出る', async () => {
    sessions = [1, 2, 3, 4, 5, 6].map((n) =>
      past({ id: `s${n}00000-1`, firstPrompt: `依頼 ${n}`, updatedAt: n * 1000 })
    )
    render(<NewSession initialCwd="/repos/a" onCancel={() => {}} onStart={onStart} />)
    await waitFor(() => expect(screen.getByText('ほか 2 件')).toBeTruthy())
    expect(screen.queryByText('依頼 1')).toBeNull()
    fireEvent.click(screen.getByText('ほか 2 件'))
    expect(screen.getByText('依頼 1')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('6 件から絞り込む'), {
      target: { value: '依頼 3' }
    })
    expect(screen.getByText('依頼 3')).toBeTruthy()
    expect(screen.queryByText('依頼 4')).toBeNull()
  })

  it('開けなかった理由をそのまま出し、閉じるは onCancel', async () => {
    failWith = 'claude が見つかりません'
    const cancelled: number[] = []
    render(
      <NewSession initialCwd="/repos/a" onCancel={() => cancelled.push(1)} onStart={onStart} />
    )
    await waitFor(() =>
      expect(screen.getByText('GitHub に繋がっていません。下に直接書けます')).toBeTruthy()
    )
    fireEvent.click(screen.getByText('開く'))
    await waitFor(() => expect(screen.getByText('claude が見つかりません')).toBeTruthy())
    expect((screen.getByText('開く') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByText('閉じる'))
    expect(cancelled).toEqual([1])
  })

  it('git のリポジトリでない場所はその言い分を出す。フォルダを選ぶと場所が変わる', async () => {
    render(<NewSession initialCwd="/nowhere" onCancel={() => {}} onStart={onStart} />)
    await waitFor(() => expect(screen.getByText('not a git repository')).toBeTruthy())
    fireEvent.click(screen.getByText('フォルダを選ぶ…'))
    await waitFor(() => expect(screen.queryByText('not a git repository')).toBeNull())
    fireEvent.click(screen.getByText('開く'))
    await waitFor(() => expect(started.length).toBe(1))
    expect(started[0].cwd).toBe('/picked')
  })
})

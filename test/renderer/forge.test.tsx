// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Forge } from '../../src/renderer/src/components/Forge'
import type { RemoteRef } from '../../src/shared/remote'

afterEach(cleanup)

const remote = (name: string, role: RemoteRef['role']): RemoteRef => ({
  name,
  url: `https://${role}.example/o/r.git`,
  host: `${role}.example`,
  owner: 'o',
  repo: 'r',
  role
})

const pull = (number: number, head: string): Record<string, unknown> => ({
  number,
  title: `PR ${head}`,
  state: 'open',
  head,
  base: 'main',
  htmlUrl: `https://sandbox.example/o/r/pulls/${number}`,
  draft: false,
  merged: false,
  createdAt: ''
})

let remotes: RemoteRef[] = []
let branch: string | null = 'feat'
let gh: { ok: boolean; detail: string } = { ok: true, detail: 'o/r' }
let pushed = false
let pulls: Array<Record<string, unknown>> = []
let upstreamHeads: string[] = []
let sandboxHeads: string[] = []
let calls: string[] = []

beforeEach(() => {
  remotes = []
  branch = 'feat'
  gh = { ok: true, detail: 'o/r' }
  pushed = false
  pulls = []
  upstreamHeads = []
  sandboxHeads = []
  calls = []
  ;(window as unknown as { izuna: unknown }).izuna = {
    remotes: async () => remotes,
    currentBranch: async () => branch,
    ghStatus: async () => gh,
    defaultBranch: async (_cwd: string, name: string) => (name === 'upstream' ? 'main' : 'main'),
    isPushed: async () => pushed,
    forgePulls: async () => pulls,
    forgeRuns: async () => [
      {
        id: 1,
        title: 'ci',
        status: 'success',
        event: 'push',
        ref: 'refs/heads/feat',
        sha: 'x',
        htmlUrl: 'https://sandbox.example/o/r/actions/runs/1',
        workflow: 'verify.yml',
        startedAt: null,
        stoppedAt: null
      }
    ],
    ghIssues: async () => [
      { number: 3, title: 'Issue three', url: '', state: 'open', labels: [], updatedAt: '' }
    ],
    ghPulls: async () => [
      {
        number: 9,
        title: 'Upstream nine',
        url: 'https://github.com/o/r/pull/9',
        state: 'open',
        headRefName: 'feat',
        isDraft: false
      }
    ],
    commitsSince: async (_cwd: string, base: string) => {
      calls.push(`commits:${base}`)
      return ['a', 'b']
    },
    remoteHeads: async (_cwd: string, name: string) =>
      name === 'upstream' ? upstreamHeads : sandboxHeads,
    forgeEnsureRepo: async (name: string) => {
      calls.push(`ensureRepo:${name}`)
      return { owner: 'izuna', name }
    },
    ensureSandboxRemote: async (_cwd: string, owner: string, name: string) => {
      calls.push(`remote:${owner}/${name}`)
      remotes = [remote('forgejo', 'sandbox')]
      return 'forgejo を足しました'
    },
    push: async (_cwd: string, name: string, br: string) => {
      calls.push(`push:${name}:${br}`)
      pushed = true
      return 'push しました'
    },
    forgeCreatePull: async (
      owner: string,
      repo: string,
      input: { head: string; base: string; body: string }
    ) => {
      calls.push(`createPull:${owner}/${repo}:${input.head}->${input.base}:${input.body}`)
      return { number: 1 }
    },
    forgeClosePull: async (owner: string, repo: string, index: number) => {
      calls.push(`closePull:${owner}/${repo}:${index}`)
    },
    forgePullDiff: async (owner: string, repo: string, index: number) => {
      calls.push(`diff:${owner}/${repo}:${index}`)
      return []
    },
    deleteRemoteBranch: async (_cwd: string, name: string, br: string) => {
      calls.push(`deleteBranch:${name}:${br}`)
      return `${br} を消しました`
    },
    ghCreatePull: async (_cwd: string, input: { head: string; base?: string; body: string }) => {
      calls.push(`ghCreatePull:${input.head}->${input.base}:${input.body}`)
      return 'https://github.com/o/r/pull/10'
    },
    draftCommitMessage: async (id: string) => {
      calls.push(`draft:${id}`)
    },
    requestReview: async (id: string, input: { base: string }) => {
      calls.push(`review:${id}:${input.base}`)
    }
  }
})

/** 右ペインの「PR」タブ。二段の PR（GOAL.md 柱2）。GitHub に出るのは二段目だけ */
describe('Forge', () => {
  it('sandbox が無ければ用意する釦だけ。押すとボットの下に作って remote を足す', async () => {
    remotes = [remote('upstream', 'upstream')]
    render(<Forge cwd="/f1" sessionId="s1" onDone={() => {}} />)
    await waitFor(() => expect(screen.getByText('sandbox を用意する')).toBeTruthy())
    expect(screen.getByText('先に sandbox で見てください（sandbox が未設定）')).toBeTruthy()
    expect((screen.getByText('Upstream に PR を作る') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('sandbox を用意する'))
    await waitFor(() => expect(screen.getByText('forgejo を足しました')).toBeTruthy())
    expect(calls.filter((c) => !c.startsWith('commits'))).toEqual([
      'ensureRepo:r',
      'remote:izuna/r'
    ])
  })

  it('push 前は push の釦。push すると PR を作る釦に変わり、本文はコミットの一覧', async () => {
    remotes = [remote('forgejo', 'sandbox'), remote('upstream', 'upstream')]
    render(<Forge cwd="/f2" sessionId="s1" onDone={() => {}} />)
    await waitFor(() => expect(screen.getByText('feat はまだ sandbox にありません')).toBeTruthy())
    expect(screen.getByText('先に sandbox で見てください（push が未了）')).toBeTruthy()
    fireEvent.click(screen.getByText('forgejo に push'))
    await waitFor(() => expect(screen.getByText('sandbox で PR を作る')).toBeTruthy())
    fireEvent.click(screen.getByText('sandbox で PR を作る'))
    await waitFor(() => expect(screen.getByText('sandbox に PR !1 を作りました')).toBeTruthy())
    expect(calls).toContain('push:forgejo:feat')
    expect(calls).toContain('createPull:o/r:feat->main:- a\n- b')
    // upstream の既定ブランチからのコミットを数える
    expect(calls).toContain('commits:upstream/main')
  })

  it('PR の札に CI と差分と頁と閉じる。作業ブランチは sandbox で捨て、漏れを名指しする', async () => {
    remotes = [remote('forgejo', 'sandbox'), remote('upstream', 'upstream')]
    pushed = true
    pulls = [pull(4, 'feat')]
    sandboxHeads = ['main', 'feat', 'agent-1', 'agent-2']
    upstreamHeads = ['main', 'feat', 'agent-2']
    const previewed: string[] = []
    render(
      <Forge cwd="/f3" sessionId="s1" onDone={() => {}} onPreview={(u) => previewed.push(u)} />
    )
    await waitFor(() => expect(screen.getByText('PR feat')).toBeTruthy())
    expect(screen.getByText('PR 1 件')).toBeTruthy()
    expect(screen.getByText('作業ブランチが Upstream に出ています: agent-2')).toBeTruthy()
    // 既定ブランチといまのブランチは捨てる候補に出ない
    expect(screen.getByText('agent-1')).toBeTruthy()
    expect(screen.getByText('agent-2')).toBeTruthy()
    expect(screen.queryByText('main')).toBeNull()

    fireEvent.click(screen.getByText('差分'))
    await waitFor(() => expect(calls).toContain('diff:o/r:4'))
    // 差分を畳む「閉じる」と、PR を閉じる「閉じる」
    expect(screen.getAllByText('閉じる').length).toBe(2)

    // 頁は 3 つ: Sandbox の見出し（remote の URL から .git を落とす）、sandbox の PR、Upstream の PR
    const pages = screen.getAllByText('頁')
    expect(pages.length).toBe(3)
    pages.forEach((b) => fireEvent.click(b))
    expect(previewed).toEqual([
      'https://sandbox.example/o/r',
      'https://sandbox.example/o/r/pulls/4',
      'https://github.com/o/r/pull/9'
    ])

    fireEvent.click(screen.getAllByText('消す')[0])
    await waitFor(() => expect(screen.getByText('agent-1 を消しました')).toBeTruthy())
    expect(calls).toContain('deleteBranch:forgejo:agent-1')
  })

  it('sandbox の PR は閉じられる。マージはしない', async () => {
    remotes = [remote('forgejo', 'sandbox')]
    pushed = true
    pulls = [pull(5, 'feat')]
    render(<Forge cwd="/f4" sessionId={null} onDone={() => {}} />)
    await waitFor(() => expect(screen.getByText('PR feat')).toBeTruthy())
    fireEvent.click(screen.getByText('閉じる'))
    await waitFor(() => expect(screen.getByText('sandbox の PR !5 を閉じました')).toBeTruthy())
    expect(calls).toContain('closePull:o/r:5')
    expect(screen.queryByText(/マージ/)).toBeNull()
  })

  it('二段目: Upstream に PR を作り、コミット文とレビューは会話に頼む。会話が無ければ頼めない', async () => {
    remotes = [remote('forgejo', 'sandbox'), remote('upstream', 'upstream')]
    pushed = true
    const done: number[] = []
    render(<Forge cwd="/f5" sessionId="s9" onDone={() => done.push(1)} />)
    await waitFor(() => expect(screen.getByText('2 コミット')).toBeTruthy())
    expect(screen.getByText('作業ブランチは Upstream に出ていません')).toBeTruthy()
    expect(screen.getByText('Upstream nine')).toBeTruthy()
    expect(screen.getByText('Issue three')).toBeTruthy()

    fireEvent.click(screen.getByText('コミット文を頼む'))
    await waitFor(() => expect(screen.getByText('いまの会話にコミット文を頼みました')).toBeTruthy())
    fireEvent.click(screen.getByText('差分のレビューを頼む'))
    await waitFor(() => expect(screen.getByText('いまの会話にレビューを頼みました')).toBeTruthy())
    fireEvent.click(screen.getByText('Upstream に PR を作る'))
    await waitFor(() => expect(screen.getByText('https://github.com/o/r/pull/10')).toBeTruthy())
    expect(calls).toContain('draft:s9')
    expect(calls).toContain('review:s9:main')
    expect(calls).toContain('ghCreatePull:feat->main:- a\n- b')
    expect(done).toEqual([1, 1, 1])

    cleanup()
    render(<Forge cwd="/f5" sessionId={null} onDone={() => {}} />)
    await waitFor(() => expect(screen.getByText('コミット文を頼む')).toBeTruthy())
    expect((screen.getByText('コミット文を頼む') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('差分のレビューを頼む') as HTMLButtonElement).disabled).toBe(true)
  })

  it('gh が使えなければ言い分を出し、Upstream の札は出さない', async () => {
    remotes = [remote('forgejo', 'sandbox')]
    gh = { ok: false, detail: 'gh: not logged in' }
    render(<Forge cwd="/f6" sessionId="s1" onDone={() => {}} />)
    await waitFor(() => expect(screen.getByText('gh が使えません')).toBeTruthy())
    expect(screen.getByText('gh: not logged in')).toBeTruthy()
    expect(screen.queryByText('Upstream に PR を作る')).toBeNull()
  })
})

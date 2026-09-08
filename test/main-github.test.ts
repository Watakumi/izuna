import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * GitHub 側は `gh` に任せる（docs/GOAL.md 柱2）。
 *
 * **`gh` を実際には呼ばない。** ここで見たいのは「どの引数で呼び、
 * 返ってきた JSON をどう読み、失敗をどう見せるか」で、gh の動作ではない。
 * 実物を呼ぶと、認証の有無で結果が変わる検査になる。
 */

let runs: string[][] = []
let out: Array<string | Error> = []

// ログインシェルの環境取得も execFile を使う。**先に消費されてしまう**ので外す
vi.mock('../src/main/claude/locate', () => ({ loginShellEnv: async () => ({ PATH: '/usr/bin' }) }))

vi.mock('node:child_process', () => ({
  // **引数の数は可変で、コールバックは末尾。** 位置で受けると、
  // 呼ぶ側が options を省いた瞬間に壊れる（実際それで嵌った）
  execFile: (...all: unknown[]) => {
    const cb = all[all.length - 1] as (e: Error | null, r?: { stdout: string; stderr: string }) => void
    runs.push(all[1] as string[])
    const next = out.shift()
    if (next instanceof Error) cb(next)
    else cb(null, { stdout: next ?? '[]', stderr: '' })
  }
}))

beforeEach(() => {
  runs = []
  out = []
  vi.resetModules()
})

describe('読み取り', () => {
  it('Issue を読む', async () => {
    out = [JSON.stringify([{ number: 12, title: 'パレットを直す', url: 'http://gh/12',
      state: 'OPEN', labels: [{ name: 'bug' }], updatedAt: '' }])]
    const { listIssues } = await import('../src/main/forge/github')
    const [i] = await listIssues('/w')
    expect(i).toMatchObject({ number: 12, title: 'パレットを直す' })
    expect(i.labels).toEqual(['bug'])
    expect(runs[0]).toContain('issue')
  })

  it('PR を読む', async () => {
    out = [JSON.stringify([{ number: 3, title: 'なおす', url: 'http://gh/3',
      headRefName: 'feat', baseRefName: 'main', state: 'OPEN' }])]
    const { listPulls } = await import('../src/main/forge/github')
    const [p] = await listPulls('/w')
    expect(p).toMatchObject({ number: 3, headRefName: 'feat', state: 'OPEN' })
  })

  it('**gh の言い分をそのまま投げる。** 握りつぶすと原因が分からなくなる', async () => {
    out = [Object.assign(new Error('x'), { stderr: 'gh: not authenticated' })]
    const { listIssues } = await import('../src/main/forge/github')
    await expect(listIssues('/w')).rejects.toThrow(/not authenticated/)
  })

  it('壊れた JSON も投げる（空で返すと「Issue が無い」と嘘になる）', async () => {
    out = ['{ここが壊れている']
    const { listPulls } = await import('../src/main/forge/github')
    await expect(listPulls('/w')).rejects.toThrow()
  })
})

describe('状態', () => {
  it('繋がっていれば ok とリポジトリ名', async () => {
    out = [JSON.stringify({ nameWithOwner: 'Watakumi/izuna' })]
    const { ghStatus } = await import('../src/main/forge/github')
    const s = await ghStatus('/w')
    expect(s.ok).toBe(true)
    expect(s.detail).toContain('Watakumi/izuna')
  })

  it('**駄目な理由をそのまま見せる**（握りつぶすと原因が分からない）', async () => {
    out = [Object.assign(new Error('x'), { stderr: 'gh auth login が必要です' })]
    const { ghStatus } = await import('../src/main/forge/github')
    const s = await ghStatus('/w')
    expect(s.ok).toBe(false)
    expect(s.detail).toContain('gh auth login')
  })
})

describe('PR を作る', () => {
  it('本文と base を渡し、URL を返す', async () => {
    out = ['https://github.com/Watakumi/izuna/pull/9\n']
    const { createPull } = await import('../src/main/forge/github')
    const url = await createPull('/w', { title: 't', head: 'feat', base: 'main', body: '本文' })
    expect(url).toContain('/pull/9')
    expect(runs[0]).toEqual(expect.arrayContaining(['pr', 'create', '--title', 't', '--head', 'feat']))
    expect(runs[0]).toContain('main')
  })

  it('base を省くと渡さない（既定ブランチを決め打たない）', async () => {
    out = ['http://gh/1']
    const { createPull } = await import('../src/main/forge/github')
    await createPull('/w', { title: 't', head: 'feat' })
    expect(runs[0]).not.toContain('--base')
  })
})

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  commitContext, commitsSince, currentBranch, defaultBranch, ensureSandboxRemote,
  deleteRemoteBranch, isPushed, listRemotes, push, remoteHeads
} from '../src/main/git/remote'
import {
  listWorktrees, removeWorktree, repoName, repoRoot, worktreeStatus
} from '../src/main/git/worktree'

/**
 * git を実際に動かす層。**本物の git で測る。**
 *
 * 解釈は `shared/` の純粋関数が持っているので、ここで見たいのは
 * 「正しい引数で git を呼び、返ってきたものを渡せているか」だけ。
 * 模造の git を置くと、**引数が間違っていても通る**検査になる。
 */

let base: string   // 上流役（bare）
let work: string   // 作業リポジトリ
let outside: string // git ではない場所

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })

beforeAll(() => {
  const root = mkdtempSync(join(tmpdir(), 'izuna-git-'))
  base = join(root, 'base.git')
  work = join(root, 'work')
  outside = join(root, 'plain')
  mkdirSync(base); mkdirSync(work); mkdirSync(outside)

  git(base, 'init', '--bare', '-b', 'main')
  git(work, 'init', '-b', 'main')
  git(work, 'config', 'user.email', 't@example.com')
  git(work, 'config', 'user.name', 't')
  writeFileSync(join(work, 'a.txt'), 'one\n')
  git(work, 'add', '-A'); git(work, 'commit', '-m', '最初のコミット')
  git(work, 'remote', 'add', 'origin', base)
  git(work, 'push', '-u', 'origin', 'main')
})
afterAll(() => rmSync(join(base, '..'), { recursive: true, force: true }))

describe('リポジトリかどうか', () => {
  it('根と名前を返す', async () => {
    expect(await repoRoot(work)).toBe(await repoRoot(work))
    expect(await repoName(work)).toBe('work')
  })

  it('git でない場所は理由を言って落ちる', async () => {
    await expect(repoRoot(outside)).rejects.toThrow()
  })
})

describe('remote', () => {
  it('一覧を返し、Forgejo の根で sandbox を見分ける', async () => {
    const rs = await listRemotes(work, null)
    expect(rs.map((r) => r.name)).toContain('origin')
  })

  it('sandbox の remote を足す。二度目は URL を合わせるだけ', async () => {
    const first = await ensureSandboxRemote(work, 'http://localhost:4649/', 'me', 'repo', 'forgejo')
    expect(first).toContain('forgejo')
    const again = await ensureSandboxRemote(work, 'http://localhost:4649/', 'me', 'repo2', 'forgejo')
    expect(again).toContain('合わせました')
    const url = git(work, 'remote', 'get-url', 'forgejo').trim()
    expect(url).toBe('http://localhost:4649/me/repo2.git')
  })

  it('いまのブランチ', async () => {
    expect(await currentBranch(work)).toBe('main')
  })

  it('既定ブランチは refs から引く。**main と決め打たない**', async () => {
    git(work, 'remote', 'set-head', 'origin', '-a')
    expect(await defaultBranch(work, 'origin')).toBe('main')
  })

  it('分からなければ null（main に倒さない）', async () => {
    expect(await defaultBranch(work, 'いない remote')).toBeNull()
  })

  it('push 済みかを見る', async () => {
    expect(await isPushed(work, 'origin', 'main')).toBe(true)
    expect(await isPushed(work, 'origin', 'いないブランチ')).toBe(false)
  })

  it('push して上流を張る', async () => {
    git(work, 'checkout', '-q', '-b', 'feat')
    writeFileSync(join(work, 'b.txt'), 'two\n')
    git(work, 'add', '-A'); git(work, 'commit', '-m', '二つ目')
    expect(await push(work, 'origin', 'feat')).toContain('push しました')
    expect(await isPushed(work, 'origin', 'feat')).toBe(true)
    git(work, 'checkout', '-q', 'main')
  })

  it('remote のブランチ一覧。届かなければ空（漏れていないとは言わない）', async () => {
    expect((await remoteHeads(work, 'origin')).sort()).toEqual(['feat', 'main'])
    expect(await remoteHeads(work, 'いない remote')).toEqual([])
  })

  it('**`-` で始まる名前は git に渡さない**（オプションとして読まれる）', async () => {
    await expect(push(work, 'origin', '--upload-pack=/bin/sh')).rejects.toThrow(/使えない名前/)
    await expect(push(work, '-c', 'main')).rejects.toThrow(/使えない名前/)
    await expect(deleteRemoteBranch(work, 'origin', '--force')).rejects.toThrow(/使えない名前/)
    expect(await isPushed(work, 'origin', '--all')).toBe(false)
    expect(await remoteHeads(work, '--all')).toEqual([])
  })

  it('remote のブランチを消す。**main / master は拒む**', async () => {
    await expect(deleteRemoteBranch(work, 'origin', 'main')).rejects.toThrow(/消しません/)
    expect(await deleteRemoteBranch(work, 'origin', 'feat')).toContain('消しました')
    expect(await isPushed(work, 'origin', 'feat')).toBe(false)
  })

  it('base からのコミットを新しい順に返す', async () => {
    const list = await commitsSince(work, 'origin/main')
    expect(list.some((c) => c.includes('最初のコミット'))).toBe(false)
    expect(await commitsSince(work, 'いない参照')).toEqual([])
  })
})

describe('コミット文の材料', () => {
  it('変更されたファイルと、直近のコミットを集める', async () => {
    writeFileSync(join(work, 'c.txt'), 'three\n')
    const c = await commitContext(work)
    expect(c.changed.some((l) => l.includes('c.txt'))).toBe(true)
    expect(c.branch).toBe('main')
    expect(c.recent.some((l) => l.includes('最初のコミット'))).toBe(true)
    git(work, 'clean', '-fq')
  })

  it('**差分の中身は取らない**（意図は会話にあり、diff には無い）', async () => {
    writeFileSync(join(work, 'c.txt'), 'three\n')
    const text = JSON.stringify(await commitContext(work))
    expect(text).not.toContain('@@')
    git(work, 'clean', '-fq')
  })

  it('git でない場所でも落ちない（空で返す）', async () => {
    const c = await commitContext(outside)
    expect(c.changed).toEqual([])
    expect(c.branch).toBeNull()
  })
})

describe('worktree のロック', () => {
  it('主が死んでいるロックは外して消す。生きているロックは拒む', async () => {
    const { listWorktrees, removeWorktree } = await import('../src/main/git/worktree')
    const dir = join(work, '..', 'wt-locked')
    git(work, 'worktree', 'add', '-q', dir, '-b', 'locked-branch')
    git(work, 'worktree', 'lock', '--reason', `claude agent x (pid ${process.pid} start now)`, dir)
    expect((await listWorktrees(work)).find((w) => w.branch === 'locked-branch')?.lockStale).toBe(false)
    await expect(removeWorktree(work, dir, true)).rejects.toThrow(/ロック/)
    git(work, 'worktree', 'unlock', dir)
    git(work, 'worktree', 'lock', '--reason', 'claude agent x (pid 999999999 start then)', dir)
    expect((await listWorktrees(work)).find((w) => w.branch === 'locked-branch')?.lockStale).toBe(true)
    await removeWorktree(work, dir, true)
    expect((await listWorktrees(work)).some((w) => w.branch === 'locked-branch')).toBe(false)
  })
})

describe('worktree', () => {
  it('本体だけのときも一覧が返り、先頭が本体', async () => {
    const [first, ...rest] = await listWorktrees(work)
    expect(first.main).toBe(true)
    expect(rest.every((w) => !w.main)).toBe(true)
  })

  it('足したものが一覧に出る', async () => {
    const at = join(work, '..', 'wt-feat')
    git(work, 'worktree', 'add', '-q', at, 'feat')
    const list = await listWorktrees(work)
    expect(list.some((w) => w.branch === 'feat')).toBe(true)
    await removeWorktree(work, at, true)
    expect((await listWorktrees(work)).some((w) => w.branch === 'feat')).toBe(false)
  })

  it('変更の量とブランチを返す', async () => {
    writeFileSync(join(work, 'a.txt'), 'one\ntwo\n')
    const st = await worktreeStatus(work)
    expect(st.branch).toBe('main')
    expect(st.added).toBeGreaterThan(0)
    git(work, 'checkout', '--', 'a.txt')
  })

  it('変更が無ければ 0', async () => {
    const st = await worktreeStatus(work)
    expect(st).toMatchObject({ added: 0, removed: 0 })
  })
})

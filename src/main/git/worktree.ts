import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { parseWorktrees, validateNewWorktree, worktreePathFor, canRemove, type Worktree } from '../../shared/worktree'
import { loginShellEnv } from '../claude/locate'

const exec = promisify(execFile)

/**
 * git worktree を実際に操作する。
 *
 * 解釈と検査は `shared/worktree.ts`（純粋関数）が持つ。ここは走らせるだけ。
 * この分け方のおかげで、並列の要である検査に git も実リポジトリも要らない。
 */

/** worktree の置き場。共有フォルダ（§12）と同じ ~/.izuna/ 配下に揃える */
export const WORKTREE_BASE = join(homedir(), '.izuna', 'worktrees')

async function git(cwd: string, args: string[]): Promise<string> {
  const env = await loginShellEnv()
  try {
    const { stdout } = await exec('git', args, { cwd, env, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    // git の言い分をそのまま人に見せる。握りつぶすと原因が分からなくなる
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
    }
}

/** git リポジトリかどうか。**失敗を例外にしない** —— 呼び出し側で分岐する */
export async function isRepo(cwd: string): Promise<boolean> {
  try {
    await git(cwd, ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

/** cwd を含むリポジトリの本体。worktree の中から呼んでも本体を返す */
export async function repoRoot(cwd: string): Promise<string> {
  let common: string
  try {
    common = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  } catch (err) {
    // git の生の文言（fatal: not a git repository...）は何をすべきか言わない
    if (/not a git repository/i.test(String(err))) {
      throw new Error(`${cwd} は git リポジトリではありません。リポジトリのパスを入れるか、worktree を使わずに起こしてください`)
    }
    throw err
  }
  // <root>/.git → <root>。bare の場合はそのまま
  return common.replace(/\/\.git\/?$/, '')
}

export async function repoName(cwd: string): Promise<string> {
  return basename(await repoRoot(cwd))
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  return parseWorktrees(await git(cwd, ['worktree', 'list', '--porcelain']))
}

export interface CreatedWorktree {
  path: string
  branch: string
}

/**
 * ブランチごと新しい worktree を作る。
 *
 * **作る前に検査を通す。** git に任せて失敗させるより、理由を先に見せたほうが
 * 直しやすい（`validateNewWorktree`）。
 */
export async function createWorktree(cwd: string, branch: string): Promise<CreatedWorktree> {
  const root = await repoRoot(cwd)
  const path = worktreePathFor(WORKTREE_BASE, basename(root), branch)
  const existing = await listWorktrees(root)

  const problem = validateNewWorktree(existing, branch, path)
  if (problem) throw new Error(problem)

  await git(root, ['worktree', 'add', '-b', branch, path])
  return { path, branch }
}

/** 既にあるブランチで開く（作らない） */
export async function openWorktree(cwd: string, branch: string): Promise<CreatedWorktree> {
  const root = await repoRoot(cwd)
  const path = worktreePathFor(WORKTREE_BASE, basename(root), branch)
  await git(root, ['worktree', 'add', path, branch])
  return { path, branch }
}

/**
 * 畳む。**push していない変更があれば止める**（`force` で押し切れる）。
 * 消してから気づくと戻せない。
 */
export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const root = await repoRoot(cwd)
  const target = (await listWorktrees(root)).find((w) => w.path === path)
  if (!target) throw new Error(`worktree が見つかりません: ${path}`)

  const problem = canRemove(target)
  if (problem) throw new Error(problem)

  await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), path])
}

export interface WorktreeStatus {
  /** 変更のあるファイル数 */
  changed: number
  ahead: number
  behind: number
  branch: string | null
}

/** 一覧に出す状態。`git status -sb --porcelain=v2` を読む */
export async function worktreeStatus(path: string): Promise<WorktreeStatus> {
  const out = await git(path, ['status', '--porcelain=v2', '--branch'])
  let changed = 0
  let ahead = 0
  let behind = 0
  let branch: string | null = null

  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (/^[12u?]/.test(line)) {
      changed++
    }
  }
  return { changed, ahead, behind, branch }
}

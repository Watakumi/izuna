import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { realpathSync } from 'node:fs'
import { basename } from 'node:path'
import { parseWorktrees, canRemove, type Worktree } from '../../shared/worktree'
import { loginShellEnv } from '../claude/locate'

const exec = promisify(execFile)

/**
 * git worktree を実際に操作する。
 *
 * 解釈と検査は `shared/worktree.ts`（純粋関数）が持つ。ここは走らせるだけ。
 * この分け方のおかげで、並列の要である検査に git も実リポジトリも要らない。
 */

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

/**
 * **worktree を作る機能は落とした**（2026-09-08）。
 *
 * 隔離するのはエージェントの仕事で、`EnterWorktree` を呼んで
 * `<project>/.claude/worktrees/` に作る（CLAUDE.md §12 の実測）。
 * Izuna も `~/.izuna/worktrees/` に作っていたので、**同じリポジトリの
 * worktree が 2 箇所に散っていた**。片方を落とすほうが筋が通る。
 *
 * ここに残すのは**見ることと畳むこと**だけ。`git worktree list` を読むので、
 * エージェントが作ったものもそのまま一覧に出る。
 */

/**
 * 消す。**push していない変更があれば止める**（`force` で押し切れる）。
 * 消してから気づくと戻せない。
 *
 * **パスは文字列で照合しない。** macOS の `/var` は `/private/var` への
 * symlink で、git は解決後の絶対パスを返す。渡ってくるパスが解決前だと
 * 「見つかりません」になる —— `WorktreeCreate` フックが返すパスでも起きうる。
 */
export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const root = await repoRoot(cwd)
  const same = (a: string, b: string): boolean => {
    if (a === b) return true
    try {
      return realpathSync(a) === realpathSync(b)
    } catch {
      return false
    }
  }
  const target = (await listWorktrees(root)).find((w) => same(w.path, path))
  if (!target) throw new Error(`worktree が見つかりません: ${path}`)

  const problem = canRemove(target)
  if (problem) throw new Error(problem)

  await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), target.path])
}

export interface WorktreeStatus {
  /** 変更のあるファイル数 */
  changed: number
  /** 増えた行 / 減った行。モックの `+34 −8` にあたる */
  added: number
  removed: number
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
  // 行数は別に聞く。status では取れない
  let added = 0
  let removed = 0
  try {
    const stat = await git(path, ['diff', '--shortstat', 'HEAD'])
    added = Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0)
    removed = Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0)
  } catch {
    // コミットが 1 つも無いと HEAD が無い。0 のままでよい
  }

  return { changed, added, removed, ahead, behind, branch }
}

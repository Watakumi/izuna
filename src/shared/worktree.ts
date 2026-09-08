/**
 * git worktree の扱い。
 *
 * 純粋関数（git を起動しない。§4 の原則）。実際に走らせるのは
 * `main/git/worktree.ts` の役目で、ここは**出力の解釈と、作る前の検査**だけを持つ。
 *
 * 段3 の要。実行役ごとに worktree を分けるので、ここが崩れると
 * 並列そのものが成り立たない。
 */

export interface Worktree {
  path: string
  head: string | null
  /** `refs/heads/x` を `x` に直したもの。detached なら null */
  branch: string | null
  detached: boolean
  bare: boolean
  /** ロックされていれば理由（理由なしのときは空文字） */
  locked: string | null
  /** 掃除対象なら理由 */
  prunable: string | null
  /** 最初のエントリが本体。消してはいけない */
  main: boolean
}

/**
 * `git worktree list --porcelain` を読む。
 *
 * 実出力（git 2.54）:
 * ```
 * worktree /path/to/repo
 * HEAD 5a33038...
 * branch refs/heads/main
 *
 * worktree /private/tmp/x
 * HEAD 5a33038...
 * detached
 * ```
 * 空行が区切り。属性は行頭の語で、値のないものもある。
 */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = []
  let current: Partial<Worktree> | null = null

  const flush = (): void => {
    if (current?.path) {
      out.push({
        path: current.path,
        head: current.head ?? null,
        branch: current.branch ?? null,
        detached: current.detached ?? false,
        bare: current.bare ?? false,
        locked: current.locked ?? null,
        prunable: current.prunable ?? null,
        main: out.length === 0
      })
    }
    current = null
  }

  for (const raw of porcelain.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') {
      flush()
      continue
    }
    const at = line.indexOf(' ')
    const key = at === -1 ? line : line.slice(0, at)
    const value = at === -1 ? '' : line.slice(at + 1)

    switch (key) {
      case 'worktree':
        flush()
        current = { path: value }
        break
      case 'HEAD':
        if (current) current.head = value
        break
      case 'branch':
        if (current) current.branch = value.replace(/^refs\/heads\//, '')
        break
      case 'detached':
        if (current) current.detached = true
        break
      case 'bare':
        if (current) current.bare = true
        break
      case 'locked':
        if (current) current.locked = value
        break
      case 'prunable':
        if (current) current.prunable = value
        break
      default:
        // 知らない属性は落とす。git が増やしても壊れない
        break
    }
  }
  flush()
  return out
}

/** ディレクトリ名に使える形にする。`feat/x` → `feat-x` */
export function slugifyBranch(branch: string): string {
  return branch
    .trim()
    .replace(/^[/.]+|[/.]+$/g, '')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60)
}

/**
 * **置き場所を決める関数は落とした**（2026-09-08）。
 *
 * worktree を作るのはエージェントで、`EnterWorktree` が
 * `<project>/.claude/worktrees/` に作る（CLAUDE.md §12 の実測）。
 * Izuna も `~/.izuna/worktrees/` に作っていたので二重になっていた。
 * `slugifyBranch` は一覧の表示で使うので残す。
 */

/** 消してよいか。本体とロック中は消させない */
export function canRemove(worktree: Worktree): string | null {
  if (worktree.main) return '本体の作業ツリーは消せません'
  if (worktree.locked !== null) {
    return worktree.locked ? `ロックされています: ${worktree.locked}` : 'ロックされています'
  }
  return null
}

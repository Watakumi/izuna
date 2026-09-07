import { slugifyBranch } from './worktree'

/**
 * やることからブランチ名を作る。
 *
 * **人間にブランチ名を考えさせない。** 人が考えるのは「この Issue をやりたい」
 * であって、worktree を作るかどうかでもブランチ名でもない。
 * worktree もブランチも**結果**であって、選択肢ではない。
 *
 * 純粋関数。名前が読めるものになるかは検査で固定する。
 */

/** 日本語などを落とすと空になる。そのときの逃げ道が要る */
function asciiSlug(text: string, max = 32): string {
  const slug = slugifyBranch(
    text
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, ' ') // 非 ASCII は落とす。ディレクトリ名にすると壊れやすい
  )
  return slug.slice(0, max).replace(/-+$/, '')
}

/**
 * Issue から。**番号を必ず先頭に置く。**
 * 題が日本語で slug が空になっても、番号があれば何の作業か辿れる。
 */
export function branchFromIssue(number: number, title: string): string {
  const slug = asciiSlug(title)
  return slug ? `issue-${number}-${slug}` : `issue-${number}`
}

/** 自由入力から。空になったら日付で逃がす */
export function branchFromText(text: string, now = new Date()): string {
  const slug = asciiSlug(text)
  if (slug) return `task-${slug}`
  const stamp = now.toISOString().slice(5, 16).replace(/[-:T]/g, '')
  return `task-${stamp}`
}

/** 既にある名前とぶつからないようにする。`-2`, `-3` と足す */
export function uniqueBranch(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`
    if (!taken.includes(candidate)) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

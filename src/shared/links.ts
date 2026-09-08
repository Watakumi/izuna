/**
 * 会話に出るリンクをどこへ逃がすか。
 *
 * 本文のリンクは LLM が書く。読ませたファイルや Web に仕込まれた文を
 * そのまま書くこともある。`shell.openExternal` は macOS の `open` と同じで、
 * `file:///Applications/X.app` も `vscode://` も `ssh://` も**アプリを起動する**。
 * クリックひとつで外の道具が動くのは、リンクに期待する振る舞いではない。
 *
 * ここは判定だけ（§4 の原則）。呼ぶのは `main/index.ts`。
 */

/** 既定のブラウザ（またはメール）に渡してよいもの */
const OUTSIDE = new Set(['http:', 'https:', 'mailto:'])

export function openableOutside(url: string): boolean {
  try {
    return OUTSIDE.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * 自分の画面の中の遷移か。
 *
 * **`origin` で比べない。** `file://` の origin は両辺とも `"null"` になり、
 * どんなローカルファイルへの遷移も同一と判定される（2026-09-08 に確認）。
 * `file:` は同じディレクトリの中だけ、それ以外は origin が同じときだけ。
 */
export function isOwnPage(url: string, here: string): boolean {
  let to: URL
  let at: URL
  try {
    to = new URL(url)
    at = new URL(here)
  } catch {
    return false
  }
  if (to.protocol !== at.protocol) return false
  if (to.protocol === 'file:') {
    const dir = at.pathname.replace(/[^/]*$/, '')
    return to.pathname.startsWith(dir)
  }
  return to.origin === at.origin
}

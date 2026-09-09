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
  // 独自スキーム（app:）は Node の URL では origin が "null" になる。host で比べる
  if (to.protocol === 'app:') return to.host === at.host
  return to.origin === at.origin
}

/**
 * 外に出してよいか。**自分の origin と同じ http は出さない。**
 *
 * 本文の相対リンク（`./src/a.ts`）は dev では dev サーバの URL に解決される。
 * それを既定のブラウザに渡すと、真っ白なページか 404 が開く。
 * 漏れたファイルリンクであって、サイトではない（Nimbalyst の `windowOpenGuard` と同じ判断）。
 */
export function shouldOpenOutside(url: string, here: string | null): boolean {
  if (!openableOutside(url)) return false
  if (!here) return true
  try {
    const to = new URL(url)
    const at = new URL(here)
    if (to.protocol.startsWith('http') && at.protocol.startsWith('http') && to.origin === at.origin) return false
  } catch {
    return true
  }
  return true
}

const GITHUB = new Set(['github.com', 'www.github.com'])

/**
 * 窓の中に埋めて見てよい頁か（PR の頁を Izuna から出ずに見る。§32）。
 *
 * **Forgejo と GitHub だけ。** 埋める頁は別の webContents で、リンクを踏めばどこへでも行ける。
 * 行き先を forge に限れば、本文に仕込まれたリンクで見知らぬ頁を開くことは無い。
 * http は Forgejo の根がそうであるときだけ（ループバックの Forgejo は http。§26 の tokenMayTravel と同じ線）。
 */
export function canPreview(url: string, forgeRootUrl: string | null): boolean {
  let to: URL
  try {
    to = new URL(url)
  } catch {
    return false
  }
  if (to.protocol === 'https:' && GITHUB.has(to.host.toLowerCase())) return true
  if (!forgeRootUrl) return false
  try {
    const forge = new URL(forgeRootUrl)
    return to.protocol === forge.protocol && to.host.toLowerCase() === forge.host.toLowerCase()
  } catch {
    return false
  }
}

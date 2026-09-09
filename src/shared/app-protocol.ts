import { extname, normalize, sep } from 'node:path'

/**
 * renderer を `app://renderer/…` で配る（§26「配るための固め」）。
 *
 * `file://` で読むと Electron は file スキームに余計な権限を与える
 * （fuse の `GrantFileProtocolExtraPrivileges`）。独自スキームにすれば、その fuse を切れる。
 * ここは URL → 出力ディレクトリの中のパス、の対応だけ（純粋関数）。
 * **出力ディレクトリの外は返さない。** `..` も、絶対パスも、別の host も断る。
 */
export const APP_SCHEME = 'app'
export const APP_HOST = 'renderer'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

export function resolveAppPath(url: string, root: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${APP_SCHEME}:` || u.host !== APP_HOST) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(u.pathname)
  } catch {
    return null
  }
  if (pathname === '' || pathname === '/') pathname = '/index.html'
  if (pathname.includes('\0')) return null
  const base = normalize(root + sep)
  const full = normalize(root + sep + pathname.replace(/^\/+/, ''))
  if (!full.startsWith(base)) return null
  return full
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
}

export function mimeOf(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

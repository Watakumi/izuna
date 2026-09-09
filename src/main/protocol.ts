import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { APP_SCHEME, mimeOf, resolveAppPath } from '../shared/app-protocol'

/**
 * `app://renderer/…` を出力ディレクトリから配る（§26）。
 *
 * `registerAppScheme` は **`app.whenReady()` より前**に呼ぶ（Electron の決まり）。
 * `standard` で origin を持たせ（CSP の 'self' が効く）、`secure` で https と同じ扱いにする。
 * 配るのは `resolveAppPath` が返したものだけ。外は 404。
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
    }
  ])
}

export function serveApp(root: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const path = resolveAppPath(request.url, root)
    if (!path) return new Response('not found', { status: 404 })
    try {
      const body = await readFile(path)
      return new Response(body, { headers: { 'content-type': mimeOf(path) } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

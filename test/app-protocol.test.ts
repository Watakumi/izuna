import { describe, expect, it } from 'vitest'
import { APP_ORIGIN, mimeOf, resolveAppPath } from '../src/shared/app-protocol'

/** renderer を app:// で配る。出力ディレクトリの外は返さない（§26） */
const root = '/opt/izuna/out/renderer'

describe('app:// の URL をパスに', () => {
  it('中のファイルはそのまま。根は index.html', () => {
    expect(resolveAppPath(`${APP_ORIGIN}/index.html`, root)).toBe(`${root}/index.html`)
    expect(resolveAppPath(`${APP_ORIGIN}/assets/index-abc.js`, root)).toBe(
      `${root}/assets/index-abc.js`
    )
    expect(resolveAppPath(`${APP_ORIGIN}/`, root)).toBe(`${root}/index.html`)
    expect(resolveAppPath(`${APP_ORIGIN}/a%20b.css`, root)).toBe(`${root}/a b.css`)
  })

  it('**外へは出られない**。.. も、エンコードした .. も、別の host も、別のスキームも', () => {
    // URL の段で `..` は畳まれて /etc/passwd になる。それでも根の中に留まる
    expect(resolveAppPath(`${APP_ORIGIN}/../../etc/passwd`, root)).toBe(`${root}/etc/passwd`)
    // エンコードした .. も URL の段で畳まれる。根の中に留まる
    expect(resolveAppPath(`${APP_ORIGIN}/assets/%2e%2e/%2e%2e/secret`, root)).toBe(`${root}/secret`)
    expect(resolveAppPath(`${APP_ORIGIN}/a%00b`, root)).toBeNull()
    expect(resolveAppPath('app://evil/index.html', root)).toBeNull()
    expect(resolveAppPath('file:///etc/passwd', root)).toBeNull()
    expect(resolveAppPath('not a url', root)).toBeNull()
    expect(resolveAppPath(`${APP_ORIGIN}/%E0%A4%A`, root)).toBeNull()
  })

  it('MIME は拡張子から。知らないものは octet-stream', () => {
    expect(mimeOf('/x/index.html')).toContain('text/html')
    expect(mimeOf('/x/a.js')).toContain('javascript')
    expect(mimeOf('/x/a.wasm')).toBe('application/wasm')
    expect(mimeOf('/x/a.unknown')).toBe('application/octet-stream')
  })
})

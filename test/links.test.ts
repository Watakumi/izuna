import { describe, expect, it } from 'vitest'
import { canPreview, isOwnPage, openableOutside, shouldOpenOutside } from '../src/shared/links'

/**
 * 本文のリンクは LLM が書く。クリックで何が起動するかを本文に委ねない（§26）。
 */
describe('外に出してよいもの', () => {
  it('http / https / mailto だけ', () => {
    expect(openableOutside('https://example.com/x')).toBe(true)
    expect(openableOutside('http://localhost:4649/')).toBe(true)
    expect(openableOutside('mailto:a@b')).toBe(true)
  })

  it('**アプリを起動するものは出さない**', () => {
    expect(openableOutside('file:///Applications/Calculator.app')).toBe(false)
    expect(openableOutside('vscode://file/etc/passwd')).toBe(false)
    expect(openableOutside('ssh://root@host')).toBe(false)
    expect(openableOutside('javascript:alert(1)')).toBe(false)
    expect(openableOutside('not a url')).toBe(false)
  })
})

describe('自分の画面の中か', () => {
  it('dev サーバは origin が同じなら中', () => {
    expect(isOwnPage('http://localhost:5173/#x', 'http://localhost:5173/')).toBe(true)
    expect(isOwnPage('http://evil.example/', 'http://localhost:5173/')).toBe(false)
  })

  it('**file: は origin で比べない**（両辺 "null" で何でも同一になる）', () => {
    const here = 'file:///app/out/renderer/index.html'
    expect(isOwnPage('file:///app/out/renderer/index.html#a', here)).toBe(true)
    expect(isOwnPage('file:///etc/passwd', here)).toBe(false)
    expect(isOwnPage('file:///app/out/renderer/../../evil.html', here)).toBe(false)
  })

  it('スキームが違えば外', () => {
    expect(isOwnPage('https://localhost:5173/', 'http://localhost:5173/')).toBe(false)
    expect(isOwnPage('::', 'http://localhost:5173/')).toBe(false)
  })
})

describe('外に出すか（自分の origin を見る）', () => {
  it('**dev サーバと同じ origin の http は出さない**（本文の相対リンクが漏れたもの）', () => {
    expect(shouldOpenOutside('http://localhost:5173/src/a.ts', 'http://localhost:5173/')).toBe(false)
    expect(shouldOpenOutside('https://example.com/', 'http://localhost:5173/')).toBe(true)
  })

  it('本番（file://）からは http なら出す', () => {
    expect(shouldOpenOutside('https://example.com/', 'file:///app/index.html')).toBe(true)
    expect(shouldOpenOutside('https://example.com/', null)).toBe(true)
  })

  it('スキームの判定はそのまま', () => {
    expect(shouldOpenOutside('file:///etc/passwd', 'file:///app/index.html')).toBe(false)
    expect(shouldOpenOutside('mailto:a@b', 'http://localhost:5173/')).toBe(true)
  })
})

describe('窓の中に埋めて見てよいか（§32）', () => {
  const forge = 'http://localhost:4649/'
  it('GitHub（https）と Forgejo の根と同じ host だけ', () => {
    expect(canPreview('https://github.com/Watakumi/izuna/pull/3', forge)).toBe(true)
    expect(canPreview('https://www.github.com/x/y', forge)).toBe(true)
    expect(canPreview('http://localhost:4649/izuna/izuna-e2e/pulls/1', forge)).toBe(true)
    expect(canPreview('http://localhost:4649/izuna/izuna-e2e/pulls/1', null)).toBe(false)
  })

  it('それ以外は出さない。http の GitHub も、別 host も、壊れた URL も', () => {
    expect(canPreview('http://github.com/x/y', forge)).toBe(false)
    expect(canPreview('https://example.com/', forge)).toBe(false)
    expect(canPreview('https://localhost:4649/x', forge)).toBe(false)
    expect(canPreview('file:///etc/passwd', forge)).toBe(false)
    expect(canPreview('not a url', forge)).toBe(false)
    // GitHub は Forgejo の設定に関係なく通る。Forgejo の根が壊れていれば Forgejo 側だけ落ちる
    expect(canPreview('https://github.com/x', 'not a url')).toBe(true)
    expect(canPreview('http://localhost:4649/x', 'not a url')).toBe(false)
  })
})

describe('app:// の中の遷移（§26）', () => {
  it('同じ host なら中。別の host や別のスキームは外', () => {
    expect(isOwnPage('app://renderer/assets/x.js', 'app://renderer/index.html')).toBe(true)
    expect(isOwnPage('app://evil/index.html', 'app://renderer/index.html')).toBe(false)
    expect(isOwnPage('https://github.com/x', 'app://renderer/index.html')).toBe(false)
    // 外へ出す判定は http(s) だけなので、app:// のリンクは外に出さない
    expect(shouldOpenOutside('app://renderer/x', 'app://renderer/index.html')).toBe(false)
    expect(shouldOpenOutside('https://github.com/x', 'app://renderer/index.html')).toBe(true)
  })
})

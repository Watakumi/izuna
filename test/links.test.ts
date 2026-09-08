import { describe, expect, it } from 'vitest'
import { isOwnPage, openableOutside, shouldOpenOutside } from '../src/shared/links'

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

import { describe, expect, it } from 'vitest'
import { isOwnPage, openableOutside } from '../src/shared/links'

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

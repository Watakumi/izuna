import { describe, expect, it } from 'vitest'
import { createMasker, hasMark, MASK_PREFIX } from '../src/shared/mask'

/**
 * 鍵を API に出さないための覆い（security.md §36）。
 *
 * **作り物の鍵は行を分けて組む。** そのまま書くと gitleaks が push を止める（§26 の罠）。
 */
const j = (...parts: string[]): string => parts.join('')

describe('覆い', () => {
  it('見つけた形を札に替え、同じ実値には同じ札を返す', () => {
    const m = createMasker()
    const key = j('sk-', 'ant-', 'api03', '-AAAABBBBCCCCDDDD')
    const out = m.maskText(`A=${key} B=${key}`)
    expect(out).not.toContain(key)
    expect(out).toBe(`A=${MASK_PREFIX}1⟧ B=${MASK_PREFIX}1⟧`)
    expect(m.size).toBe(1)
  })

  it('**往復する。** 札を実値に戻せる', () => {
    const m = createMasker()
    const token = j('ghp_', 'ABCDEFGHIJKLMNOP', '1234567890')
    const masked = m.maskText(`git push https://x:${token}@host/r.git`)
    expect(masked).not.toContain(token)
    expect(m.unmaskText(masked)).toContain(token)
  })

  it('覆っていない札は、そのまま残す（他所で作った字を実値に化けさせない）', () => {
    const m = createMasker()
    expect(m.unmaskText(`${MASK_PREFIX}9⟧`)).toBe(`${MASK_PREFIX}9⟧`)
  })

  it('gcloud の鍵と短命トークン、PEM、JWT を捕まえる', () => {
    const m = createMasker()
    const cases = [
      j('AIza', 'SyA', 'BCDEFGHIJKLMNOPQRSTUVWXYZ012345'),
      j('ya29.', 'a0AfH6SMBxxxxxxxxxxxxxxxxxxxxx'),
      j('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dQw4w9WgXcQdQw4w9WgXcQ'),
      j('-----BEGIN RSA PRIVATE KEY-----\n', 'AAAA\nBBBB\n', '-----END RSA PRIVATE KEY-----')
    ]
    for (const c of cases) {
      const out = m.maskText(`x ${c} y`)
      expect(out, c.slice(0, 12)).not.toContain(c)
    }
  })

  it('.env の**値だけ**を伏せ、鍵の名前は残す（何が伏せられたか読めるように）', () => {
    const m = createMasker()
    const out = m.maskText('export API_KEY=abcdefghijklmnop\nPORT=4649\n')
    expect(out).toContain('export API_KEY=')
    expect(out).not.toContain('abcdefghijklmnop')
    // 鍵らしくない行は触らない
    expect(out).toContain('PORT=4649')
  })

  it('入れ子でも形を変えずに替えて戻す', () => {
    const m = createMasker()
    const key = j('sk-', 'ant-', 'zzzz', 'YYYYXXXXWWWW')
    const masked = m.mask({ file: { content: `K=${key}`, lines: 1 } }) as {
      file: { content: string; lines: number }
    }
    expect(masked.file.content).not.toContain(key)
    expect(masked.file.lines).toBe(1)
    expect(hasMark(masked)).toBe(true)
    expect(m.unmask(masked)).toEqual({ file: { content: `K=${key}`, lines: 1 } })
  })

  it('JSON にできないものは触らない。札が無ければ false（2 回聞いても同じ）', () => {
    const m = createMasker()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(m.mask(cyclic)).toBe(cyclic)
    expect(hasMark('ふつうの字')).toBe(false)
    expect(hasMark('ふつうの字')).toBe(false)
    expect(hasMark(`${MASK_PREFIX}1⟧`)).toBe(true)
    expect(hasMark(`${MASK_PREFIX}1⟧`)).toBe(true)
  })
})

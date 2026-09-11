import { describe, expect, it } from 'vitest'
import { isMarkdown, looksText, normalize, readableUnder } from '../src/shared/readfile'

/** 中で読むファイルの関所（§34）。作業ディレクトリの外は読まない */
describe('readableUnder', () => {
  it('根の中だけ。根そのものも可', () => {
    expect(readableUnder(['/w'], '/w/src/a.ts')).toBe(true)
    expect(readableUnder(['/w'], '/w')).toBe(true)
    expect(readableUnder(['/w', '/w2'], '/w2/b.md')).toBe(true)
  })

  it('**前方一致だけで判定しない。** /w は /work に当たらない', () => {
    expect(readableUnder(['/w'], '/work/a.ts')).toBe(false)
  })

  it('.. で外に出られない', () => {
    expect(readableUnder(['/w'], '/w/../etc/passwd')).toBe(false)
    expect(readableUnder(['/w'], '/w/src/../../etc/passwd')).toBe(false)
    expect(readableUnder(['/w'], '/w/src/../lib/a.ts')).toBe(true)
  })

  it('相対の路は受け取らない', () => {
    expect(readableUnder(['/w'], 'src/a.ts')).toBe(false)
    expect(readableUnder(['/w'], '')).toBe(false)
  })

  it('根が無ければ何も読めない', () => {
    expect(readableUnder([], '/w/a.ts')).toBe(false)
  })
})

describe('normalize', () => {
  it('. と .. を畳み、末尾の / を落とす', () => {
    expect(normalize('/a/./b/../c/')).toBe('/a/c')
    expect(normalize('/')).toBe('/')
    expect(normalize('/a//b')).toBe('/a/b')
  })
})

describe('looksText と isMarkdown', () => {
  it('NUL があれば字として出さない', () => {
    expect(looksText(new TextEncoder().encode('# 見出し\nあ'))).toBe(true)
    expect(looksText(new Uint8Array([0x89, 0x50, 0x00, 0x4e]))).toBe(false)
  })

  it('markdown だけ木で描く', () => {
    expect(isMarkdown('/w/README.md')).toBe(true)
    expect(isMarkdown('/w/a.MDX')).toBe(true)
    expect(isMarkdown('/w/src/a.ts')).toBe(false)
  })
})

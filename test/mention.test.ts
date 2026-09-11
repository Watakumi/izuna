import { describe, expect, it } from 'vitest'
import {
  appendMention,
  mentionDiff,
  mentionFile,
  mentionLines,
  relativeTo
} from '../src/shared/mention'

/** 対象を指して会話を始める（§34）。入力欄に入れる文を作るだけ */
describe('指す文', () => {
  it('作業ディレクトリからの相対。外のものは絶対のまま', () => {
    expect(relativeTo('/w', '/w/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/w/', '/w/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('/w', '/other/a.ts')).toBe('/other/a.ts')
  })

  it('ファイル・行・範囲・差分', () => {
    expect(mentionFile('/w', '/w/src/a.ts')).toBe('src/a.ts について: ')
    expect(mentionLines('/w', '/w/src/a.ts', 12, 12)).toBe('src/a.ts:12 について: ')
    expect(mentionLines('/w', '/w/src/a.ts', 12, 20)).toBe('src/a.ts:12-20 について: ')
    expect(mentionDiff('/w', '/w/src/a.ts')).toBe('src/a.ts の差分について: ')
  })

  it('選ぶ向きで文が変わらない', () => {
    expect(mentionLines('/w', '/w/a.ts', 20, 12)).toBe(mentionLines('/w', '/w/a.ts', 12, 20))
  })
})

describe('appendMention', () => {
  it('空なら入れるだけ。打ちかけがあれば行を変えて足す', () => {
    expect(appendMention('', 'a.ts について: ')).toBe('a.ts について: ')
    expect(appendMention('直して', 'a.ts について: ')).toBe('直して\na.ts について: ')
  })

  it('**打ちかけの文を捨てない。** 同じものは 2 度足さない', () => {
    const once = appendMention('直して', 'a.ts について: ')
    expect(appendMention(once, 'a.ts について: ')).toBe(once)
  })

  it('末尾の空白は畳む（行が増え続けない）', () => {
    expect(appendMention('直して\n\n', 'a.ts について: ')).toBe('直して\na.ts について: ')
  })
})

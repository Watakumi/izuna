import { describe, expect, it } from 'vitest'
import { byteLength, fromDataUrl, isSupported, rejectReason, toDataUrl } from '../src/shared/image'

/**
 * 貼った画像に対する門。
 *
 * **貼ったのに送られない**のが一番まずいので、断るときは理由を返すことを見る。
 */

const a = (
  over: Partial<Parameters<typeof rejectReason>[0]> = {}
): Parameters<typeof rejectReason>[0] => ({
  mediaType: 'image/png',
  data: 'aGk=',
  name: '',
  ...over
})

describe('送ってよい形か', () => {
  it('SDK が受ける 4 種だけ通す', () => {
    expect(isSupported('image/png')).toBe(true)
    expect(isSupported('image/webp')).toBe(true)
    expect(isSupported('image/svg+xml')).toBe(false)
    expect(isSupported('application/pdf')).toBe(false)
  })

  it('通るものには理由を返さない', () => {
    expect(rejectReason(a())).toBeNull()
  })

  it('**断るときは理由を日本語で返す**', () => {
    expect(rejectReason(a({ mediaType: 'image/svg+xml' }))).toContain('png / jpeg')
    expect(rejectReason(a({ data: '' }))).toContain('空')
  })

  it('大きすぎるものは、大きさを言って断る', () => {
    const r = rejectReason(a({ data: 'A'.repeat(8 * 1024 * 1024) }))
    expect(r).toContain('MB')
    expect(r).toContain('上限')
  })
})

describe('バイト数を復号せずに測る', () => {
  it('詰め物の有無を数に入れる', () => {
    expect(byteLength('aGk=')).toBe(2)
    expect(byteLength('aGVsbG8=')).toBe(5)
    expect(byteLength('aGVsbG8h')).toBe(6)
  })
})

describe('data URL', () => {
  it('分解して名前を付ける', () => {
    const got = fromDataUrl('data:image/png;base64,aGk=', 'a.png')
    expect(got).toEqual({ mediaType: 'image/png', data: 'aGk=', name: 'a.png' })
  })

  it('形が違えば null（推測で埋めない）', () => {
    expect(fromDataUrl('https://example.com/a.png')).toBeNull()
    expect(fromDataUrl('data:image/png,notbase64')).toBeNull()
  })

  it('組み直すと元に戻る', () => {
    const url = 'data:image/jpeg;base64,aGk='
    expect(toDataUrl(fromDataUrl(url)!)).toBe(url)
  })
})

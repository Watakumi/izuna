import { describe, expect, it } from 'vitest'
import {
  atContrast, contrast, isDark, luminance, mergeColors, mix, normalizeHex,
  monoFrom, parseGhosttyConfig, readableOn, readingFrom, skinFrom, type GhosttyColors
} from '../src/shared/ghostty'

/**
 * Ghostty の設定を読む門。
 *
 * 材料は**利用者の実ファイル**から採った形（2026-09-08 実測）。
 * `theme = notion` は同梱ではなく `~/.config/ghostty/themes/notion`（自作）だった。
 */

const REAL_CONFIG = `# コメント
theme = notion
font-family = "JetBrainsMono Nerd Font"
font-family = "BIZ UDGothic"
font-size = 14
background-opacity = 0.95
window-padding-x = 28
`

const REAL_THEME = `# Notion のダークテーマの実測値に寄せたもの。
background = #191919
foreground = #cfcecc
cursor-color = #cfcecc
palette = 0=#3f3f3f
palette = 1=#c4554d
palette = 3=#c29343
palette = 9=#ff7369
palette = 11=#ffdc49
palette = 14=#4dab9a
palette = 15=#ffffff
`

describe('設定の読み取り', () => {
  it('テーマ名とフォントを取る', () => {
    const c = parseGhosttyConfig(REAL_CONFIG)
    expect(c.theme).toBe('notion')
    expect(c.fontFamily).toEqual(['JetBrainsMono Nerd Font', 'BIZ UDGothic'])
  })

  it('知らない鍵は黙って飛ばす（Izuna が知らない設定のほうが多い）', () => {
    expect(parseGhosttyConfig(REAL_CONFIG).colors.background).toBeNull()
  })

  it('palette は番号ごとに入る', () => {
    const { palette } = parseGhosttyConfig(REAL_THEME).colors
    expect(palette[11]).toBe('#ffdc49')
    expect(palette[2]).toBeNull()
  })

  it('dark:/light: の指定は先頭だけ採る', () => {
    expect(parseGhosttyConfig('theme = dark:Aurora,light:Day').theme).toBe('Aurora')
  })

  it('壊れた行で落ちない', () => {
    expect(() => parseGhosttyConfig('=\npalette=\npalette = 99=#fff\nどうでもいい行')).not.toThrow()
  })

  it('# 無し・3桁も受ける（Ghostty が許す形）', () => {
    expect(normalizeHex('ff0000')).toBe('#ff0000')
    expect(normalizeHex('#FFF')).toBe('#ffffff')
    expect(normalizeHex('わからない')).toBeNull()
  })
})

describe('読む面の組み', () => {
  const config = parseGhosttyConfig(REAL_CONFIG)

  it('等幅は利用者の指定が先頭', () => {
    expect(monoFrom(config)[0]).toBe("'JetBrainsMono Nerd Font'")
  })

  it('本文には**2 番目以降だけ**を借りる（先頭は等幅なので欧文に使わない）', () => {
    expect(readingFrom(config).fallbacks).toEqual(["'BIZ UDGothic'"])
  })

  it('font-size を読む', () => {
    expect(readingFrom(config).size).toBe(14)
  })

  it('既定より小さい指定は無視する（長文を読む面なので下げない）', () => {
    expect(readingFrom(parseGhosttyConfig('font-size = 9')).size).toBe(14)
  })

  it('adjust-cell-height を行間に足す', () => {
    // 22% 増し → 1.6 + 0.22
    expect(readingFrom(parseGhosttyConfig('adjust-cell-height = 22%')).lineHeight).toBeCloseTo(1.82, 5)
  })

  it('指定が無くても読める既定に落ちる', () => {
    const r = readingFrom(parseGhosttyConfig(''))
    expect(r).toMatchObject({ fallbacks: [], size: 14 })
    expect(r.lineHeight).toBeGreaterThanOrEqual(1.8)
  })
})

describe('重ね順', () => {
  it('設定ファイル本体がテーマを上書きする（Ghostty と同じ順）', () => {
    const theme = parseGhosttyConfig(REAL_THEME).colors
    const over: GhosttyColors = { background: '#000000', foreground: null, palette: Array(16).fill(null) }
    const merged = mergeColors(theme, over)
    expect(merged.background).toBe('#000000')
    expect(merged.foreground).toBe('#cfcecc')
    expect(merged.palette[11]).toBe('#ffdc49')
  })
})

describe('色の計算', () => {
  it('混ぜる', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('明暗を判る', () => {
    expect(isDark('#191919')).toBe(true)
    expect(isDark('#fdf6e3')).toBe(false)
    expect(luminance('#ffffff')).toBeCloseTo(1, 3)
  })

  it('地に対して読めるほうを選ぶ', () => {
    // 明るい黄の上には暗い字
    expect(readableOn('#ffdc49', '#191919', '#cfcecc')).toBe('#191919')
    // 暗い地の上には明るい字
    expect(readableOn('#191919', '#000000', '#cfcecc')).toBe('#cfcecc')
  })
})

describe('トークンへの割り当て', () => {
  const colors = mergeColors(parseGhosttyConfig(REAL_THEME).colors, parseGhosttyConfig(REAL_CONFIG).colors)
  const skin = skinFrom(colors)!

  it('地と文字がそのまま入る', () => {
    expect(skin.bg).toBe('#191919')
    expect(skin.ink).toBe('#cfcecc')
  })

  it('意味の位置が変わらない —— アンバーは黄、赤は赤', () => {
    expect(skin.amber).toBe('#ffdc49')
    expect(skin.red).toBe('#ff7369')
  })

  it('アンバーの上の字は読める側が選ばれる', () => {
    expect(skin.amberInk).toBe('#191919')
  })

  /**
   * ここが今回の指摘（「字がグレーすぎる」）に対する門である。
   * **目分量で係数を置くと必ず薄くなる。** 比で縛る。
   */
  it('読む字が AA を割らない', () => {
    expect(contrast(skin.bg, skin.ink)).toBeGreaterThanOrEqual(7)
    expect(contrast(skin.bg, skin.ink2)).toBeGreaterThanOrEqual(7)
    expect(contrast(skin.bg, skin.dim)).toBeGreaterThanOrEqual(7)
    expect(contrast(skin.bg, skin.dim2)).toBeGreaterThanOrEqual(5.5)
    // faint は 10px の字に 13 箇所使っている。装飾ではない
    expect(contrast(skin.bg, skin.faint)).toBeGreaterThanOrEqual(4.4)
  })

  it('本文は利用者が選んだ文字色そのもの（勝手に薄めない）', () => {
    expect(skin.ink2).toBe('#cfcecc')
  })

  it('枠は見える（以前は 1.2 で箱が消えていた）', () => {
    expect(contrast(skin.bg, skin.line)).toBeGreaterThanOrEqual(1.5)
  })

  it('地と文字のあいだに段階ができる', () => {
    // `ink2` は `ink` と同じ（本文＝利用者の選んだ色）なので段には入れない
    const steps = [skin.bg, skin.line, skin.line2, skin.faint, skin.dim2, skin.dim, skin.ink]
    const ls = steps.map(luminance)
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1])
  })

  it('明るいテーマでも段階の向きが保たれる（式を分けていない）', () => {
    const light = skinFrom({ background: '#fdf6e3', foreground: '#3b3b32', palette: Array(16).fill(null) })!
    expect(luminance(light.ink)).toBeLessThan(luminance(light.dim))
    expect(luminance(light.dim)).toBeLessThan(luminance(light.bg))
  })

  it('低コントラストの文字色を選んでいたら、それより濃くしない', () => {
    // 地に近い文字色。目標 8.0 には届かないので、文字色そのままで止める
    const s2 = skinFrom({ background: '#191919', foreground: '#6a6a6a', palette: Array(16).fill(null) })!
    expect(s2.dim).toBe('#6a6a6a')
    expect(atContrast('#191919', '#191919', '#6a6a6a', 8)).toBe('#6a6a6a')
  })

  it('地か文字が無ければ当てない（中途半端に当てるより既定がよい）', () => {
    expect(skinFrom({ background: '#191919', foreground: null, palette: [] })).toBeNull()
  })

  it('palette が空でも落ちない', () => {
    const s = skinFrom({ background: '#191919', foreground: '#cfcecc', palette: Array(16).fill(null) })
    expect(s?.amber).toMatch(/^#/)
  })
})

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadGhosttySkin } from '../src/main/ghostty'

/**
 * Ghostty の設定を探して読む（CLAUDE.md §21）。
 *
 * **利用者の themes/ を同梱より先に見る**ところが要点なので、そこを重点的に見る。
 * 実測では `theme = notion` が同梱ではなく自作だった。
 */

let home: string
let realHome: string | undefined
const write = (rel: string, body: string): void => {
  const path = join(home, rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, body)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-g-'))
  process.env.XDG_CONFIG_HOME = home
  // **HOME も差し替える。** さもないと実環境の ~/.config/ghostty を拾い、
  // 検査が「この機械に何が入っているか」に左右される
  realHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  delete process.env.XDG_CONFIG_HOME
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

describe('見つからないとき', () => {
  it('設定が無ければ null（既定の色で出る。落ちない）', async () => {
    expect(await loadGhosttySkin()).toBeNull()
  })

  it('地と文字が読めなければ null（中途半端に当てるより既定がよい）', async () => {
    write('ghostty/config', 'font-size = 14\n')
    expect(await loadGhosttySkin()).toBeNull()
  })
})

describe('読み取り', () => {
  it('設定ファイルだけで組み立てられる', async () => {
    write('ghostty/config', 'background = #191919\nforeground = #cfcecc\npalette = 11=#ffdc49\n')
    const g = await loadGhosttySkin()
    expect(g?.skin.bg).toBe('#191919')
    expect(g?.skin.ink).toBe('#cfcecc')
    expect(g?.skin.amber).toBe('#ffdc49')
    expect(g?.source.theme).toBeNull()
  })

  it('**利用者の themes/ を先に見る**（同梱を先に見ると自作が無視される）', async () => {
    write('ghostty/config', 'theme = notion\n')
    write('ghostty/themes/notion', 'background = #191919\nforeground = #cfcecc\n')
    const g = await loadGhosttySkin()
    expect(g?.source.theme).toBe('notion')
    expect(g?.skin.bg).toBe('#191919')
  })

  it('テーマを敷いてから設定ファイル本体で上書きする（Ghostty と同じ順）', async () => {
    write('ghostty/config', 'theme = t\nbackground = #000000\n')
    write('ghostty/themes/t', 'background = #191919\nforeground = #cfcecc\npalette = 9=#ff7369\n')
    const g = await loadGhosttySkin()
    expect(g?.skin.bg).toBe('#000000')       // 本体が勝つ
    expect(g?.skin.ink).toBe('#cfcecc')      // テーマが残る
    expect(g?.skin.red).toMatch(/^#/)        // palette もテーマから
  })

  it('テーマ名が解けなければ、設定ファイルだけで進む', async () => {
    write('ghostty/config', 'theme = 無いテーマ\nbackground = #191919\nforeground = #cfcecc\n')
    const g = await loadGhosttySkin()
    expect(g?.source.theme).toBeNull()
    expect(g?.skin.bg).toBe('#191919')
  })
})

describe('書体と端末', () => {
  it('等幅は利用者の指定が先頭、本文には 2 番目以降だけを借りる', async () => {
    write('ghostty/config', [
      'background = #191919', 'foreground = #cfcecc',
      'font-family = "JetBrainsMono Nerd Font"', 'font-family = "BIZ UDGothic"',
      'font-size = 15', 'adjust-cell-height = 22%'
    ].join('\n'))
    const g = await loadGhosttySkin()
    expect(g?.mono[0]).toBe("'JetBrainsMono Nerd Font'")
    expect(g?.reading.fallbacks).toEqual(["'BIZ UDGothic'"])
    expect(g?.reading.size).toBe(15)
    expect(g?.reading.lineHeight).toBeCloseTo(1.82, 5)
  })

  it('端末には 16 色をそのまま渡す（アプリのように混ぜない）', async () => {
    write('ghostty/config', [
      'background = #191919', 'foreground = #cfcecc',
      'cursor-color = #cfcecc', 'selection-background = #2c4763',
      'palette = 1=#c4554d', 'palette = 15=#ffffff'
    ].join('\n'))
    const g = await loadGhosttySkin()
    expect(g?.terminal).toMatchObject({
      background: '#191919', foreground: '#cfcecc',
      cursor: '#cfcecc', selectionBackground: '#2c4763',
      red: '#c4554d', brightWhite: '#ffffff'
    })
  })
})

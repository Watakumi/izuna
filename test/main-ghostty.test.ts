import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listThemes, loadGhosttySkin, loadSkin } from '../src/main/ghostty'
import { DEFAULT_CUSTOM } from '../src/shared/ghostty'

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
    expect(g?.skin.bg).toBe('#000000') // 本体が勝つ
    expect(g?.skin.ink).toBe('#cfcecc') // テーマが残る
    expect(g?.skin.red).toMatch(/^#/) // palette もテーマから
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
    write(
      'ghostty/config',
      [
        'background = #191919',
        'foreground = #cfcecc',
        'font-family = "JetBrainsMono Nerd Font"',
        'font-family = "BIZ UDGothic"',
        'font-size = 15',
        'adjust-cell-height = 22%'
      ].join('\n')
    )
    const g = await loadGhosttySkin()
    expect(g?.mono[0]).toBe("'JetBrainsMono Nerd Font'")
    expect(g?.reading.fallbacks).toEqual(["'BIZ UDGothic'"])
    expect(g?.reading.size).toBe(15)
    expect(g?.reading.lineHeight).toBeCloseTo(1.82, 5)
  })

  it('端末には 16 色をそのまま渡す（アプリのように混ぜない）', async () => {
    write(
      'ghostty/config',
      [
        'background = #191919',
        'foreground = #cfcecc',
        'cursor-color = #cfcecc',
        'selection-background = #2c4763',
        'palette = 1=#c4554d',
        'palette = 15=#ffffff'
      ].join('\n')
    )
    const g = await loadGhosttySkin()
    expect(g?.terminal).toMatchObject({
      background: '#191919',
      foreground: '#cfcecc',
      cursor: '#cfcecc',
      selectionBackground: '#2c4763',
      red: '#c4554d',
      brightWhite: '#ffffff'
    })
  })
})

/**
 * 配色の選び方（§37）。**どの選び方も最後は `skinFrom` に渡すだけ**なので、
 * 見るのは「どこから色を取ったか」と「書体は借りたままか」の 2 つ。
 */
describe('配色を選ぶ', () => {
  const CONFIG = [
    'theme = mine',
    'font-family = "JetBrainsMono Nerd Font"',
    'font-family = "BIZ UDGothic"',
    'font-size = 14'
  ].join('\n')

  beforeEach(() => {
    write('ghostty/config', CONFIG)
    write('ghostty/themes/mine', 'background = #101014\nforeground = #d0d0d0\n')
    write('ghostty/themes/other', 'background = #201010\nforeground = #e0d0d0\n')
  })

  it('Ghostty に合わせるのは、いままでと同じ', async () => {
    const g = await loadSkin({ kind: 'ghostty' })
    expect(g?.source).toEqual({ config: 'mine', theme: 'mine' })
    expect(g?.skin.bg).toBe('#101014')
  })

  it('Izuna の既定は null（既定の色で出る）', async () => {
    expect(await loadSkin({ kind: 'builtin' })).toBeNull()
  })

  it('**テーマを選んでも書体は Ghostty から借りる**（配色だけ差し替える）', async () => {
    const g = await loadSkin({ kind: 'named', name: 'other' })
    expect(g?.skin.bg).toBe('#201010')
    expect(g?.source.theme).toBe('other')
    expect(g?.mono[0]).toContain('JetBrainsMono')
    expect(g?.terminalFontSize).toBe(14)
  })

  it('無いテーマを選んだら既定に倒す（半端に当てない）', async () => {
    expect(await loadSkin({ kind: 'named', name: 'いない' })).toBeNull()
  })

  it('自分で決めた 5 色から段を作る', async () => {
    const g = await loadSkin({
      kind: 'custom',
      colors: {
        background: '#000010',
        foreground: '#eeeeee',
        amber: '#ffcc00',
        teal: '#00cc99',
        red: '#ff4444'
      }
    })
    expect(g?.skin.bg).toBe('#000010')
    expect(g?.skin.amber).toBe('#ffcc00')
    // 読む字は床を割らない（§21 の規律がそのまま効く）
    expect(g?.skin.ink).toBe('#eeeeee')
  })

  it('Ghostty が無くても、自分で決めた配色は出る', async () => {
    rmSync(join(home, 'ghostty'), { recursive: true, force: true })
    const g = await loadSkin({ kind: 'custom', colors: DEFAULT_CUSTOM })
    expect(g?.skin.bg).toBe(DEFAULT_CUSTOM.background)
    expect(g?.mono).toEqual([])
  })
})

describe('テーマの一覧', () => {
  it('利用者の置き場のものが名前順で出る。隠しファイルは出さない', async () => {
    write('ghostty/themes/zulu', 'background = #111111\n')
    write('ghostty/themes/alpha', 'background = #111111\n')
    write('ghostty/themes/.DS_Store', '')
    const names = await listThemes()
    // **同梱の置き場は実機のものなので、数を固定しない**（入っている機械と
    // 入っていない機械の両方で通る形にする）
    expect(names).toContain('alpha')
    expect(names).toContain('zulu')
    expect(names).not.toContain('.DS_Store')
    expect(names.indexOf('alpha')).toBeLessThan(names.indexOf('zulu'))
  })

  it('置き場が無くても落ちない（Ghostty を入れていないだけ）', async () => {
    const names = await listThemes()
    expect(Array.isArray(names)).toBe(true)
    expect(names).not.toContain('alpha')
  })
})

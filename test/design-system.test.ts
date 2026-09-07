import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { F, R, S } from '../src/renderer/src/theme'

/**
 * 見た目のスケールに対する門。
 *
 * 数えたら文字サイズが 9 種類、角丸が 9 種類、gap が 14 種類あった。
 * **意図した差ではなく、そのとき打った数字だった。**
 * 検査が無いと、また散らばる。
 *
 * ここが落ちたら、値を直すか、スケール自体を見直すこと。
 * **「とりあえず許可リストに足す」をしない。**
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const UI_ROOT = join(ROOT, 'src', 'renderer', 'src')

function sources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) sources(p, out)
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const files = sources(UI_ROOT).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }))
const THEME = 'src/renderer/src/theme.ts'
const UI = 'src/renderer/src/components/ui.tsx'

/** 数値リテラルだけを見る。`F.body` のような参照は通す */
function violations(prop: string, allowed: readonly number[]): string[] {
  const found: string[] = []
  for (const { path, text } of files) {
    if (path === THEME) continue
    for (const m of text.matchAll(new RegExp(`${prop}:\\s*(\\d+(?:\\.\\d+)?)`, 'g'))) {
      const n = Number(m[1])
      if (!allowed.includes(n)) {
        const line = text.slice(0, m.index).split('\n').length
        found.push(`${path}:${line} ${prop}: ${n}`)
      }
    }
  }
  return found
}

describe('スケールの外に出ない', () => {
  it('文字サイズ', () => {
    expect(violations('fontSize', Object.values(F))).toEqual([])
  })

  it('角丸', () => {
    // 3px の丸みなど「ほぼ角」は R.sm に寄せる
    expect(violations('borderRadius', Object.values(R))).toEqual([])
  })

  it('間隔（gap）', () => {
    expect(violations('gap', Object.values(S))).toEqual([])
  })
})

describe('部品を 1 箇所にまとめる', () => {
  it('ボタンや入力欄を各所で定義しない', () => {
    // 以前は 5 ファイルに 13 箇所コピペされ、padding が微妙に違っていた
    const offenders = files
      .filter((f) => f.path !== UI)
      .filter((f) => /const (BTN|GHOST|LINK|INPUT|CARD|LABEL)\b/.test(f.text))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('色は theme.ts からしか来ない', () => {
    // 生の #rrggbb を各所に書くと、trans や hover の色がずれていく
    const offenders: string[] = []
    for (const { path, text } of files) {
      if (path === THEME) continue
      for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b/g)) {
        // SVG の stroke に色名を直書きしていないかも見る
        const line = text.slice(0, m.index).split('\n').length
        offenders.push(`${path}:${line} ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

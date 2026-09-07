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

describe('余白もスケールに乗せる', () => {
  /**
   * `padding: '9px 12px'` のような文字列と `padding: 12` の両方を見る。
   *
   * **24 を超える値は余白ではなく配置**（モーダルを上から何 px 下げるか等）
   * なので、スケールには乗せない。ただし 8 の倍数に揃えてリズムは保つ。
   */
  function paddingNumbers(): string[] {
    const bad: string[] = []
    for (const { path, text } of files) {
      if (path === THEME) continue
      const check = (n: number, at: number, raw: string): void => {
        if (n === 0) return
        const ok = n <= 24 ? (Object.values(S) as number[]).includes(n) : n % 8 === 0
        if (!ok) bad.push(`${path}:${text.slice(0, at).split('\n').length} ${raw}`)
      }
      for (const m of text.matchAll(/padding: '([^']*)'/g)) {
        for (const tok of m[1].split(/\s+/)) {
          const v = /^(\d+)px$/.exec(tok)
          if (v) check(Number(v[1]), m.index, `padding: ${tok}`)
        }
      }
      for (const m of text.matchAll(/padding(?:Top|Left|Right|Bottom)?: (\d+)\b/g)) {
        check(Number(m[1]), m.index, m[0])
      }
    }
    return bad
  }

  it('スケールの外に出ない', () => {
    // 数えたら 44 通り、1〜24 のほぼ全部の数字を使っていた
    expect(paddingNumbers()).toEqual([])
  })
})

describe('フォーム要素を素で書かない', () => {
  /**
   * `<textarea>` を塗り忘れて**真っ白**が出た（2026-09-08）。
   * ネイティブの部品は既定が明るいので、書いた本人が暗いつもりでも
   * そこだけ明るく描かれる。`color-scheme: dark` を入れたうえで、
   * 枠と余白は `ui.tsx` の `Input` / `TextArea` / `Check` に寄せる。
   *
   * `<button>` は対象にしない —— ModeSwitch のような形の違う部品があり、
   * 既定の見た目に落ちる失敗の仕方をしない。
   */
  it('input / textarea / select は ui.tsx の中だけ', () => {
    const bad: string[] = []
    for (const { path, text } of files) {
      if (path === UI) continue
      for (const m of text.matchAll(/<(input|textarea|select)\b/g)) {
        bad.push(`${path}:${text.slice(0, m.index).split('\n').length} <${m[1]}>`)
      }
    }
    expect(bad).toEqual([])
  })

  it('color-scheme が宣言されている（これが無いと部品だけ明るいまま）', () => {
    const css = readFileSync(join(ROOT, 'src/renderer/src/assets/base.css'), 'utf8')
    expect(css).toMatch(/color-scheme:\s*dark/)
  })
})

describe('CSS の外に色を渡すときは解いてから渡す', () => {
  /**
   * `theme.ts` の `C` は `var(--c-bg, #14161b)` の形をしている。
   * **CSS の中でしか意味を持たない。**
   *
   * CSS 変数化したとき「使う側 294 箇所を 1 つも書き換えずに差し替えられる」と
   * 書いたが、**それは CSS の中でだけ成り立つ話だった。** ターミナル
   * （ghostty-web）は canvas に描くので `var()` を解釈できず、既定の
   * **明るい**配色に落ちていた。しかも `var()` は黙って無視されるので
   * 例外が出ない —— 目で見るまで気づかない壊れ方をする。
   *
   * **値の「中身」を変えたとき、「呼ぶ側を書き換えていない」ことは
   * 安全の証拠にならない。** 調べていないことの証拠である。
   */
  it('ghostty-web には resolve() を通した色を渡す', () => {
    const text = files.find((f) => f.path.endsWith('TerminalPane.tsx'))!.text
    const at = text.indexOf('new Terminal(')
    expect(at, 'new Terminal( が見つからない').toBeGreaterThan(-1)
    const options = text.slice(at, text.indexOf('})', at))
    expect(options, 'C.* をそのまま渡すと canvas が解決できない').not.toMatch(/\bC\.\w+/)
    expect(options, 'MONO をそのまま渡すと canvas が解決できない').not.toMatch(/\bMONO\b/)
    expect(options).toMatch(/resolve/)
  })
})

describe('Fast Refresh を壊さない', () => {
  /**
   * React Fast Refresh は「**そのファイルがコンポーネントだけを export
   * している**」ことを前提に、状態を保ったまま差し替える。値が混ざると
   * モジュールごと捨てて読み直すので、**編集のたびに画面の状態が飛ぶ**。
   *
   * ```
   * hmr invalidate /src/components/ui.tsx
   * Could not Fast Refresh ("ellipsis" export is incompatible)
   * ```
   *
   * 実際に `ellipsis`（CSS の値）を混ぜて踏んだ。値は `theme.ts` に置く。
   */
  it('ui.tsx はコンポーネントだけを出す', () => {
    const text = files.find((f) => f.path === UI)!.text
    const bad = [...text.matchAll(/^export (?:function|const) (\w+)/gm)]
      .map((m) => m[1])
      .filter((name) => !/^[A-Z]/.test(name))
    expect(bad).toEqual([])
  })
})

describe('繰り返す書き方をまとめる', () => {
  /**
   * `minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
   * whiteSpace: 'nowrap'` を **17 箇所**手書きしていた。
   * `ellipsis` という部品を作っておきながら、**当てるのを忘れていた**。
   */
  it("溢れを「…」にする書き方は theme.ts の ellipsis を使う", () => {
    const bad = files
      .filter((f) => f.path !== THEME && /textOverflow: 'ellipsis'/.test(f.text))
      .map((f) => f.path)
    expect(bad).toEqual([])
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

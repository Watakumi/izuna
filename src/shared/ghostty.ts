/**
 * Ghostty の設定からアプリの配色を作る。
 *
 * ターミナルは既に ghostty-web で動いているのに、**アプリの色だけ別**だった。
 * 利用者が自分で決めた配色があるなら、それに合わせるほうが筋が通る。
 *
 * ここはファイルを知らない（§4 の原則）。文字列を渡されて色を返すだけ。
 */

/** Izuna の色トークン。`theme.ts` と同じ顔ぶれでなければならない */
export type TokenName =
  | 'bg' | 'panel' | 'surface' | 'raised' | 'code'
  | 'ink' | 'ink2' | 'dim' | 'dim2' | 'faint'
  | 'line' | 'line2'
  | 'amber' | 'amberInk' | 'amberLine' | 'amberBg'
  | 'teal' | 'red'
  | 'addBg' | 'addInk' | 'delBg' | 'delInk'

export type Skin = Record<TokenName, string>

export interface GhosttyColors {
  background: string | null
  foreground: string | null
  /** 0〜15。埋まっていない番号は null */
  palette: (string | null)[]
}

export interface GhosttyConfig {
  /** `theme = X`。別ファイルを読む必要があることを示す */
  theme: string | null
  colors: GhosttyColors
  /** `font-family` は複数行書ける。先頭が主 */
  fontFamily: string[]
}

const empty = (): GhosttyColors => ({ background: null, foreground: null, palette: Array(16).fill(null) })

/** `#rgb` `#rrggbb` `rrggbb` を受ける。Ghostty は `#` 無しも許す */
export function normalizeHex(raw: string): string | null {
  const v = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(v)) return `#${v[0]}${v[0]}${v[1]}${v[1]}${v[2]}${v[2]}`.toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`
  return null
}

/**
 * `key = value` の羅列を読む。`#` から行末はコメント。
 *
 * **読めない行は黙って飛ばす。** 設定ファイルには Izuna が知らない鍵が
 * 大量にある（フォント・窓・キーバインド）。知らないことは異常ではない。
 */
export function parseGhosttyConfig(text: string): GhosttyConfig {
  const colors = empty()
  const fontFamily: string[] = []
  let theme: string | null = null

  for (const line of text.split(/\r?\n/)) {
    const body = line.replace(/^\s*#.*$/, '').trim()
    if (body === '') continue
    const at = body.indexOf('=')
    if (at === -1) continue
    const key = body.slice(0, at).trim()
    const value = body.slice(at + 1).trim().replace(/^["']|["']$/g, '')

    switch (key) {
      case 'theme':
        // `theme = dark:X,light:Y` の形もある。**先頭だけ採る**（Izuna は 1 つしか持てない）
        theme = value.split(',')[0].replace(/^(dark|light):/, '').trim() || null
        break
      case 'background': colors.background = normalizeHex(value); break
      case 'foreground': colors.foreground = normalizeHex(value); break
      case 'font-family': if (value) fontFamily.push(value); break
      case 'palette': {
        const m = /^(\d{1,2})\s*=\s*(.+)$/.exec(value)
        if (!m) break
        const n = Number(m[1])
        if (n >= 0 && n < 16) colors.palette[n] = normalizeHex(m[2])
        break
      }
    }
  }
  return { theme, colors, fontFamily }
}

/** あとの値が勝つ。**設定ファイル本体がテーマを上書きする**（Ghostty と同じ順） */
export function mergeColors(base: GhosttyColors, over: GhosttyColors): GhosttyColors {
  return {
    background: over.background ?? base.background,
    foreground: over.foreground ?? base.foreground,
    palette: base.palette.map((c, i) => over.palette[i] ?? c)
  }
}

// ── 色の計算 ──────────────────────────────────────────

type RGB = [number, number, number]

const toRgb = (hex: string): RGB => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16)
]

const toHex = (c: RGB): string =>
  '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

/** `t` が 0 なら a、1 なら b */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [toRgb(a), toRgb(b)]
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t) as RGB)
}

/** 相対輝度（WCAG）。明暗の判定と、読める文字色の選択に使う */
export function luminance(hex: string): number {
  const f = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = toRgb(hex)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export const isDark = (hex: string): boolean => luminance(hex) < 0.5

/** 2 色のうち、地に対して読めるほう */
export function readableOn(bg: string, a: string, b: string): string {
  const l = luminance(bg)
  const ratio = (c: string): number => {
    const m = luminance(c)
    return (Math.max(l, m) + 0.05) / (Math.min(l, m) + 0.05)
  }
  return ratio(a) >= ratio(b) ? a : b
}

// ── 割り当て ──────────────────────────────────────────

/**
 * Ghostty の色を Izuna のトークンに写す。
 *
 * **役割は変えない。** アンバーは「人間の判断待ち」のままで、
 * どの色を当てるかだけが変わる（§17 の規律）。だから
 * `amber` には黄、`teal` には水色、`red` には赤を当てる ——
 * 意味が同じ位置に来るようにする。
 *
 * 地と文字の中間色は**混ぜて作る**。テーマは 18 色しか持たないが、
 * 画面には段階が要る。混ぜる向きを「地 → 文字」に統一しているので、
 * **明るいテーマでも暗いテーマでも同じ式で通る。**
 */
export function skinFrom(colors: GhosttyColors): Skin | null {
  const bg = colors.background
  const fg = colors.foreground
  // 地と文字が無ければ話にならない。中途半端に当てるより既定のままがよい
  if (!bg || !fg) return null

  const dark = isDark(bg)
  /** 地から文字へ寄せる */
  const up = (t: number): string => mix(bg, fg, t)
  /** 地から更に離す（暗いテーマでは暗く、明るいテーマでは明るく） */
  const away = (t: number): string => mix(bg, dark ? '#000000' : '#ffffff', t)

  const pick = (...ns: number[]): string | null => {
    for (const n of ns) if (colors.palette[n]) return colors.palette[n]
    return null
  }
  const amber = pick(11, 3) ?? '#e8a33d'
  const teal = pick(14, 6, 12) ?? '#4fc4b0'
  const red = pick(9, 1) ?? '#e06c75'
  const green = pick(10, 2) ?? '#96d3ab'

  return {
    bg,
    panel: away(0.35),
    surface: up(0.03),
    raised: up(0.1),
    code: away(0.22),

    ink: fg,
    ink2: up(0.88),
    dim: up(0.66),
    dim2: up(0.52),
    faint: up(0.34),

    line: up(0.12),
    line2: up(0.2),

    amber,
    // 札の上に載る字。**地と文字のうち読めるほうを選ぶ**（黄は明るいので普通は地）
    amberInk: readableOn(amber, bg, fg),
    amberLine: mix(bg, amber, 0.3),
    amberBg: mix(bg, amber, 0.12),

    teal,
    red,

    addBg: mix(bg, green, 0.14),
    addInk: mix(fg, green, 0.7),
    delBg: mix(bg, red, 0.14),
    delInk: mix(fg, red, 0.7)
  }
}

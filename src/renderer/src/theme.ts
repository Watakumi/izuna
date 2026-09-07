import type { Skin, TokenName } from '../../shared/ghostty'

/**
 * 見た目の土台。**ここに無い値を直接書かない。**
 *
 * 数えたら文字サイズが 9 種類、角丸が 9 種類、gap が 14 種類、padding が
 * 52 通りあった。意図した差ではなく、そのとき打った数字だった。
 * `test/design-system.test.ts` が、スケール外の値が入ったら落とす。
 */

/**
 * 色。design/ の判断（アンバーは人間の判断待ちだけ）を引き継ぐ。
 *
 * **値は CSS 変数を経由する。** 利用者の Ghostty のテーマを反映できるように
 * するためで（`shared/ghostty.ts`）、`var(--c-x, 既定)` の形にしておけば
 * **使う側 294 箇所を 1 つも書き換えずに**差し替えられる。
 * 変数が設定されていなければ、ここに書いた既定が出る。
 */
const BASE = {
  bg: '#14161b',
  panel: '#101216',
  surface: '#171a21',
  raised: '#232936',
  // **地に対する比で決めてある**（`shared/ghostty.ts` と同じ目標）。
  // 目分量で置いていた頃は faint が 2.3 しかなく、10px の字が読めなかった。
  ink: '#e6e8ee',
  ink2: '#e6e8ee', // 本文。強調は色ではなく太さで付ける
  dim: '#abadb2', // 比 8.1
  dim2: '#93959a', // 比 6.0
  faint: '#7d7f84', // 比 4.5 —— 10px の字に使うので AA を割らせない
  line: '#393b40', // 比 1.6
  line2: '#4d4f54', // 比 2.2
  /** **人間の判断を待っている箇所にだけ**使う。装飾に使わない */
  amber: '#e8a33d',
  amberInk: '#16130c',
  amberLine: '#3d3527',
  amberBg: '#1a1710',
  teal: '#4fc4b0',
  red: '#e06c75',
  addBg: '#14261c',
  addInk: '#96d3ab',
  delBg: '#2a1518',
  delInk: '#e0a0a6',
  code: '#0d0f13'
} as const satisfies Record<TokenName, string>

export const C = Object.fromEntries(
  Object.entries(BASE).map(([k, v]) => [k, `var(--c-${k}, ${v})`])
) as Record<keyof typeof BASE, string>

/**
 * Ghostty から作った配色を当てる。**外したいときは null。**
 *
 * `:root` に変数を置くだけなので、React の再描画は要らない。
 */
export function applySkin(skin: Skin | null, fontMono?: string): void {
  const root = document.documentElement
  for (const k of Object.keys(BASE)) root.style.removeProperty(`--c-${k}`)
  root.style.removeProperty('--font-mono')
  if (!skin) return
  for (const [k, v] of Object.entries(skin)) root.style.setProperty(`--c-${k}`, v)
  // Ghostty で使っている等幅フォントも借りる。無ければ既定のまま
  if (fontMono) root.style.setProperty('--font-mono', `'${fontMono}', ${MONO_BASE}`)
}

/**
 * 文字。**5 段だけ。** 10.5 や 12.5 のような半端はやめた。
 * 密度の高い画面なので刻みは細かいが、段は増やさない。
 */
export const F = {
  /** キーヒント・補助ラベル */
  micro: 10,
  /** 二次情報・mono の小 */
  small: 11,
  /** ボタン・本文の小 */
  body: 12,
  /** 本文 */
  base: 13,
  /** 見出し */
  title: 15
} as const

/** 角丸。小（札）・中（部品）・大（面）・丸（点） */
export const R = {
  sm: 4,
  md: 7,
  lg: 11,
  full: 999
} as const

/** 間隔。gap も padding もここから取る */
export const S = {
  hair: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24
} as const

const MONO_BASE = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const MONO = `var(--font-mono, ${MONO_BASE})`
export const SANS = "'IBM Plex Sans', system-ui, -apple-system, sans-serif"

/** `font` 一括指定を組む。文字サイズをスケールから外させない */
export const mono = (size: keyof typeof F = 'small'): string => `${F[size]}px ${MONO}`
export const sans = (size: keyof typeof F = 'base', lineHeight = 1.6): string =>
  `${F[size]}px/${lineHeight} ${SANS}`

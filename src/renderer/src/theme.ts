/**
 * 見た目の土台。**ここに無い値を直接書かない。**
 *
 * 数えたら文字サイズが 9 種類、角丸が 9 種類、gap が 14 種類、padding が
 * 52 通りあった。意図した差ではなく、そのとき打った数字だった。
 * `test/design-system.test.ts` が、スケール外の値が入ったら落とす。
 */

/** 色。design/ の判断（アンバーは人間の判断待ちだけ）を引き継ぐ */
export const C = {
  bg: '#14161b',
  panel: '#101216',
  surface: '#171a21',
  raised: '#232936',
  ink: '#e6e8ee',
  ink2: '#c8cddb',
  dim: '#9aa2b4',
  dim2: '#7d8598',
  faint: '#4a5164',
  line: '#242832',
  line2: '#2c3140',
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
} as const

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

export const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const SANS = "'IBM Plex Sans', system-ui, -apple-system, sans-serif"

/** `font` 一括指定を組む。文字サイズをスケールから外させない */
export const mono = (size: keyof typeof F = 'small'): string => `${F[size]}px ${MONO}`
export const sans = (size: keyof typeof F = 'base', lineHeight = 1.6): string =>
  `${F[size]}px/${lineHeight} ${SANS}`

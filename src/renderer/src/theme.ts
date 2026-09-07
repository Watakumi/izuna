import type { TokenName } from '../../shared/ghostty'
import type { GhosttySkin } from '../../main/ghostty'

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
 * CSS 変数を**実際の色**に解く。
 *
 * **canvas は `var()` を解釈しない。** ターミナル（ghostty-web）は canvas に
 * 描くので、`C.code` をそのまま渡すと解決できず既定の**明るい**配色に落ちる。
 * 実際にそうなっていた（2026-09-08。CSS 変数化したときに壊した）。
 */
export function resolve(name: keyof typeof BASE): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim()
  return v || BASE[name]
}

/** 同じ理由で、等幅の書体も解いて渡す */
export function resolveMono(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return v || MONO_BASE
}

/**
 * Ghostty から作った配色を当てる。**外したいときは null。**
 *
 * `:root` に変数を置くだけなので、React の再描画は要らない。
 */
export function applySkin(g: GhosttySkin | null): void {
  const root = document.documentElement
  for (const k of Object.keys(BASE)) root.style.removeProperty(`--c-${k}`)
  for (const k of ['--font-mono', '--font-sans', '--font-read', '--read-size', '--read-line']) {
    root.style.removeProperty(k)
  }
  if (!g) return

  for (const [k, v] of Object.entries(g.skin)) root.style.setProperty(`--c-${k}`, v)

  if (g.mono.length > 0) root.style.setProperty('--font-mono', `${g.mono.join(', ')}, ${MONO_BASE}`)

  // **挟む。** 欧文は比例書体のまま、日本語だけ利用者の指定を借りる
  const { fallbacks, size, lineHeight } = g.reading
  const sans = [LATIN, ...fallbacks, GENERIC].join(', ')
  // 会話だけでなく**画面全体**に効かせる。ここを忘れると UI が全部ヒラギノになる
  root.style.setProperty('--font-sans', sans)
  root.style.setProperty('--font-read', sans)
  root.style.setProperty('--read-size', `${size}px`)
  root.style.setProperty('--read-line', String(lineHeight))
}

/**
 * 文字。**5 段だけ。** 10.5 や 12.5 のような半端はやめた。
 *
 * **2026-09-08 に 1px ずつ上げた**（10/11/12/13/15 → 11/12/13/14/16）。
 * 「右のパネルも文字が見にくい」と言われて数えたら、10px の日本語が
 * 各所にあった。密度は大事だが、読めない密度に意味はない。
 *
 * このとき、**直打ちが 136 箇所あって段がほとんど効いていなかった**ことも
 * 分かった（参照は 22 箇所だけ）。全部この段への参照に置き換えてある。
 */
export const F = {
  /** キーヒント・補助ラベル */
  micro: 11,
  /** 二次情報・mono の小 */
  small: 12,
  /** ボタン・本文の小 */
  body: 13,
  /** 本文 */
  base: 14,
  /** 見出し */
  title: 16
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

/**
 * 欧文の書体と、汎用の指定。**この 2 つのあいだに日本語の書体を挟む。**
 * 挟む位置が要点で、前後どちらに置いても効かない（`shared/ghostty.ts` 参照）。
 */
const LATIN = "'IBM Plex Sans'"
const GENERIC = 'system-ui, -apple-system, sans-serif'

const MONO_BASE = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
export const MONO = `var(--font-mono, ${MONO_BASE})`

/**
 * 欧文の書体と、汎用の指定。**この 2 つのあいだに日本語の書体を挟む。**
 * 挟む位置が要点で、前後どちらに置いても効かない（`shared/ghostty.ts` 参照）。
 */

/**
 * 会話の本文（＝長文を読む面）。
 *
 * **UI の詰まりとは別に持つ。** サイドバーや札は詰まっていてよいが、
 * 本文は読むためのもので、同じ寸法でよい理由がない。既定は 14px/1.8 で、
 * 利用者の Ghostty に指定があればそちらに従う（`applySkin`）。
 */
export const READ = `var(--read-size, 14px)/var(--read-line, 1.8) var(--font-read, ${LATIN}, ${GENERIC})`
/**
 * アプリ全体の書体。**ここに日本語が無いと、画面の全部がヒラギノに落ちる。**
 * 会話だけ直して残りを忘れていた（2026-09-08）。`--font-sans` は
 * `applySkin` が利用者の指定を挟んで組み立てる。
 */
export const SANS = `var(--font-sans, ${LATIN}, ${GENERIC})`

/** `font` 一括指定を組む。文字サイズをスケールから外させない */
export const mono = (size: keyof typeof F = 'small'): string => `${F[size]}px ${MONO}`
export const sans = (size: keyof typeof F = 'base', lineHeight = 1.6): string =>
  `${F[size]}px/${lineHeight} ${SANS}`

/**
 * 1 行に収めて溢れたら「…」にする。
 *
 * **`ui.tsx` ではなく、ここに置く。** これはコンポーネントではなく値で、
 * コンポーネント以外を混ぜると React Fast Refresh が効かなくなる
 * （`hmr invalidate ... "ellipsis" export is incompatible`）。
 * 編集のたびに画面の状態が飛ぶので、実害がある。
 */
export const ellipsis = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const

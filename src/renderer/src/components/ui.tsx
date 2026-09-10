import { forwardRef } from 'react'
import { C, F, MONO, R, S, SANS } from '../theme'

/**
 * 共通の部品。**ここ以外でボタンや入力欄を定義しない。**
 *
 * 以前は `BTN` / `GHOST` / `LINK` / `INPUT` / `CARD` / `LABEL` を
 * 5 ファイルに 13 箇所コピペしていて、そのたびに padding が
 * `7px 15px` `8px 20px` `6px 16px` と微妙に違っていた。
 */

type ButtonKind = 'primary' | 'ghost' | 'danger' | 'quiet'
type ButtonSize = 'sm' | 'md'

const BUTTON: Record<ButtonKind, React.CSSProperties> = {
  /** 主たる操作。**アンバーは人間の判断待ちの色**なので、乱発しない */
  primary: { background: C.amber, color: C.amberInk, border: 'none', fontWeight: 600 },
  ghost: { background: 'transparent', color: C.ink2, border: `1px solid ${C.line2}` },
  /** 破壊的な操作。ほかと同じ形にしない */
  danger: { background: 'transparent', color: C.red, border: `1px solid ${C.red}` },
  /** 枠を持たない補助操作 */
  quiet: { background: 'transparent', color: C.dim2, border: '1px solid transparent' }
}

const BUTTON_SIZE: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: `${S.sm}px ${S.lg}px`, fontSize: F.small },
  md: { padding: `${S.md}px ${S.xl}px`, fontSize: F.body }
}

export function Button({
  kind = 'ghost',
  size = 'md',
  block,
  style,
  ...rest
}: {
  kind?: ButtonKind
  size?: ButtonSize
  /** 幅いっぱいに伸ばす */
  block?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <button
      {...rest}
      style={{
        borderRadius: R.md,
        cursor: rest.disabled ? 'default' : 'pointer',
        opacity: rest.disabled ? 0.45 : 1,
        width: block ? '100%' : undefined,
        ...BUTTON_SIZE[size],
        ...BUTTON[kind],
        ...style
      }}
    />
  )
}

export function Input({
  style,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      spellCheck={false}
      {...rest}
      style={{
        padding: `${S.md}px ${S.lg}px`,
        borderRadius: R.md,
        border: `1px solid ${C.line2}`,
        background: C.bg,
        color: C.ink,
        font: `${F.body}px ${MONO}`,
        outline: 'none',
        ...style
      }}
    />
  )
}

/**
 * 複数行の入力。
 *
 * **素の `<textarea>` を書かないこと。** 塗り忘れるとブラウザ既定の
 * 白が出る（実際に出した。2026-09-08）。`color-scheme: dark` で
 * ネイティブ側は暗くなるが、**枠と余白はここで揃える**。
 *
 * `bare` は、外側の箱が既に枠を持っている場合（App の入力欄）。
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { bare?: boolean }
>(function TextArea({ bare = false, style, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      {...rest}
      style={{
        resize: 'none',
        outline: 'none',
        color: C.ink,
        font: `${F.base}px/1.6 ${SANS}`,
        ...(bare
          ? { border: 'none', background: 'transparent', padding: `${S.lg}px ${S.lg}px ${S.sm}px` }
          : {
              border: `1px solid ${C.line2}`,
              borderRadius: R.md,
              background: C.bg,
              padding: `${S.md}px ${S.lg}px`
            }),
        ...style
      }}
    />
  )
})

/**
 * ラベル付きのチェックボックス。
 *
 * 箱だけ置くと、押せる範囲がラベルに届かない。`<label>` で包む。
 */
export function Check({
  checked,
  onChange,
  disabled,
  children
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: S.md,
        fontSize: F.body,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  )
}

/**
 * 操作の結果。**時刻を必ず添える。**
 *
 * 「forgejo に main を push しました」だけだと**いつのものか分からない**。
 * 画面に残り続けるので、次に開いたときも同じ文が出ていて、
 * さっきやったのか 10 分前なのかが読めない。
 */
export function Result({
  text,
  bad,
  at
}: {
  text: string
  bad: boolean
  at: number
}): React.JSX.Element {
  const t = new Date(at)
  const hhmmss = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
  return (
    <div
      style={{
        border: `1px solid ${bad ? C.red : C.line2}`,
        borderRadius: R.md,
        padding: `${S.lg}px ${S.lg}px`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: S.md
      }}
    >
      <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0, paddingTop: 2 }}>
        {hhmmss}
      </span>
      <span
        style={{
          fontSize: F.body,
          color: bad ? C.red : C.ink2,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
      >
        {text}
      </span>
    </div>
  )
}

/**
 * 取り直す。**文字にしない。**
 *
 * 「読み直す」「調べ直す」と 2 通りの言葉で書いていた。よく押す小さな操作に
 * 文字を割くと、その画面で一番大事なものと同じ重さに見える。
 */
export function Reload({
  onClick,
  busy
}: {
  onClick: () => void
  busy?: boolean
}): React.JSX.Element {
  return (
    <button
      title="取り直す"
      onClick={onClick}
      disabled={busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: R.md,
        border: 'none',
        background: 'transparent',
        color: C.dim2,
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.4 : 1,
        flexShrink: 0
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a9 9 0 1 1-3-6.7" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  )
}

/**
 * 回数などの小さな数の入力。
 *
 * **素の `<input type="number">` を書かないこと。** 塗り忘れると
 * ブラウザ既定の白が出る（§17 で一度出した）。
 * 範囲は必ず受け取る —— 上限の無い回数を無人のループに渡さない。
 */
export function NumberInput({
  value,
  min,
  max,
  onChange,
  disabled
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      style={{
        width: 64,
        padding: `${S.xs}px ${S.sm}px`,
        borderRadius: R.sm,
        border: `1px solid ${C.line2}`,
        background: C.bg,
        color: C.ink,
        font: `${F.body}px ${MONO}`,
        outline: 'none'
      }}
    />
  )
}

export function Card({
  tone = 'plain',
  style,
  children
}: {
  /** `attention` は人間の判断を待っているもの。それ以外に使わない */
  tone?: 'plain' | 'attention' | 'active'
  style?: React.CSSProperties
  children: React.ReactNode
}): React.JSX.Element {
  const tones = {
    plain: { border: `1px solid ${C.line}`, background: 'transparent' },
    attention: { border: `1px solid ${C.amberLine}`, background: C.amberBg },
    active: { border: `1px solid ${C.line2}`, background: C.surface }
  }
  return (
    <div
      style={{
        borderRadius: R.md,
        padding: `${S.lg}px ${S.lg}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: S.md,
        ...tones[tone],
        ...style
      }}
    >
      {children}
    </div>
  )
}

/** 補助の説明。読めるが目立たない */
export function Faint({
  children,
  style
}: {
  children: React.ReactNode
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <span style={{ fontSize: F.small, color: C.faint, lineHeight: 1.7, ...style }}>{children}</span>
  )
}

/** 小さな札 */
export function Tag({
  children,
  tone
}: {
  children: React.ReactNode
  tone?: 'plain' | 'attention'
}): React.JSX.Element {
  return (
    <span
      style={{
        fontSize: F.micro,
        color: tone === 'attention' ? C.amber : C.dim2,
        padding: `${S.hair}px ${S.sm}px`,
        borderRadius: R.sm,
        flexShrink: 0,
        border: `1px solid ${tone === 'attention' ? C.amberLine : C.line2}`
      }}
    >
      {children}
    </span>
  )
}

/** 一行に収まらない文字を切る。UI 全体で同じ切り方にする */
/** 使用率のメーター。7 割を超えたら注意の色に変わる */
export function Meter({ label, value }: { label: string; value: number }): React.JSX.Element {
  const pct = Math.round(value * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: F.small }}>
        <span style={{ color: C.dim }}>{label}</span>
        <span style={{ font: `${F.small}px ${MONO}`, color: C.ink2 }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: C.raised, borderRadius: R.sm }}>
        <div
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: 3,
            borderRadius: R.sm,
            background: pct > 70 ? C.amber : C.teal
          }}
        />
      </div>
    </div>
  )
}

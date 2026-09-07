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

export function Input({ style, ...rest }: React.InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      spellCheck={false}
      {...rest}
      style={{
        padding: `${S.md}px ${S.lg}px`, borderRadius: R.md, border: `1px solid ${C.line2}`,
        background: C.bg, color: C.ink, font: `${F.body}px ${MONO}`, outline: 'none', ...style
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
    <label style={{
      display: 'flex', alignItems: 'center', gap: S.md, fontSize: F.body,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
    }}>
      <input type="checkbox" checked={checked} disabled={disabled}
        onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
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
    <div style={{
      borderRadius: R.md, padding: `${S.lg}px ${S.lg}px`,
      display: 'flex', flexDirection: 'column', gap: S.md, ...tones[tone], ...style
    }}>
      {children}
    </div>
  )
}

/** 節の見出し */
export function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>
      {children}
    </span>
  )
}

/** 補助の説明。読めるが目立たない */
export function Faint({ children, style }: {
  children: React.ReactNode; style?: React.CSSProperties
}): React.JSX.Element {
  return <span style={{ fontSize: F.small, color: C.faint, lineHeight: 1.7, ...style }}>{children}</span>
}

/** 状態の点。塗りは「動いている」、輪郭は「止まっている」 */
export function Dot({ color, filled = true }: { color: string; filled?: boolean }): React.JSX.Element {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: R.full, flexShrink: 0,
      background: filled ? color : 'transparent',
      border: filled ? 'none' : `1.5px solid ${color}`
    }} />
  )
}

/** 小さな札 */
export function Tag({ children, tone }: {
  children: React.ReactNode; tone?: 'plain' | 'attention'
}): React.JSX.Element {
  return (
    <span style={{
      fontSize: F.micro, color: tone === 'attention' ? C.amber : C.dim2,
      padding: `${S.hair}px ${S.sm}px`, borderRadius: R.sm, flexShrink: 0,
      border: `1px solid ${tone === 'attention' ? C.amberLine : C.line2}`
    }}>
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
        <div style={{ width: `${Math.min(pct, 100)}%`, height: 3, borderRadius: R.sm,
          background: pct > 70 ? C.amber : C.teal }} />
      </div>
    </div>
  )
}

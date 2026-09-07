import { useState } from 'react'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import { C, MONO } from '../theme'

/**
 * 権限モードの切り替え。`Query.setPermissionMode()` を叩く。
 *
 * **変更の通知イベントは無い**ので、成功したら UI 側で状態を進める。
 * 失敗したら元に戻す（黙って食い違わせない）。
 */
export const MODES: Array<{ value: PermissionMode; label: string; hint: string; danger?: boolean }> = [
  { value: 'plan', label: '計画', hint: '読むだけ。変更はしない' },
  { value: 'default', label: '都度きく', hint: '変更のたびに承認を求める' },
  { value: 'acceptEdits', label: '編集は自動', hint: 'ファイル編集だけ自動で許可' },
  { value: 'auto', label: '自動', hint: 'Claude の判断に任せる' },
  { value: 'dontAsk', label: 'きかない', hint: '承認を求めない。できないことは黙って諦める' },
  { value: 'bypassPermissions', label: '素通し', hint: 'すべての確認を飛ばす', danger: true }
]

export function ModeSwitch({
  mode,
  disabled,
  onChange
}: {
  mode: PermissionMode
  disabled: boolean
  onChange: (mode: PermissionMode) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const current = MODES.find((m) => m.value === mode)

  return (
    <div style={{ position: 'relative' }}>
      <button
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 7,
          border: `1px solid ${current?.danger ? C.red : C.line2}`, background: 'transparent',
          color: current?.danger ? C.red : C.ink2, font: `11px ${MONO}`,
          cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1
        }}
      >
        {current?.label ?? mode}
        <span style={{ color: C.faint, fontSize: 10 }}>▾</span>
      </button>

      {open && !disabled && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 11, width: 260,
            background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 7,
            boxShadow: '0 18px 48px rgba(0,0,0,0.55)', overflow: 'hidden'
          }}>
            {MODES.map((m) => (
              <div
                key={m.value}
                onClick={() => { onChange(m.value); setOpen(false) }}
                style={{
                  padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2,
                  cursor: 'pointer', background: m.value === mode ? C.raised : 'transparent',
                  borderLeft: `2px solid ${m.value === mode ? C.amber : 'transparent'}`
                }}
              >
                <span style={{ fontSize: 12, color: m.danger ? C.red : C.ink }}>{m.label}</span>
                <span style={{ fontSize: 11, color: C.dim2, lineHeight: 1.5 }}>{m.hint}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

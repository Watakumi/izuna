import { useCallback, useEffect, useState } from 'react'
import { diagnose, readyForForge, type Check } from '../../../shared/forge'
import type { FixId } from '../../../main/forge/setup'
import { C, MONO } from '../theme'

/**
 * Forgejo のセットアップ（段5 の入口）。
 *
 * **検出は自動、変更は明示のクリック。** 利用者の Forgejo 設定を黙って
 * 書き換えない。押す前に何をするかを必ず見せる。
 */
const FIX_OF: Partial<Record<Check['id'], FixId>> = {
  installed: 'install',
  running: 'start',
  token: 'token',
  actions: 'actions',
  runner: 'runnerToken'
}

const MARK: Record<Check['level'], { icon: string; color: string }> = {
  ok: { icon: '✓', color: C.teal },
  warn: { icon: '!', color: C.amber },
  ng: { icon: '×', color: C.red },
  unknown: { icon: '?', color: C.faint }
}

export function ForgeSetup({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [busy, setBusy] = useState<Check['id'] | null>(null)
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null)

  const refresh = useCallback(async () => {
    setChecks(diagnose(await window.izuna.forgeFacts()))
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const fix = async (check: Check): Promise<void> => {
    const id = FIX_OF[check.id]
    if (!id) return
    setBusy(check.id)
    setMessage(null)
    try {
      setMessage({ text: await window.izuna.forgeFix(id), bad: false })
      await refresh()
    } catch (e) {
      setMessage({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  const ready = checks ? readyForForge(checks) : false

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)', zIndex: 40,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 660, background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 13,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '15px 18px', borderBottom: `1px solid ${C.line}`,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>Forgejo の準備</span>
          <span style={{ fontSize: 11.5, color: C.dim2 }}>検出は自動・変更は押したときだけ</span>
          <div style={{ flexGrow: 1 }} />
          <button onClick={() => void refresh()} style={GHOST}>調べ直す</button>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!checks && <div style={{ padding: 12, color: C.faint, fontSize: 12.5 }}>調べています…</div>}
          {checks?.map((c) => {
            const m = MARK[c.level]
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '11px 13px', borderRadius: 9, border: `1px solid ${C.line}` }}>
                <span style={{ color: m.color, font: `13px ${MONO}`, width: 12, flexShrink: 0 }}>{m.icon}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5 }}>{c.label}</span>
                  <span style={{ font: `11px ${MONO}`, color: C.dim2, wordBreak: 'break-all' }}>{c.detail}</span>
                  {c.fix?.warning && (
                    <span style={{ fontSize: 11, color: C.faint }}>押すと: {c.fix.warning}</span>
                  )}
                </div>
                {c.fix && (
                  <button disabled={busy !== null} onClick={() => void fix(c)}
                    style={{ ...BTN, flexShrink: 0, opacity: busy ? 0.5 : 1 }}>
                    {busy === c.id ? '実行中…' : c.fix.label}
                  </button>
                )}
              </div>
            )
          })}

          {message && (
            <div style={{ border: `1px solid ${message.bad ? C.red : C.line2}`, borderRadius: 7,
              padding: '10px 13px', fontSize: 12, color: message.bad ? C.red : C.ink2,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{message.text}</div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px',
          borderTop: `1px solid ${C.line}` }}>
          <span style={{ fontSize: 12, color: ready ? C.teal : C.dim2 }}>
            {ready ? '準備できています' : '必須の項目が残っています（任意の項目は数えません）'}
          </span>
          <div style={{ flexGrow: 1 }} />
          <button onClick={onClose} style={GHOST}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

const BTN: React.CSSProperties = {
  padding: '7px 15px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 12, cursor: 'pointer'
}
const GHOST: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 12, cursor: 'pointer'
}

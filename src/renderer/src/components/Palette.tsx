import { useEffect, useRef } from 'react'
import type { Scored } from '../../../shared/palette'
import { originOf } from '../../../shared/palette'
import { C, MONO } from '../theme'

/** 当たった文字だけ色を変える。位置は filterCommands が返したものを使う */
function Highlighted({ text, matches }: { text: string; matches: number[] }): React.JSX.Element {
  if (matches.length === 0) return <>{text}</>
  const set = new Set(matches)
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} style={set.has(i) ? { color: C.amber } : undefined}>{ch}</span>
      ))}
    </>
  )
}

export function Palette({
  results,
  total,
  selected,
  onSelect,
  onChoose
}: {
  results: Scored[]
  total: number
  selected: number
  onSelect: (i: number) => void
  onChoose: (s: Scored) => void
}): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const current = results[selected]

  // 選択がキーボードで動いたとき、見えるところへ寄せる
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div style={{
      border: `1px solid ${C.line2}`, borderRadius: 11, background: C.surface,
      boxShadow: '0 24px 64px rgba(0,0,0,0.55)', overflow: 'hidden',
      display: 'flex', flexDirection: 'column'
    }}>
      <div ref={listRef} style={{ maxHeight: 268, overflowY: 'auto', padding: 6 }}>
        {results.length === 0 && (
          <div style={{ padding: '14px 12px', fontSize: 12.5, color: C.faint }}>
            当たるコマンドがありません
          </div>
        )}
        {results.map((s, i) => {
          const origin = originOf(s.command)
          return (
            <div
              key={s.command.name}
              data-selected={i === selected}
              onMouseEnter={() => onSelect(i)}
              onMouseDown={(e) => { e.preventDefault(); onChoose(s) }}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 12, padding: '9px 12px',
                borderRadius: 7, cursor: 'pointer',
                background: i === selected ? C.raised : 'transparent'
              }}
            >
              <span style={{ font: `12.5px ${MONO}`, flexShrink: 0,
                color: i === selected ? C.ink : C.ink2 }}>
                /<Highlighted text={s.command.name} matches={s.matches} />
              </span>
              <span style={{ fontSize: 12, color: C.dim2, flexGrow: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.command.description}
              </span>
              {s.viaAlias && (
                <span style={{ font: `10.5px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  別名 {s.viaAlias}
                </span>
              )}
              {s.viaDescription && (
                <span style={{ fontSize: 10.5, color: C.faint, flexShrink: 0 }}>説明で一致</span>
              )}
              {s.command.argumentHint && (
                <span style={{ font: `11px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  {s.command.argumentHint}
                </span>
              )}
              {origin.namespace && (
                <span style={{ font: `10.5px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  {origin.namespace}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {current && (
        <div style={{ borderTop: `1px solid ${C.line}`, background: C.panel,
          padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ font: `12px ${MONO}`, color: C.amber }}>/{current.command.name}</span>
            {current.command.argumentHint && (
              <span style={{ font: `11px ${MONO}`, color: C.dim2 }}>{current.command.argumentHint}</span>
            )}
          </div>
          {current.command.description && (
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>{current.command.description}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '9px 15px',
        background: C.panel, borderTop: `1px solid ${C.line}`, fontSize: 11, color: C.faint }}>
        <span style={{ font: `11px ${MONO}` }}>↑↓ 選択</span>
        <span style={{ font: `11px ${MONO}` }}>↵ / ⇥ 補完</span>
        <span style={{ font: `11px ${MONO}` }}>⌘↵ 送信</span>
        <span style={{ font: `11px ${MONO}` }}>esc 閉じる</span>
        <div style={{ flexGrow: 1 }} />
        <span>{results.length} / {total} 件</span>
      </div>
    </div>
  )
}

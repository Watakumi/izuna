import { useEffect, useRef } from 'react'
import type { Scored } from '../../../shared/palette'
import { isDeprioritized, originOf } from '../../../shared/palette'
import { F, C, MONO, ellipsis } from '../theme'

/** 当たった文字だけ色を変える。位置は filterCommands が返したものを使う */
function Highlighted({ text, matches }: { text: string; matches: number[] }): React.JSX.Element {
  if (matches.length === 0) return <>{text}</>
  const set = new Set(matches)
  return (
    <>
      {[...text].map((ch, i) => (
        <span key={i} style={set.has(i) ? { color: C.amber } : undefined}>
          {ch}
        </span>
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
    listRef.current
      ?.querySelector<HTMLElement>('[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      style={{
        border: `1px solid ${C.line2}`,
        borderRadius: 11,
        background: C.surface,
        boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div ref={listRef} style={{ maxHeight: 268, overflowY: 'auto', padding: 6 }}>
        {results.length === 0 && (
          <div style={{ padding: '16px 12px', fontSize: F.body, color: C.faint }}>
            一致するコマンドがありません
          </div>
        )}
        {results.map((s, i) => {
          const origin = originOf(s.command)
          return (
            <div
              key={s.command.name}
              data-selected={i === selected}
              onMouseEnter={() => onSelect(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                onChoose(s)
              }}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 12,
                padding: '8px 12px',
                borderRadius: 7,
                cursor: 'pointer',
                background: i === selected ? C.raised : 'transparent'
              }}
            >
              <span
                style={{
                  font: `${F.body}px ${MONO}`,
                  flexShrink: 0,
                  color: i === selected ? C.ink : C.ink2
                }}
              >
                /<Highlighted text={s.command.name} matches={s.matches} />
              </span>
              <span style={{ fontSize: F.body, color: C.dim2, flexGrow: 1, ...ellipsis }}>
                {s.command.description}
              </span>
              {s.viaAlias && (
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  別名 {s.viaAlias}
                </span>
              )}
              {s.viaDescription && (
                <span style={{ fontSize: F.micro, color: C.faint, flexShrink: 0 }}>説明で一致</span>
              )}
              {s.command.argumentHint && (
                // 行では切る。全文は下の詳細に出るので失われない
                <span
                  style={{
                    font: `${F.small}px ${MONO}`,
                    color: C.faint,
                    flexShrink: 0,
                    maxWidth: 210,
                    ...ellipsis
                  }}
                >
                  {s.command.argumentHint}
                </span>
              )}
              {origin.namespace && (
                <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
                  {origin.namespace}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {current && (
        <div
          style={{
            borderTop: `1px solid ${C.line}`,
            background: C.panel,
            padding: '12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: `${F.body}px ${MONO}`, color: C.amber }}>
              /{current.command.name}
            </span>
            {current.command.argumentHint && (
              <span
                style={{ font: `${F.small}px ${MONO}`, color: C.dim2, wordBreak: 'break-word' }}
              >
                {current.command.argumentHint}
              </span>
            )}
            {isDeprioritized(current.command) && (
              <span style={{ fontSize: F.micro, color: C.amber }}>内部用・廃止済み</span>
            )}
          </div>
          {current.command.description && (
            <div style={{ fontSize: F.body, color: C.dim, lineHeight: 1.6 }}>
              {current.command.description}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '8px 16px',
          background: C.panel,
          borderTop: `1px solid ${C.line}`,
          fontSize: F.small,
          color: C.faint
        }}
      >
        <span style={{ font: `${F.small}px ${MONO}` }}>↑↓ 選択</span>
        <span style={{ font: `${F.small}px ${MONO}` }}>↵ / ⇥ 補完</span>
        <span style={{ font: `${F.small}px ${MONO}` }}>⌘↵ 送信</span>
        <span style={{ font: `${F.small}px ${MONO}` }}>esc 閉じる</span>
        <div style={{ flexGrow: 1 }} />
        <span>
          {results.length} / {total} 件
        </span>
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { Draft, Item } from '../../../shared/transcript'
import { C, MONO } from '../theme'
import { ToolBlock } from './ToolBlock'

function Thinking({ text }: { text: string }): React.JSX.Element {
  // 思考は既定で畳む。読みたい人だけ開ける
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: C.dim2, fontSize: 11 }}>
        <span style={{ font: `11px ${MONO}`, color: C.faint, width: 9 }}>{open ? '▾' : '▸'}</span>
        思考
      </div>
      {open && (
        <div style={{ borderLeft: `2px solid ${C.line2}`, paddingLeft: 12, color: C.dim,
          fontSize: 12, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
          {text || '（要約は返っていません）'}
        </div>
      )}
    </div>
  )
}

function ItemView({ item }: { item: Item }): React.JSX.Element | null {
  if (item.kind === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '68%', background: C.raised,
        padding: '12px 16px', borderRadius: '10px 10px 2px 10px', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
        {item.text}
      </div>
    )
  }

  if (item.kind === 'notice') {
    return (
      <div style={{ border: `1px solid ${item.tone === 'bad' ? C.red : C.amberLine}`, borderRadius: 7,
        padding: '12px 12px', fontSize: 12, color: item.tone === 'bad' ? C.red : C.amber }}>
        {item.text}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {item.blocks.map((b, i) => {
        if (b.kind === 'thinking') return <Thinking key={i} text={b.text} />
        if (b.kind === 'tool') return <ToolBlock key={i} block={b} />
        return (
          <div key={i} style={{ color: C.ink2, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{b.text}</div>
        )
      })}
    </div>
  )
}

/** 流れている途中の文字。確定が来たら消える（状態ではない） */
function DraftView({ draft }: { draft: Draft }): React.JSX.Element {
  const label = draft.kind === 'thinking' ? '考えています' : draft.kind === 'tool' ? `${draft.toolName ?? 'ツール'} を組み立てています` : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && <span style={{ fontSize: 11, color: C.dim2 }}>{label}<Dots /></span>}
      {draft.kind === 'text' && (
        <div style={{ color: C.ink2, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
          {draft.text}
          <span style={{ background: C.amber, color: C.amber, marginLeft: 1 }}>&nbsp;</span>
        </div>
      )}
    </div>
  )
}

function Dots(): React.JSX.Element {
  return <span style={{ color: C.faint }}> …</span>
}

export function Conversation({ items, draft }: { items: Item[]; draft: Draft | null }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '24px 24px' }}>
      {items.length === 0 && !draft && (
        <div style={{ color: C.faint, fontSize: 12 }}>作業ディレクトリを選んで、依頼を送ってください</div>
      )}
      {items.map((item) => (
        <ItemView key={item.kind === 'assistant' ? item.id : `${item.kind}-${item.id}`} item={item} />
      ))}
      {draft && <DraftView draft={draft} />}
    </div>
  )
}

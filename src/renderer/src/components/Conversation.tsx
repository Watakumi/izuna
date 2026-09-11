import { useState } from 'react'
import type { Draft, Item } from '../../../shared/transcript'
import { toDataUrl } from '../../../shared/image'
import { C, F, MONO, R, READ } from '../theme'
import { ToolBlock } from './ToolBlock'
import { Markdown } from './Markdown'

function Thinking({ text }: { text: string }): React.JSX.Element {
  // 思考は既定で畳む。読みたい人だけ開ける
  const [open, setOpen] = useState(false)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          color: C.dim2,
          fontSize: F.small
        }}
      >
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint, width: 9 }}>
          {open ? '▾' : '▸'}
        </span>
        思考
      </div>
      {open && (
        <div
          style={{
            borderLeft: `2px solid ${C.line2}`,
            paddingLeft: 12,
            color: C.dim,
            font: READ,
            whiteSpace: 'pre-wrap'
          }}
        >
          {text || '（要約は返っていません）'}
        </div>
      )}
    </div>
  )
}

function ItemView({
  item,
  onAsk
}: {
  item: Item
  onAsk?: (path: string) => void
}): React.JSX.Element | null {
  if (item.kind === 'user') {
    return (
      <div
        style={{
          alignSelf: 'flex-end',
          maxWidth: '68%',
          background: C.raised,
          padding: '12px 16px',
          borderRadius: '10px 10px 2px 10px',
          font: READ,
          display: 'flex',
          flexDirection: 'column',
          gap: 8
        }}
      >
        {/* **送った画像はここに残す。** 何を見せたのかが後から分からないと、
            返事の意味も分からなくなる */}
        {item.images && item.images.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {item.images.map((a, i) => (
              <img
                key={i}
                src={toDataUrl(a)}
                alt={a.name}
                style={{ maxHeight: 160, maxWidth: '100%', borderRadius: R.md, display: 'block' }}
              />
            ))}
          </div>
        )}
        <span style={{ whiteSpace: 'pre-wrap' }}>{item.text}</span>
      </div>
    )
  }

  if (item.kind === 'notice') {
    return (
      // **成功の知らせを警告の色で出さない。** アンバーは人の判断待ちだけ（§17）
      <div
        style={{
          border: `1px solid ${item.tone === 'bad' ? C.red : item.tone === 'info' ? C.line2 : C.amberLine}`,
          borderRadius: 7,
          padding: '12px 12px',
          fontSize: F.body,
          color: item.tone === 'bad' ? C.red : item.tone === 'info' ? C.dim : C.amber
        }}
      >
        {item.text}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {item.blocks.map((b, i) => {
        if (b.kind === 'thinking') return <Thinking key={i} text={b.text} />
        if (b.kind === 'tool') return <ToolBlock key={i} block={b} onAsk={onAsk} />
        return (
          // **確定した本文だけ markdown にする。** 途中の draft は下で素のまま出す
          <div key={i} style={{ color: C.ink2 }}>
            <Markdown text={b.text} />
          </div>
        )
      })}
    </div>
  )
}

/** 流れている途中の文字。確定が来たら消える（状態ではない） */
function DraftView({ draft }: { draft: Draft }): React.JSX.Element {
  const label =
    draft.kind === 'thinking'
      ? '考えています'
      : draft.kind === 'tool'
        ? `${draft.toolName ?? 'ツール'} の入力を書いています`
        : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <span style={{ fontSize: F.small, color: C.dim2 }}>
          {label}
          <Dots />
        </span>
      )}
      {draft.kind === 'text' && (
        <div style={{ color: C.ink2, font: READ, whiteSpace: 'pre-wrap' }}>
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

export function Conversation({
  items,
  draft,
  onAsk
}: {
  items: Item[]
  draft: Draft | null
  /** 差分を指して会話を始める（§34）。省略なら釦を出さない */
  onAsk?: (path: string) => void
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '24px 24px' }}>
      {items.length === 0 && !draft && (
        <div style={{ color: C.faint, fontSize: F.body }}>依頼を送ると、ここに会話が出ます</div>
      )}
      {items.map((item) => (
        <ItemView
          key={item.kind === 'assistant' ? item.id : `${item.kind}-${item.id}`}
          item={item}
          onAsk={onAsk}
        />
      ))}
      {draft && <DraftView draft={draft} />}
    </div>
  )
}

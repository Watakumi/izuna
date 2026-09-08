import { useState } from 'react'
import type { Block } from '../../../shared/transcript'
import { describeToolInput, diffFromToolInput } from '../../../shared/diff'
import { F, C, MONO, ellipsis } from '../theme'
import { DiffView } from './DiffView'

type Tool = Extract<Block, { kind: 'tool' }>

const STATE: Record<Tool['state'], { label: string; color: string }> = {
  running: { label: '実行中', color: C.dim2 },
  done: { label: '完了', color: C.teal },
  error: { label: '失敗', color: C.red },
  denied: { label: '拒否しました', color: C.amber }
}

export function ToolBlock({ block }: { block: Tool }): React.JSX.Element {
  const diff = diffFromToolInput(block.name, block.input)
  // 差分のあるものは開いて出す。承認したものを畳んで隠さない
  const [open, setOpen] = useState(diff !== null)
  const s = STATE[block.state]
  // Bash の終了コードは結果本文にしか出ない。拾えたら出す（モックの `exit 0`）
  const exitCode = block.name === 'Bash' && block.result !== null
    ? /(?:^|\n)\s*(?:exit code|Exit code)[: ]+(\d+)/.exec(block.result)?.[1] ?? null
    : null

  return (
    <div style={{ border: `1px solid ${C.line2}`, borderRadius: 7, overflow: 'hidden', background: C.surface }}>
      <div onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}>
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint, width: 9 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500, fontSize: F.body }}>{block.name}</span>
        <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2, flexGrow: 1, ...ellipsis }}>
          {describeToolInput(block.name, block.input)}
        </span>
        {exitCode !== null && (
          <span style={{ font: `${F.small}px ${MONO}`, color: exitCode === '0' ? C.teal : C.red, flexShrink: 0 }}>
            exit {exitCode}
          </span>
        )}
        <span style={{ fontSize: F.small, color: s.color, flexShrink: 0 }}>{s.label}</span>
      </div>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diff
            ? <DiffView diff={diff} />
            : <pre style={{ margin: 0, padding: '12px 12px', background: C.code, borderRadius: 7,
                font: `11.5px/1.7 ${MONO}`, color: C.dim, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {JSON.stringify(block.input, null, 2)}
              </pre>}
          {block.result && (
            <pre style={{ margin: 0, padding: '12px 12px', background: C.code, borderRadius: 7,
              font: `11.5px/1.7 ${MONO}`, color: block.state === 'done' ? C.dim : C.delInk,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto' }}>
              {block.result.length > 4000 ? block.result.slice(0, 4000) + '\n…' : block.result}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

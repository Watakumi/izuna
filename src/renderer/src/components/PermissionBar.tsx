import type { PermissionRequest } from '../../../main/claude/session'
import { describeToolInput, diffFromToolInput } from '../../../shared/diff'
import { C, MONO } from '../theme'
import { DiffView } from './DiffView'

/**
 * 承認は**人間が持つ**（docs/GOAL.md 完成の定義 5）。
 * ブレインにも自動にも渡さない。並列で一番壊れる箇所を無人にしないため。
 */
export function PermissionBar({
  request,
  onAllow,
  onDeny
}: {
  request: PermissionRequest
  onAllow: (alwaysThisSession: boolean) => void
  onDeny: () => void
}): React.JSX.Element {
  const diff = diffFromToolInput(request.toolName, request.input)
  // CLI が「常に許可」の中身を提案してくる。ボタンの意味を自前で決めない
  const suggestion = request.suggestions?.[0]

  return (
    <div style={{ border: `1px solid ${C.amberLine}`, background: C.amberBg, borderRadius: 11,
      display: 'flex', flexDirection: 'column', gap: 12, padding: 15 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <b style={{ fontSize: 13 }}>{request.toolName}</b>
            <span style={{ font: `11.5px ${MONO}`, color: C.ink2, overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {describeToolInput(request.toolName, request.input)}
            </span>
          </div>
          {request.description && (
            <span style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>{request.description}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button onClick={() => onAllow(false)} style={BTN}>許可</button>
          <button onClick={onDeny} style={GHOST}>拒否</button>
        </div>
      </div>

      {diff && <DiffView diff={diff} max={200} />}

      {suggestion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: C.dim2 }}>
          <span>CLI の提案:</span>
          <button onClick={() => onAllow(true)} style={{ ...GHOST, padding: '5px 11px', fontSize: 11.5 }}>
            このセッション中は許可
          </button>
          <span style={{ font: `10.5px ${MONO}`, color: C.faint }}>
            {'type' in suggestion ? String(suggestion.type) : ''}
            {'mode' in suggestion ? ` · ${String(suggestion.mode)}` : ''}
            {'destination' in suggestion ? ` · ${String(suggestion.destination)}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}

const BTN: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 12.5, cursor: 'pointer'
}
const GHOST: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, border: `1px solid ${C.amberLine}`,
  background: 'transparent', color: C.ink2, fontSize: 12.5, cursor: 'pointer'
}

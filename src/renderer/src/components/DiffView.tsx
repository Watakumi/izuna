import type { FileDiff } from '../../../shared/diff'
import { C, MONO } from '../theme'

/** ツールが宣言した変更をそのまま出す。承認の材料 */
export function DiffView({ diff, max = 400 }: { diff: FileDiff; max?: number }): React.JSX.Element {
  const shown = diff.lines.slice(0, max)
  const hidden = diff.lines.length - shown.length

  return (
    <div style={{ background: C.code, borderRadius: 7, overflow: 'hidden', border: `1px solid ${C.line}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
        borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <span style={{ font: `11.5px ${MONO}`, color: C.ink2, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{diff.path}</span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ font: `11px ${MONO}`, color: C.teal }}>+{diff.added}</span>
        <span style={{ font: `11px ${MONO}`, color: C.red }}>−{diff.removed}</span>
        {diff.whole && <span style={{ fontSize: 10.5, color: C.faint }}>新規／全文</span>}
      </div>
      <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
        {shown.map((l, i) => (
          <div key={i} style={{
            display: 'flex', font: `11.5px/1.75 ${MONO}`, whiteSpace: 'pre',
            background: l.kind === 'add' ? C.addBg : l.kind === 'del' ? C.delBg : 'transparent',
            color: l.kind === 'add' ? C.addInk : l.kind === 'del' ? C.delInk : C.dim
          }}>
            <span style={{ width: 42, flexShrink: 0, textAlign: 'right', paddingRight: 8, color: C.faint }}>
              {l.before ?? ''}
            </span>
            <span style={{ width: 42, flexShrink: 0, textAlign: 'right', paddingRight: 10, color: C.faint }}>
              {l.after ?? ''}
            </span>
            <span style={{ width: 14, flexShrink: 0 }}>
              {l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}
            </span>
            <span style={{ paddingRight: 14 }}>{l.text || ' '}</span>
          </div>
        ))}
      </div>
      {hidden > 0 && (
        <div style={{ padding: '7px 12px', fontSize: 11, color: C.faint, borderTop: `1px solid ${C.line}` }}>
          ほか {hidden} 行
        </div>
      )}
    </div>
  )
}

import type { Panel } from '../useSessions'
import { C, MONO } from '../theme'

/**
 * セッション一覧（段3）。
 *
 * 並列で最も壊れるのは**承認の取りこぼし**なので、承認待ちだけアンバーで
 * 立たせる。ほかの状態に同じ色を使わない（design/ の規律を引き継ぐ）。
 */
function dot(panel: Panel): { color: string; filled: boolean } {
  if (panel.pending) return { color: C.amber, filled: true }
  if (panel.ended) return { color: C.faint, filled: false }
  if (panel.transcript.state === 'running' || panel.transcript.running) {
    return { color: C.teal, filled: true }
  }
  return { color: C.faint, filled: false }
}

function label(panel: Panel): string {
  if (panel.pending) return '承認待ち'
  if (panel.ended) return '終了'
  if (panel.transcript.state === 'running' || panel.transcript.running) return '実行中'
  return '待機'
}

/** cwd の親ディレクトリ名でリポジトリを推測して束ねる */
function group(panels: Panel[]): Array<[string, Panel[]]> {
  const byRepo = new Map<string, Panel[]>()
  for (const p of panels) {
    // worktree は ~/.izuna/worktrees/<repo>/<branch> なので親の親、
    // それ以外は cwd の名前そのもの
    const parts = p.cwd.split('/').filter(Boolean)
    const at = parts.indexOf('worktrees')
    const repo = at !== -1 && parts[at + 1] ? parts[at + 1] : (parts.at(-1) ?? '?')
    byRepo.set(repo, [...(byRepo.get(repo) ?? []), p])
  }
  return [...byRepo].sort(([a], [b]) => a.localeCompare(b))
}

export function Sidebar({
  panels,
  activeId,
  onSelect,
  onClose,
  onNew
}: {
  panels: Panel[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}): React.JSX.Element {
  return (
    <div style={{
      width: 246, flexShrink: 0, background: C.panel, borderRight: `1px solid ${C.line}`,
      display: 'flex', flexDirection: 'column'
    }}>
      <div style={{ padding: '12px 16px 8px', fontSize: 11, letterSpacing: '0.08em',
        color: C.dim2, fontWeight: 600 }}>
        セッション {panels.length > 0 && <span style={{ color: C.faint }}>{panels.length}</span>}
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '0 8px',
        display: 'flex', flexDirection: 'column', gap: 2 }}>
        {panels.length === 0 && (
          <div style={{ padding: '12px 8px', fontSize: 11, color: C.faint, lineHeight: 1.7 }}>
            まだありません。<br />下の「新しいセッション」から。
          </div>
        )}
        {group(panels).map(([repo, group]) => (
          <div key={repo} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* リポジトリで束ねる。並列で走らせると、どのリポジトリの話か分からなくなる */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px 4px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.faint}
                strokeWidth="1.9"><path d="M4 4h11l5 5v11H4z" /></svg>
              <span style={{ font: `11px ${MONO}`, color: C.dim2 }}>{repo}</span>
              <span style={{ fontSize: 10, color: C.faint }}>{group.length}</span>
            </div>
            {group.map((p) => {
          const d = dot(p)
          const on = p.id === activeId
          return (
            <div
              key={p.id}
              onClick={() => onSelect(p.id)}
              style={{
                display: 'flex', gap: 8, padding: '8px 12px', borderRadius: 7, cursor: 'pointer',
                background: on ? C.raised : 'transparent',
                borderLeft: `2px solid ${p.pending ? C.amber : on ? C.line2 : 'transparent'}`
              }}
            >
              <span style={{
                width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                background: d.filled ? d.color : 'transparent',
                border: d.filled ? 'none' : `1.5px solid ${d.color}`
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>
                <span style={{ fontSize: 12, color: on ? C.ink : C.ink2, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label}</span>
                <span style={{ font: `10px ${MONO}`, color: p.pending ? C.amber : C.dim2,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.branch ?? '(worktree なし)'} · {label(p)}
                </span>
              </div>
              <span
                onClick={(e) => { e.stopPropagation(); onClose(p.id) }}
                title="このセッションを閉じる"
                style={{ color: C.faint, fontSize: 15, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
              >×</span>
            </div>
          )
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${C.line}` }}>
        <div
          onClick={onNew}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '8px 12px', borderRadius: 7, border: `1px dashed ${C.line2}`,
            color: C.dim, fontSize: 12, cursor: 'pointer'
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          新しいセッション
        </div>
      </div>
    </div>
  )
}

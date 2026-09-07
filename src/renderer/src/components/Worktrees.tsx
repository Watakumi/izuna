import { useCallback, useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../../main/git/worktree'
import { canRemove, type Worktree } from '../../../shared/worktree'
import type { Panel } from '../useSessions'
import { C, MONO } from '../theme'

/**
 * worktree の一覧（段3 の見える化）。
 *
 * **人が自分で起こした分**を扱う。ブレイン配下の実行役は Claude Code の
 * agent isolation が配るので、ここには出ない（CLAUDE.md §12）。
 *
 * 畳む操作は取り返しがつかないので、**未 push を警告してから**にする。
 */
type Row = Worktree & { status: WorktreeStatus | null; session: Panel | null }

export function Worktrees({
  cwd,
  panels,
  onClose,
  onOpen
}: {
  cwd: string
  panels: Panel[]
  onClose: () => void
  onOpen: (worktree: Worktree) => void
}): React.JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(async () => {
    const repo = await window.izuna.repo(cwd)
    const withStatus = await Promise.all(repo.worktrees.map(async (w) => ({
      ...w,
      status: await window.izuna.worktreeStatus(w.path).catch(() => null),
      session: panels.find((p) => p.cwd === w.path) ?? null
    })))
    setRows(withStatus)
  }, [cwd, panels])

  useEffect(() => { void load() }, [load])

  const remove = async (row: Row, force: boolean): Promise<void> => {
    setBusy(row.path)
    setMsg(null)
    try {
      await window.izuna.removeWorktree(cwd, row.path, force)
      setMsg({ text: `${row.branch ?? row.path} を畳みました`, bad: false })
      setConfirming(null)
      await load()
    } catch (e) {
      setMsg({ text: String(e).replace(/^Error:\s*/, ''), bad: true })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,9,12,0.62)',
      zIndex: 40, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 780, maxHeight: '80vh',
        background: C.surface, border: `1px solid ${C.line2}`, borderRadius: 13,
        boxShadow: '0 28px 80px rgba(0,0,0,0.62)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.line}`,
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>worktree</span>
          <span style={{ fontSize: 11.5, color: C.dim2 }}>人が自分で起こした分</span>
          <div style={{ flexGrow: 1 }} />
          <button onClick={() => void load()} style={GHOST}>読み直す</button>
          <button onClick={onClose} style={GHOST}>閉じる</button>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: 14,
          display: 'flex', flexDirection: 'column', gap: 9 }}>
          {!rows && <div style={{ color: C.faint, fontSize: 12.5, padding: 10 }}>調べています…</div>}

          {rows?.map((row) => {
            const blocked = canRemove(row)
            const unpushed = (row.status?.ahead ?? 0) > 0 || (row.status?.changed ?? 0) > 0
            return (
              <div key={row.path} style={{ border: `1px solid ${row.session ? C.line2 : C.line}`,
                borderRadius: 9, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9,
                background: row.session ? C.raised : 'transparent' }}>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                    background: row.session?.pending ? C.amber
                      : row.session ? C.teal : 'transparent',
                    border: row.session ? 'none' : `1.5px solid ${C.faint}` }} />
                  <span style={{ font: `12px ${MONO}`, color: C.ink }}>
                    {row.branch ?? '(detached)'}
                  </span>
                  {row.main && <Tag>本体</Tag>}
                  {row.locked !== null && <Tag>ロック</Tag>}
                  {row.session && <Tag>{row.session.pending ? '承認待ち' : 'セッション中'}</Tag>}
                  <div style={{ flexGrow: 1 }} />
                  {row.status && (
                    <div style={{ display: 'flex', gap: 12, fontSize: 11.5, flexShrink: 0 }}>
                      <span style={{ color: row.status.changed ? C.teal : C.faint }}>{row.status.changed} 変更</span>
                      {row.status.ahead > 0 && <span style={{ color: C.amber }}>↑{row.status.ahead}</span>}
                      {row.status.behind > 0 && <span style={{ color: C.dim2 }}>↓{row.status.behind}</span>}
                    </div>
                  )}
                </div>

                <span style={{ font: `10.5px ${MONO}`, color: C.faint, wordBreak: 'break-all' }}>
                  {row.path}
                </span>

                {confirming === row.path ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.amberBg,
                    border: `1px solid ${C.amberLine}`, borderRadius: 7, padding: '9px 12px' }}>
                    <span style={{ fontSize: 11.5, color: C.ink2, flexGrow: 1, lineHeight: 1.6 }}>
                      {unpushed
                        ? '未 push の変更があります。畳むと戻せません'
                        : '畳みます。ディレクトリは消えます'}
                    </span>
                    <button disabled={busy !== null} style={{ ...BTN, background: C.red, color: '#fff' }}
                      onClick={() => void remove(row, unpushed)}>
                      {busy === row.path ? '畳んでいます…' : '畳む'}
                    </button>
                    <button style={GHOST} onClick={() => setConfirming(null)}>やめる</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {!row.session && !row.main && (
                      <button style={BTN} onClick={() => { onOpen(row); onClose() }}>ここでセッションを起こす</button>
                    )}
                    {!blocked && (
                      <button style={GHOST} onClick={() => setConfirming(row.path)}>畳む</button>
                    )}
                    {blocked && <span style={{ fontSize: 11, color: C.faint, alignSelf: 'center' }}>{blocked}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {msg && (
          <div style={{ padding: '11px 18px', borderTop: `1px solid ${C.line}`, fontSize: 12,
            color: msg.bad ? C.red : C.ink2, whiteSpace: 'pre-wrap' }}>{msg.text}</div>
        )}
      </div>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span style={{ fontSize: 10.5, color: C.dim2, padding: '2px 7px',
      border: `1px solid ${C.line2}`, borderRadius: 4, flexShrink: 0 }}>{children}</span>
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

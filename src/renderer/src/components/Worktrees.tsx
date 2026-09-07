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
  onOpen
}: {
  cwd: string
  panels: Panel[]
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
        background: C.panel, borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>ブランチ</span>
        <span style={{ fontSize: 10.5, color: C.faint }}>人が起こした分</span>
        <div style={{ flexGrow: 1 }} />
        <button onClick={() => void load()} style={GHOST}>読み直す</button>
      </div>

      <div style={{ padding: 13, display: 'flex', flexDirection: 'column', gap: 9 }}>
        {!rows && <span style={{ color: C.faint, fontSize: 11.5 }}>調べています…</span>}

        {rows?.map((row) => {
          const blocked = canRemove(row)
          const unpushed = (row.status?.ahead ?? 0) > 0 || (row.status?.changed ?? 0) > 0
          return (
            <div key={row.path} style={{ border: `1px solid ${row.session ? C.line2 : C.line}`,
              borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
              background: row.session ? C.raised : 'transparent' }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: row.session?.pending ? C.amber : row.session ? C.teal : 'transparent',
                  border: row.session ? 'none' : `1.5px solid ${C.faint}` }} />
                <span style={{ font: `11.5px ${MONO}`, color: C.ink, minWidth: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.branch ?? '(detached)'}
                </span>
                {row.main && <Tag>本体</Tag>}
                {row.locked !== null && <Tag>ロック</Tag>}
              </div>

              {row.status && (
                <div style={{ display: 'flex', gap: 11, fontSize: 11 }}>
                  <span style={{ color: C.teal }}>+{row.status.added}</span>
                  <span style={{ color: C.red }}>−{row.status.removed}</span>
                  <span style={{ color: C.dim2 }}>{row.status.changed} ファイル</span>
                  {row.status.ahead > 0 && <span style={{ color: C.amber }}>↑{row.status.ahead}</span>}
                </div>
              )}

              {confirming === row.path ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: C.amberBg,
                  border: `1px solid ${C.amberLine}`, borderRadius: 7, padding: '9px 11px' }}>
                  <span style={{ fontSize: 11, color: C.ink2, lineHeight: 1.6 }}>
                    {unpushed ? '未 push の変更があります。畳むと戻せません' : '畳みます。ディレクトリは消えます'}
                  </span>
                  <div style={{ display: 'flex', gap: 7 }}>
                    <button disabled={busy !== null} style={{ ...BTN, background: C.red, color: '#fff', flexGrow: 1 }}
                      onClick={() => void remove(row, unpushed)}>
                      {busy === row.path ? '畳んでいます…' : '畳む'}
                    </button>
                    <button style={GHOST} onClick={() => setConfirming(null)}>やめる</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 7 }}>
                  {!row.session && !row.main && (
                    <button style={{ ...BTN, flexGrow: 1 }} onClick={() => onOpen(row)}>ここで起こす</button>
                  )}
                  {!blocked && <button style={GHOST} onClick={() => setConfirming(row.path)}>畳む</button>}
                  {blocked && <span style={{ fontSize: 10.5, color: C.faint, alignSelf: 'center' }}>{blocked}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {msg && (
        <div style={{ padding: '11px 14px', borderTop: `1px solid ${C.line}`, fontSize: 11.5,
          color: msg.bad ? C.red : C.ink2 }}>{msg.text}</div>
      )}
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
  padding: '7px 12px', borderRadius: 7, border: 'none', background: C.amber,
  color: C.amberInk, fontWeight: 600, fontSize: 11.5, cursor: 'pointer'
}
const GHOST: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 7, border: `1px solid ${C.line2}`,
  background: 'transparent', color: C.ink2, fontSize: 11.5, cursor: 'pointer'
}

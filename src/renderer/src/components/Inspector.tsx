import { useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../../main/git/worktree'
import { rolesIn, type RemoteRef } from '../../../shared/remote'
import type { Panel } from '../useSessions'
import { C, MONO } from '../theme'

/**
 * 右のインスペクタ。**いま開いているセッションの周辺**を出す。
 *
 * 会話に出ないが判断に要るものを集める: どこで作業しているか、
 * どれだけ変わったか、枠がどれだけ残っているか、共有フォルダはどこか。
 */
export function Inspector({ panel }: { panel: Panel }): React.JSX.Element {
  const [status, setStatus] = useState<WorktreeStatus | null>(null)
  const [remotes, setRemotes] = useState<RemoteRef[]>([])
  const [team, setTeam] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      const [st, rs, tp] = await Promise.all([
        window.izuna.worktreeStatus(panel.cwd).catch(() => null),
        window.izuna.remotes(panel.cwd).catch(() => []),
        window.izuna.teamPath(panel.team).catch(() => null)
      ])
      if (!alive) return
      setStatus(st)
      setRemotes(rs)
      setTeam(tp)
    }
    void load()
    // 走っているあいだは変わり続けるので、止まったときに取り直す
    return () => { alive = false }
  }, [panel.cwd, panel.team, panel.transcript.state])

  const { sandbox, upstream } = rolesIn(remotes)
  const limits = panel.transcript.limits

  return (
    <div style={{ width: 268, flexShrink: 0, background: C.panel, borderLeft: `1px solid ${C.line}`,
      display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>

      <Block title="WORKTREE">
        <span style={{ font: `12px ${MONO}`, color: C.ink }}>{status?.branch ?? panel.branch ?? '(不明)'}</span>
        <span style={{ font: `10.5px ${MONO}`, color: C.faint, wordBreak: 'break-all' }}>{panel.cwd}</span>
        {status && (
          <div style={{ display: 'flex', gap: 14, fontSize: 11.5, flexWrap: 'wrap' }}>
            <span style={{ color: status.changed > 0 ? C.teal : C.faint }}>{status.changed} 変更</span>
            {status.ahead > 0 && <span style={{ color: C.dim2 }}>↑{status.ahead}</span>}
            {status.behind > 0 && <span style={{ color: C.amber }}>↓{status.behind}</span>}
          </div>
        )}
      </Block>

      <Block title="REMOTE">
        <Line label="sandbox" value={sandbox ? sandbox.host ?? sandbox.name : '未設定'}
          tone={sandbox ? 'ok' : 'off'} />
        <Line label="upstream" value={upstream ? `${upstream.owner}/${upstream.repo}` : '未設定'}
          tone={upstream ? 'ok' : 'off'} />
      </Block>

      <Block title="枠">
        {limits ? (
          <>
            <Meter label="5時間" value={limits.fiveHour} />
            <Meter label="7日" value={limits.sevenDay} />
            <span style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.6 }}>
              ターミナルの Claude Code と同じ窓を共有します
            </span>
          </>
        ) : (
          <span style={{ fontSize: 11.5, color: C.faint }}>まだ届いていません</span>
        )}
      </Block>

      <Block title="共有フォルダ">
        <span style={{ font: `10.5px ${MONO}`, color: C.dim2, wordBreak: 'break-all' }}>
          {team ?? '—'}
        </span>
        <span style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.65 }}>
          ブレインと実行役はここだけを共有します。<b style={{ color: C.dim2, fontWeight: 500 }}>圧縮を跨いで残るのもここだけ。</b>
        </span>
      </Block>

      {panel.transcript.tasks.length > 0 && (
        <Block title="実行役">
          {panel.transcript.tasks.map((t) => (
            <div key={t.taskId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: t.status === 'running' ? C.teal : C.faint }} />
              <span style={{ fontSize: 11.5, color: C.ink2, flexGrow: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.description || t.subagentType}
              </span>
              {t.usage && (
                <span style={{ font: `10px ${MONO}`, color: C.faint }}>
                  {(t.usage.totalTokens / 1000).toFixed(0)}k
                </span>
              )}
            </div>
          ))}
        </Block>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ padding: '14px 16px', borderBottom: `1px solid ${C.line}`,
      display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 11, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>{title}</span>
      {children}
    </div>
  )
}

function Line({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'off' }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
        background: tone === 'ok' ? C.teal : 'transparent',
        border: tone === 'ok' ? 'none' : `1.5px solid ${C.faint}` }} />
      <span style={{ font: `10.5px ${MONO}`, color: C.faint, width: 58, flexShrink: 0 }}>{label}</span>
      <span style={{ font: `11px ${MONO}`, color: tone === 'ok' ? C.ink2 : C.faint,
        minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

function Meter({ label, value }: { label: string; value: number }): React.JSX.Element {
  const pct = Math.round(value * 100)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color: C.dim }}>{label}</span>
        <span style={{ font: `11px ${MONO}`, color: C.ink2 }}>{pct}%</span>
      </div>
      <div style={{ height: 3, background: C.raised, borderRadius: 2 }}>
        <div style={{ width: `${Math.min(pct, 100)}%`, height: 3, borderRadius: 2,
          background: pct > 70 ? C.amber : C.teal }} />
      </div>
    </div>
  )
}

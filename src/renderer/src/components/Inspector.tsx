import { useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../../main/git/worktree'
import type { GitHubIssue } from '../../../main/forge/github'
import { rolesIn, type RemoteRef } from '../../../shared/remote'
import type { Panel } from '../useSessions'
import { F, C, MONO, ellipsis } from '../theme'
import { Meter } from './ui'

/**
 * 右ペインの「情報」タブ。
 *
 * **並べる順は「作業中に目をやる頻度」。** どこで作業しているか →
 * 次に何を出すか → 残りどれだけ走らせられるか、の順に置く。
 *
 * 会話の下に出ているもの（実行役 = TaskPanel）はここに重ねない。
 * 同じ情報が 2 箇所にあると、狭いほうを見る理由が無くなる。
 */
export function Inspector({
  panel,
  onOpenForge
}: {
  panel: Panel
  onOpenForge: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<WorktreeStatus | null>(null)
  // 「まだ読んでいない」を `null` で表す（`[]` だと『無い』と嘘をつく）
  const [remotes, setRemotes] = useState<RemoteRef[] | null>(null)
  const [issues, setIssues] = useState<GitHubIssue[] | null>(null)
  const [pushed, setPushed] = useState<boolean | null>(null)
  const [team, setTeam] = useState<string | null>(null)
  const [showTeam, setShowTeam] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      const [st, rs, tp] = await Promise.all([
        window.izuna.worktreeStatus(panel.cwd).catch(() => null),
        window.izuna.remotes(panel.cwd).catch(() => []),
        window.izuna.teamPath(panel.team).catch(() => null)
      ])
      if (!alive) return
      setStatus(st)
      setRemotes(rs)
      setTeam(tp)

      const { sandbox } = rolesIn(rs)
      if (sandbox && st?.branch) {
        const ok = await window.izuna.isPushed(panel.cwd, sandbox.name, st.branch).catch(() => false)
        if (alive) setPushed(ok)
      } else if (alive) setPushed(null)

      const list = await window.izuna.ghIssues(panel.cwd).catch(() => null)
      if (alive) setIssues(list)
    })()
    return () => { alive = false }
  }, [panel.cwd, panel.team, panel.transcript.state])

  const { sandbox, upstream } = rolesIn(remotes ?? [])
  const limits = panel.transcript.limits

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflowY: 'auto', height: '100%' }}>

      <Block title="WORKTREE">
        <span style={{ font: `${F.body}px ${MONO}`, color: C.ink }}>
          {status?.branch ?? panel.branch ?? '(不明)'}
        </span>
        <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, wordBreak: 'break-all' }}>{panel.cwd}</span>
        {status && (
          <div style={{ display: 'flex', gap: 12, fontSize: F.small, alignItems: 'baseline' }}>
            <span style={{ color: C.teal }}>+{status.added}</span>
            <span style={{ color: C.red }}>−{status.removed}</span>
            <span style={{ color: C.dim2 }}>{status.changed} ファイル</span>
            {status.ahead > 0 && <span style={{ color: C.amber }}>↑{status.ahead}</span>}
            {status.behind > 0 && <span style={{ color: C.dim2 }}>↓{status.behind}</span>}
          </div>
        )}
      </Block>

      <Block title="FORGEJO">
        {issues === null ? (
          <span style={{ fontSize: F.small, color: C.faint }}>GitHub に繋がっていません</span>
        ) : issues.length === 0 ? (
          <span style={{ fontSize: F.small, color: C.faint }}>open な Issue はありません</span>
        ) : (
          issues.slice(0, 2).map((i) => (
            <div key={i.number} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2, flexShrink: 0 }}>#{i.number}</span>
              <span style={{ fontSize: F.small, color: C.ink2, ...ellipsis }}>{i.title}</span>
            </div>
          ))
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: pushed ? C.teal : 'transparent',
            border: pushed ? 'none' : `1.5px solid ${C.faint}` }} />
          <span style={{ fontSize: F.small, color: C.dim2 }}>
            {/* 読み終わるまで断定しない。`[]` を「無い」と読むと一瞬だけ嘘が出る */}
            {remotes === null
              ? '確認しています…'
              : !sandbox ? 'sandbox 未設定' : pushed ? 'sandbox に push 済み' : 'push していません'}
          </span>
        </div>

        <button onClick={onOpenForge} style={{
          padding: '8px 0', borderRadius: 7, border: `1px solid ${C.line2}`,
          background: 'transparent', color: C.ink2, fontSize: F.body, cursor: 'pointer'
        }}>
          {remotes === null ? '…' : upstream ? 'PR を作る' : 'remote を用意する'}
        </button>
      </Block>

      <Block title="枠">
        {limits ? (
          <>
            <Meter label="5時間" value={limits.fiveHour} />
            <Meter label="7日" value={limits.sevenDay} />
          </>
        ) : (
          <span style={{ fontSize: F.small, color: C.faint }}>まだ届いていません</span>
        )}
      </Block>

      {/* 共有フォルダは畳んでおく。実行役を使わないセッションには無関係 */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
        <div onClick={() => setShowTeam((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, width: 8 }}>{showTeam ? '▾' : '▸'}</span>
          <span style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>
            共有フォルダ
          </span>
        </div>
        {showTeam && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 8 }}>
            <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2, wordBreak: 'break-all' }}>
              {team ?? '—'}
            </span>
            <span style={{ fontSize: F.micro, color: C.faint, lineHeight: 1.6 }}>
              ブレインと実行役はここだけを共有します
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ padding: '16px 16px', borderBottom: `1px solid ${C.line}`,
      display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>{title}</span>
      {children}
    </div>
  )
}


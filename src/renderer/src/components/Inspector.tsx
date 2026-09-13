import { useEffect, useState } from 'react'
import type { WorktreeStatus } from '../../../main/git/worktree'
import type { Panel } from '../useSessions'
import { makeCache } from '../remember'
import { limitLabel, stale } from '../../../shared/transcript'
import { F, C, MONO } from '../theme'
import { Meter } from './ui'

/**
 * `Status` タブの上半分（§35）。**どこで作業しているか**と**あと何回頼めるか**。
 *
 * **同じ事実を 2 か所に出さない**（§35 の規律）。ここから 2 つ落とした。
 *
 * | 落とした | いまどこにあるか |
 * | --- | --- |
 * | sandbox に push 済みか、PR を作る釦 | `PR` タブ（`Forge`）。あちらが push も PR も持つ |
 * | open な Issue の 2 件 | 新しいセッションの画面。Issue は「次に何を始めるか」で、`Status` の問いではない |
 *
 * 走っている実行役は会話の柱（`TaskPanel`）に出ているので、ここには重ねない。
 * ここに残るのは共有フォルダ由来のもの（`Board`）だけである。
 */
/** 覚えておく中身。鍵は作業ディレクトリ */
interface Snapshot {
  status: WorktreeStatus | null
  team: string | null
}
const remembered = makeCache<Snapshot>()

export function Inspector({ panel }: { panel: Panel }): React.JSX.Element {
  // 一度読んだものは覚えておく（`remember.ts` の註）
  const seed = remembered.get(panel.cwd)
  const [status, setStatus] = useState<WorktreeStatus | null>(seed?.status ?? null)
  const [team, setTeam] = useState<string | null>(seed?.team ?? null)
  const [showTeam, setShowTeam] = useState(false)
  /**
   * いまの時刻。**描く途中で `Date.now()` を呼ばない**（描画は純粋に保つ）。
   * 1 分ごとに進めれば、窓が空いた境目を跨いだことは分かる。
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [st, tp] = await Promise.all([
        window.izuna.worktreeStatus(panel.cwd).catch(() => null),
        window.izuna.teamPath(panel.team).catch(() => null)
      ])
      if (!alive) return
      setStatus(st)
      setTeam(tp)
      remembered.set(panel.cwd, { status: st, team: tp })
    })()
    return () => {
      alive = false
    }
  }, [panel.cwd, panel.team, panel.transcript.state])

  const limits = panel.transcript.limits

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Block title="WORKTREE">
        <span style={{ font: `${F.body}px ${MONO}`, color: C.ink }}>
          {status?.branch ?? panel.branch ?? '(不明)'}
        </span>
        <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, wordBreak: 'break-all' }}>
          {panel.cwd}
        </span>
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

      <Block title="上限">
        {/*
          **返ってきた窓を全部出す。** 2 つだけ取り出していたので、上流が増やした
          「今週の Fable」（100%）が落ちていた —— 一番効いている制約が見えていなかった。
          空く時刻を過ぎている窓は、前の窓の数字であると言う（`rate_limit_event` は
          ターンが走っているあいだしか来ないので、止まっていると古びる）
        */}
        {limits ? (
          limits.map((w) => (
            <Meter
              key={w.key}
              label={limitLabel(w.key)}
              value={w.utilization}
              note={
                stale(w, now)
                  ? '空いたあとの数字はまだ来ていません（前の窓のもの）'
                  : w.resetsAt
                    ? `${new Date(w.resetsAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric' })} に空きます`
                    : undefined
              }
            />
          ))
        ) : (
          <span style={{ fontSize: F.small, color: C.faint }}>まだ届いていません</span>
        )}
      </Block>

      {/* 共有フォルダは畳んでおく。実行役を使わないセッションには無関係 */}
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.line}` }}>
        <div
          onClick={() => setShowTeam((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        >
          <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, width: 8 }}>
            {showTeam ? '▾' : '▸'}
          </span>
          <span
            style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}
          >
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

function Block({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '16px 16px',
        borderBottom: `1px solid ${C.line}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <span style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>
        {title}
      </span>
      {children}
    </div>
  )
}

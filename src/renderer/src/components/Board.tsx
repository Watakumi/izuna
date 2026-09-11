import { useEffect, useState } from 'react'
import type { Panel } from '../useSessions'
import type { TeamBoard } from '../../../main/team'
import { C, ellipsis, F, MONO, R, S } from '../theme'
import { Card, Faint, Loading, Reload, Tag } from './ui'

/**
 * 共有フォルダの盤面（§16）。
 *
 * **`paths` が重なる作業を同時に走らせない。** これは申し送りに書いた norm では
 * 守れない —— 書いてある規律は、守られたかどうかを誰も見ていない。
 * ここが `pathCollisions` を通した結果を出し、人が見てから実行役を起こす。
 *
 * 壊れた札は `errors` に出す。**黙って落とさない** ——
 * 落とすと、書いた本人が「書いたのに出てこない」としか分からなくなる。
 */
export function Board({ panel }: { panel: Panel }): React.JSX.Element {
  const [board, setBoard] = useState<TeamBoard | null | undefined>(undefined)

  const load = (): void => {
    void window.izuna
      .teamBoard(panel.id)
      .then(setBoard)
      .catch(() => setBoard(null))
  }
  useEffect(load, [panel.id])

  if (board === undefined) return <Loading style={{ padding: S.lg }} />
  if (board === null) return <Faint style={{ padding: S.lg }}>共有フォルダがありません</Faint>

  // 人の判断を待っているものだけ目立たせる（`attention` の定義）
  const needsHuman = (s: string): 'plain' | 'attention' =>
    s === 'blocked' || s === 'idle' ? 'attention' : 'plain'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg, padding: S.lg }}>
      {board.collisions.length > 0 && (
        <Card tone="attention">
          <div style={{ fontSize: F.body, color: C.ink, marginBottom: S.xs }}>
            同時に走らせてはいけない組があります
          </div>
          {board.collisions.map((c, i) => (
            <div key={i} style={{ font: `${F.small}px ${MONO}`, color: C.ink2, lineHeight: 1.7 }}>
              {c.a} と {c.b}： {c.paths.join(' / ')}
            </div>
          ))}
        </Card>
      )}

      {board.errors.length > 0 && (
        <Card tone="attention">
          <div style={{ fontSize: F.body, color: C.ink, marginBottom: S.xs }}>読めなかった札</div>
          {board.errors.map((e, i) => (
            <div key={i} style={{ font: `${F.small}px ${MONO}`, color: C.ink2, lineHeight: 1.7 }}>
              {e}
            </div>
          ))}
        </Card>
      )}

      <Section label={`作業 ${board.tasks.length} 件`} action={<Reload onClick={load} />}>
        {board.tasks.length === 0 && <Faint>まだ札がありません</Faint>}
        {board.tasks.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: S.md,
              padding: '8px 12px',
              border: `1px solid ${C.line}`,
              borderRadius: R.md
            }}
          >
            <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
              {t.id}
            </span>
            <span style={{ fontSize: F.body, color: C.ink2, flexGrow: 1, ...ellipsis }}>
              {t.title}
            </span>
            <Tag tone={needsHuman(t.status)}>{t.status}</Tag>
          </div>
        ))}
      </Section>

      {board.ready.length > 0 && (
        <Section label={`いま着手できるもの ${board.ready.length} 件`}>
          {board.ready.map((t) => (
            <div
              key={t.id}
              style={{ font: `${F.small}px ${MONO}`, color: C.ink2, lineHeight: 1.7 }}
            >
              {t.id} {t.title}
            </div>
          ))}
        </Section>
      )}

      {board.summaries.length > 0 && (
        <Section label={`要約 ${board.summaries.length} 件`}>
          {board.summaries.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: S.md, alignItems: 'baseline' }}>
              <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>{s.task}</span>
              <span style={{ fontSize: F.small, color: C.ink2, flexGrow: 1, ...ellipsis }}>
                {s.by}
              </span>
              <Tag tone={s.outcome === 'done' ? 'plain' : 'attention'}>{s.outcome}</Tag>
            </div>
          ))}
        </Section>
      )}

      {board.decisions.length > 0 && (
        <Section label={`決めたこと ${board.decisions.length} 件`}>
          {board.decisions
            .slice(-5)
            .reverse()
            .map((d, i) => (
              <div
                key={i}
                style={{ fontSize: F.small, color: C.ink2, lineHeight: 1.7, ...ellipsis }}
              >
                {d.body.split('\n')[0]}
              </div>
            ))}
        </Section>
      )}

      {board.log.length > 0 && (
        <Section label={`記録 ${board.log.length} 行`}>
          {board.log
            .slice(-6)
            .reverse()
            .map((l, i) => (
              <div key={i} style={{ font: `${F.micro}px ${MONO}`, color: C.faint, ...ellipsis }}>
                {l.kind} {l.target} {l.note}
              </div>
            ))}
        </Section>
      )}
    </div>
  )
}

function Section({
  label,
  action,
  children
}: {
  label: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: F.small, color: C.dim2 }}>{label}</span>
        {action}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>{children}</div>
    </div>
  )
}

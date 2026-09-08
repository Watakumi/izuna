import type { ForgejoRun } from '../../../main/forge/client'
import { summarizeRuns, type CiLevel } from '../../../shared/ci'
import { C, F, MONO, S } from '../theme'

/**
 * sandbox の PR に付ける CI の札（GOAL.md 測り方「Izuna がその状態を読める」）。
 *
 * 読むだけ。走らせも止めもしない。**無いのと赤は別**なので、
 * 1 本も無いときは灰色で「CI 無し」と出し、赤にはしない。
 * 押すと Forgejo の実行の頁を外で開く（`shared/links.ts` が外に出す）。
 */
const DOT: Record<CiLevel, string> = {
  ok: C.teal,
  ng: C.red,
  running: C.amber,
  none: C.faint
}

export function CiBadge({ runs, ref }: { runs: ForgejoRun[] | null; ref: string | null }): React.JSX.Element {
  // 読み終わるまでは何も断定しない
  if (runs === null) {
    return <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>CI …</span>
  }
  const s = summarizeRuns(runs, ref)
  const body = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: S.xs, font: `${F.micro}px ${MONO}`, color: C.dim2 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: DOT[s.level], flexShrink: 0 }} />
      {s.label}
    </span>
  )
  return s.latest ? (
    <a href={s.latest.htmlUrl} title={`${s.latest.workflow} · ${s.latest.sha.slice(0, 7)}`} style={{ textDecoration: 'none' }}>
      {body}
    </a>
  ) : body
}

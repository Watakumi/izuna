import type { ForgejoRun } from '../main/forge/client'

/**
 * Actions の実行を「いまどうか」に畳む（純粋関数）。
 *
 * GOAL.md の測り方に「Forgejo Actions が作業ブランチの CI を回し、Izuna がその状態を
 * 読める」とある。読むのは `main/forge/client.ts` の `listRuns`、判断はここ。
 * Forgejo の `status` は自由な語（success / failure / running / waiting / blocked /
 * cancelled / skipped / unknown）なので、画面に出す前に 4 つに畳む。
 *
 * **1 本も無いことと、失敗は別。** 無いのは「回していない」であって、赤ではない。
 */
export type CiLevel = 'ok' | 'ng' | 'running' | 'none'

export interface CiSummary {
  level: CiLevel
  /** 一番新しい実行。無ければ null */
  latest: ForgejoRun | null
  /** 人に見せる短い語 */
  label: string
}

const RUNNING = new Set(['running', 'waiting', 'blocked'])
const FAILED = new Set(['failure', 'cancelled', 'unknown'])

/** `refs/heads/feat/x` と `feat/x` を同じものとして見る */
export function sameRef(a: string, b: string): boolean {
  const strip = (s: string): string => s.replace(/^refs\/heads\//, '')
  return strip(a) === strip(b)
}

/** そのブランチの実行だけを、新しい順で */
export function runsFor(runs: ForgejoRun[], ref: string | null): ForgejoRun[] {
  const mine = ref === null ? runs : runs.filter((r) => sameRef(r.ref, ref))
  return [...mine].sort((a, b) => b.id - a.id)
}

export function summarizeRuns(runs: ForgejoRun[], ref: string | null): CiSummary {
  const latest = runsFor(runs, ref)[0] ?? null
  if (!latest) return { level: 'none', latest: null, label: 'CI 無し' }
  if (RUNNING.has(latest.status)) return { level: 'running', latest, label: `CI ${latest.status}` }
  if (latest.status === 'success') return { level: 'ok', latest, label: 'CI 緑' }
  if (FAILED.has(latest.status)) return { level: 'ng', latest, label: `CI ${latest.status}` }
  // skipped など。緑でも赤でもないが、走ってはいない
  return { level: 'none', latest, label: `CI ${latest.status}` }
}

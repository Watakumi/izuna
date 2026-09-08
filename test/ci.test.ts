import { describe, expect, it } from 'vitest'
import { runsFor, sameRef, summarizeRuns } from '../src/shared/ci'
import type { ForgejoRun } from '../src/main/forge/client'

/**
 * Actions の実行を「いまどうか」に畳む（GOAL.md 測り方「Izuna がその状態を読める」）。
 * **無いのと赤は別。** 回していないブランチを赤く出すと、直す必要の無いものを直しに行く。
 */
const run = (o: Partial<ForgejoRun>): ForgejoRun => ({
  id: 1,
  title: 't',
  status: 'success',
  event: 'push',
  ref: 'refs/heads/feat/x',
  sha: 'abc1234',
  htmlUrl: 'http://x/run/1',
  workflow: 'verify.yml',
  startedAt: null,
  stoppedAt: null,
  ...o
})

describe('ref の突き合わせ', () => {
  it('refs/heads/ の有無を無視して同じブランチと見る', () => {
    expect(sameRef('refs/heads/feat/x', 'feat/x')).toBe(true)
    expect(sameRef('feat/x', 'feat/x')).toBe(true)
    expect(sameRef('refs/heads/feat/x', 'feat/y')).toBe(false)
  })

  it('そのブランチの分だけを新しい順に並べる。null なら全部', () => {
    const runs = [run({ id: 1 }), run({ id: 3, ref: 'refs/heads/main' }), run({ id: 2 })]
    expect(runsFor(runs, 'feat/x').map((r) => r.id)).toEqual([2, 1])
    expect(runsFor(runs, null).map((r) => r.id)).toEqual([3, 2, 1])
  })
})

describe('畳み', () => {
  it('1 本も無ければ「CI 無し」で、赤ではない', () => {
    expect(summarizeRuns([], 'feat/x')).toEqual({ level: 'none', latest: null, label: 'CI 無し' })
  })

  it('一番新しいものだけを見る（古い失敗は数えない）', () => {
    const s = summarizeRuns(
      [run({ id: 1, status: 'failure' }), run({ id: 2, status: 'success' })],
      'feat/x'
    )
    expect(s.level).toBe('ok')
    expect(s.latest?.id).toBe(2)
    expect(s.label).toBe('CI 緑')
  })

  it.each(['running', 'waiting', 'blocked'])('%s は走っている', (status) => {
    expect(summarizeRuns([run({ status })], 'feat/x').level).toBe('running')
  })

  it.each(['failure', 'cancelled', 'unknown'])('%s は赤', (status) => {
    const s = summarizeRuns([run({ status })], 'feat/x')
    expect(s.level).toBe('ng')
    expect(s.label).toBe(`CI ${status}`)
  })

  it('skipped は走っていないが赤でもない', () => {
    expect(summarizeRuns([run({ status: 'skipped' })], 'feat/x').level).toBe('none')
  })

  it('別のブランチの実行は見ない', () => {
    expect(
      summarizeRuns([run({ ref: 'refs/heads/main', status: 'failure' })], 'feat/x').level
    ).toBe('none')
  })
})

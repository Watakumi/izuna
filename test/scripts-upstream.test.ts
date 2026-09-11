import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- 型の無い .mjs
// @ts-ignore
import {
  changelogBetween,
  compareVersions,
  latestCli,
  latestRelease
} from '../scripts/upstream.mjs'

/** 追っているものの最新を読む道具（pnpm run upstream）。網を使う部分は呼ばず、畳む関数だけ見る */
describe('pnpm run upstream', () => {
  it('版を数で比べる', () => {
    expect(compareVersions('2.1.268', '2.1.266')).toBeGreaterThan(0)
    expect(compareVersions('16.0.4', '16.0.10')).toBeLessThan(0)
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
  })

  it('CHANGELOG から、測った版の次から最新までの節を新しい順で切り出す', () => {
    const md = [
      '# Changelog',
      '## 2.1.268',
      '- a',
      '- b',
      '## 2.1.267',
      '- c',
      '## 2.1.266',
      '- old',
      '## 2.1.265',
      '- older'
    ].join('\n')
    const got = changelogBetween(md, '2.1.266', '2.1.268')
    expect(got.map((c: { version: string }) => c.version)).toEqual(['2.1.268', '2.1.267'])
    expect(got[0].body).toBe('- a\n- b')
    expect(changelogBetween(md, '2.1.268', '2.1.268')).toEqual([])
  })

  it('Forgejo の releases から prerelease を除いた最新と、同じ系列の最新', () => {
    const rel = [
      { tag_name: 'v17.0.0-rc1', prerelease: true, draft: false },
      { tag_name: 'v16.0.4', prerelease: false, draft: false },
      { tag_name: 'v15.0.8', prerelease: false, draft: false },
      { tag_name: 'v16.0.3', prerelease: false, draft: false }
    ]
    expect(latestRelease(rel)).toBe('16.0.4')
    expect(latestRelease(rel, '15')).toBe('15.0.8')
    expect(latestRelease([], '16')).toBeNull()
  })

  it('SDK 0.3.N の一覧から最新の CLI の版と公開時刻', () => {
    const got = latestCli(['0.3.266', '0.3.268', '0.3.267', '1.0.0-beta'], {
      '0.3.268': '2026-09-10T18:43:00.000Z'
    })
    expect(got).toEqual({ sdk: '0.3.268', cli: '2.1.268', publishedAt: '2026-09-10T18:43:00.000Z' })
    expect(latestCli([], {})).toBeNull()
  })
})

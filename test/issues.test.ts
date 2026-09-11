import { describe, expect, it } from 'vitest'
import { issuePrompt, mergeIssues, sameIssue } from '../src/shared/issues'

const gh = (
  n: number
): {
  number: number
  title: string
  url: string
  state: string
  labels: string[]
  updatedAt: string
} => ({
  number: n,
  title: `g${n}`,
  url: `https://github.com/o/r/issues/${n}`,
  state: 'open',
  labels: [],
  updatedAt: ''
})
const fj = (
  n: number
): {
  number: number
  title: string
  url: string
  state: string
  labels: string[]
  updatedAt: string
} => ({
  number: n,
  title: `f${n}`,
  url: `http://localhost:4649/o/r/issues/${n}`,
  state: 'open',
  labels: [],
  updatedAt: ''
})

/** Issue の出どころを揃える。GitHub を使わない人の入口 */
describe('mergeIssues', () => {
  it('両方無ければ null、片方だけなら片方、両方なら GitHub を先に、並びは返った順', () => {
    expect(mergeIssues(null, null)).toBeNull()
    expect(mergeIssues(null, [fj(1)])?.map((i) => i.source)).toEqual(['forgejo'])
    expect(mergeIssues([gh(1), gh(3)], [fj(2)])?.map((i) => `${i.source}:${i.number}`)).toEqual([
      'github:1',
      'github:3',
      'forgejo:2'
    ])
  })

  it('依頼文は出どころを言い、同じ番号でも出どころが違えば別物', () => {
    const [g, f] = mergeIssues([gh(2)], [fj(2)])!
    expect(issuePrompt(f)).toBe(
      'Forgejo の Issue #2「f2」に取り組んでください。\nhttp://localhost:4649/o/r/issues/2'
    )
    expect(issuePrompt(g)).toContain('GitHub の Issue #2')
    expect(sameIssue(g, f)).toBe(false)
    expect(sameIssue(g, g)).toBe(true)
    expect(sameIssue(null, g)).toBe(false)
  })
})

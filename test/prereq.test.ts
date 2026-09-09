import { describe, expect, it } from 'vitest'
import { diagnoseClaude, readyForClaude, type ClaudeFacts } from '../src/shared/prereq'

/** Claude Code の関所（docs/SETUP.md）。無ければ何も始まらないので、準備の先頭で見る */
const facts = (o: Partial<ClaudeFacts>): ClaudeFacts => ({
  path: '/Users/me/.local/bin/claude',
  version: '2.1.263',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscription: 'max',
  ...o
})

describe('Claude Code の関所', () => {
  it('入っていてログイン済みなら両方 ok。プランと方法を出す', () => {
    const checks = diagnoseClaude(facts({}))
    expect(checks.map((c) => [c.id, c.level])).toEqual([
      ['claude', 'ok'],
      ['claudeLogin', 'ok']
    ])
    expect(checks[1].detail).toBe('claude.ai · max')
    expect(readyForClaude(checks)).toBe(true)
  })

  it('無ければ入れ方を言い、ログインの行は出さない', () => {
    const checks = diagnoseClaude(facts({ path: null, version: null, loggedIn: null }))
    expect(checks).toHaveLength(1)
    expect(checks[0].level).toBe('ng')
    expect(checks[0].detail).toContain('install.sh')
    expect(checks[0].detail).toContain('claudePath')
    expect(readyForClaude(checks)).toBe(false)
  })

  it('ログインしていなければ claude auth login を言う。API キーは使わない', () => {
    const checks = diagnoseClaude(facts({ loggedIn: false }))
    expect(checks[1]).toMatchObject({ id: 'claudeLogin', level: 'ng' })
    expect(checks[1].detail).toContain('claude auth login')
    expect(readyForClaude(checks)).toBe(false)
  })

  it('聞けなければ unknown。「していない」とは言わない', () => {
    const checks = diagnoseClaude(facts({ loggedIn: null }))
    expect(checks[1].level).toBe('unknown')
    expect(readyForClaude(checks)).toBe(false)
  })
})

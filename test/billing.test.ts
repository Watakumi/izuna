import { describe, expect, it } from 'vitest'
import { BILLING_KEYS, withoutBillingKeys } from '../src/shared/billing'

/** 課金の経路を黙って変えない（§14、docs/NIMBALYST.md §3） */
describe('鍵を落とす', () => {
  it('ANTHROPIC の鍵を落とし、落としたものを言う', () => {
    const r = withoutBillingKeys({ PATH: '/x', ANTHROPIC_API_KEY: 'sk-ant-1', ANTHROPIC_AUTH_TOKEN: 't', HOME: '/h' })
    expect(r.env).toEqual({ PATH: '/x', HOME: '/h' })
    expect(r.removed).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
  })

  it('空の鍵は「落とした」と数えない', () => {
    expect(withoutBillingKeys({ ANTHROPIC_API_KEY: '' }).removed).toEqual([])
  })

  it('他の変数には触らない', () => {
    const env = { PATH: '/x', GITHUB_TOKEN: 'ghp_x' }
    expect(withoutBillingKeys(env).env).toEqual(env)
  })

  it('落とす鍵は 2 つだけ（増やすときはここを変える）', () => {
    expect([...BILLING_KEYS]).toEqual(['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
  })
})

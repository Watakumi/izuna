import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 開く前の関所（§26）。信頼していない場所の hook で止まること。
 */
let repo: string
let config: { settingSources: string[]; trustedRepos: string[] }

vi.mock('../src/main/config', () => ({
  CONFIG_PATH: '/h/.izuna/config.json',
  resolved: async () => config
}))

const load = async (): Promise<typeof import('../src/main/claude/trust')> => import('../src/main/claude/trust')

const hooks = (file: string, body: unknown): void => {
  mkdirSync(join(repo, '.claude'), { recursive: true })
  writeFileSync(join(repo, '.claude', file), typeof body === 'string' ? body : JSON.stringify(body))
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'izuna-trust-'))
  config = { settingSources: ['project', 'local'], trustedRepos: [] }
  vi.resetModules()
})
afterEach(() => rmSync(repo, { recursive: true, force: true }))

describe('リポジトリの hook', () => {
  it('hook が無ければ何も聞かず、読む出どころをそのまま返す', async () => {
    const { gateProjectHooks } = await load()
    expect(await gateProjectHooks(repo)).toEqual(['project', 'local'])
  })

  it('**信頼していない場所に hook があれば止まる**', async () => {
    hooks('settings.json', { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'id' }] }] } })
    const { gateProjectHooks } = await load()
    await expect(gateProjectHooks(repo)).rejects.toThrow(/SessionStart/)
  })

  it('settings.local.json も同じ（リポジトリに入っていることがある）', async () => {
    hooks('settings.local.json', { hooks: { PreToolUse: [{}] } })
    const { gateProjectHooks } = await load()
    await expect(gateProjectHooks(repo)).rejects.toThrow(/settings\.local\.json/)
  })

  it('読まない出どころのファイルは見ない', async () => {
    config.settingSources = ['project']
    hooks('settings.local.json', { hooks: { PreToolUse: [{}] } })
    const { gateProjectHooks } = await load()
    expect(await gateProjectHooks(repo)).toEqual(['project'])
  })

  it('信頼した場所なら hook があっても通る', async () => {
    config.trustedRepos = [repo]
    hooks('settings.json', { hooks: { SessionStart: [{}] } })
    const { gateProjectHooks } = await load()
    expect(await gateProjectHooks(repo)).toEqual(['project', 'local'])
  })

  it('壊れた JSON でも止まる', async () => {
    hooks('settings.json', '{ broken')
    const { findProjectHooks } = await load()
    expect(await findProjectHooks(repo, ['project'])).toEqual([
      { file: '.claude/settings.json', events: ['(読めません)'] }
    ])
  })
})

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * ホーム配下にものを置く層（共有フォルダと設定）。
 *
 * **`HOME` を差し替えて閉じた環境で測る。** 実環境の `~/.izuna` を読むと、
 * 検査が「この機械に何が置いてあるか」に左右される。
 */

let home: string
let realHome: string | undefined

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-h-'))
  realHome = process.env.HOME
  process.env.HOME = home
  // **読み込み時に homedir() を固定する**ので、差し替えるたびに読み直させる
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

describe('設定', () => {
  it('無ければ既定で動く（用意しないと使えないものにしない）', async () => {
    const { loadConfig } = await import('../src/main/config')
    const r = await loadConfig()
    expect(r.ignored).toEqual([])
    expect(r.config.repoDepth).toBeGreaterThan(0)
  })

  it('書いた値が効く', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(join(home, '.izuna', 'config.json'),
      JSON.stringify({ sandboxRemote: 'sandbox', repoDepth: 2 }))
    const { loadConfig } = await import('../src/main/config')
    const { config } = await loadConfig()
    expect(config.sandboxRemote).toBe('sandbox')
    expect(config.repoDepth).toBe(2)
  })

  it('**壊れた値で起動不能にしない。** 既定に倒して、落としたものを名指しする', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(join(home, '.izuna', 'config.json'),
      JSON.stringify({ repoDepth: 'ふかい', sandboxRemote: 42 }))
    const { loadConfig } = await import('../src/main/config')
    const r = await loadConfig()
    expect(r.ignored).toContain('repoDepth')
    expect(r.ignored).toContain('sandboxRemote')
    expect(r.config.repoDepth).toBe(3)
  })

  it('壊れた JSON でも落ちない', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(join(home, '.izuna', 'config.json'), '{ここが壊れている')
    const { loadConfig } = await import('../src/main/config')
    await expect(loadConfig()).resolves.toBeTruthy()
  })

  it('~ を家に開く', async () => {
    const { expandHome } = await import('../src/main/config')
    expect(expandHome('~/work')).toBe(join(home, 'work'))
    expect(expandHome('/absolute')).toBe('/absolute')
  })
})

describe('共有フォルダ', () => {
  it('名前から置き場所を決める。**worktree の中に置かない**', async () => {
    const { teamPathFor } = await import('../src/main/team')
    expect(teamPathFor('feat/パレット')).toContain(join('.izuna', 'teams'))
    expect(teamPathFor('feat/パレット')).not.toContain('worktree')
  })

  it('雛形を書き出す。二度目は壊さない', async () => {
    const { ensureTeam } = await import('../src/main/team')
    const dir = await ensureTeam('t', '# 狙い\n通しで確かめる\n')
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain('通しで確かめる')

    writeFileSync(join(dir, 'brief.md'), '人が直した')
    await ensureTeam('t', '# 別の狙い')
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toBe('人が直した')
  })

  it('渡す指示に、置き場所と 1 ファイル 1 書き手の規律が入る', async () => {
    const { teamInstructions } = await import('../src/main/team')
    const text = teamInstructions('/x/teams/t')
    expect(text).toContain('/x/teams/t')
    expect(text).toMatch(/summaries|tasks/)
  })
})

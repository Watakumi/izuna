import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `~/.izuna/config.json` の読み書き（§37 でテーマを選ぶために書く側を足した）。
 *
 * **人が手で書いた設定を壊さない**ところが要点なので、そこを重点的に見る。
 */

let home: string
let realHome: string | undefined

const load = async (): Promise<typeof import('../src/main/config')> => {
  vi.resetModules()
  return import('../src/main/config')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-cfg-'))
  realHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

const read = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(home, '.izuna', 'config.json'), 'utf8')) as Record<string, unknown>

describe('設定を書く', () => {
  it('無ければ作る。**既定は書き出さない**（あとで既定が変わったときに古い値が残る）', async () => {
    const { saveConfigValue } = await load()
    await saveConfigValue('theme', { kind: 'builtin' })
    expect(read()).toEqual({ theme: { kind: 'builtin' } })
  })

  it('人が書いたものを消さない。鍵 1 つだけ重ねる', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(
      join(home, '.izuna', 'config.json'),
      JSON.stringify({ forgejoUrl: 'http://localhost:4649', repoDepth: 5 })
    )
    const { saveConfigValue } = await load()
    await saveConfigValue('theme', { kind: 'named', name: 'nord' })
    expect(read()).toEqual({
      forgejoUrl: 'http://localhost:4649',
      repoDepth: 5,
      theme: { kind: 'named', name: 'nord' }
    })
  })

  it('**壊れた設定は上書きしない。** 黙って捨てるのが一番害が大きい', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(join(home, '.izuna', 'config.json'), '{ これは JSON ではない')
    const { saveConfigValue } = await load()
    await expect(saveConfigValue('theme', { kind: 'builtin' })).rejects.toThrow()
    expect(readFileSync(join(home, '.izuna', 'config.json'), 'utf8')).toContain('これは')
  })

  it('配列やヌルも「設定ではない」として断る', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    writeFileSync(join(home, '.izuna', 'config.json'), '[1,2]')
    const { saveConfigValue } = await load()
    await expect(saveConfigValue('theme', { kind: 'builtin' })).rejects.toThrow(/読めません/)
  })

  it('書いたら読み直す（控えを捨てる）', async () => {
    const { loadConfig, saveConfigValue } = await load()
    expect((await loadConfig()).config.theme).toEqual({ kind: 'ghostty' })
    await saveConfigValue('theme', { kind: 'builtin' })
    expect((await loadConfig()).config.theme).toEqual({ kind: 'builtin' })
  })

  it('書けない場所なら、そう言って落ちる（黙って成功しない）', async () => {
    mkdirSync(join(home, '.izuna'), { recursive: true })
    chmodSync(join(home, '.izuna'), 0o500)
    const { saveConfigValue } = await load()
    await expect(saveConfigValue('theme', { kind: 'builtin' })).rejects.toThrow()
    chmodSync(join(home, '.izuna'), 0o700)
  })
})

describe('~ を開く', () => {
  it('先頭の `~/` だけを直す', async () => {
    const { expandHome } = await load()
    expect(expandHome('~/work')).toBe(join(home, 'work'))
    expect(expandHome('/abs/~/x')).toBe('/abs/~/x')
  })
})

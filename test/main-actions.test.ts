import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 外に出た操作の記録（§38）の読み書き。
 *
 * **記録のために振る舞いを変えない**ところが要点。push が通ったのに
 * 「push が失敗した」と見えるのが一番悪い。
 */

let home: string
let realHome: string | undefined

const load = async (): Promise<typeof import('../src/main/actions')> => {
  vi.resetModules()
  return import('../src/main/actions')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-act-'))
  realHome = process.env.HOME
  process.env.HOME = home
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('包む', () => {
  it('通れば ok で 1 行足し、返りはそのまま', async () => {
    const { noting, readActions } = await load()
    const got = await noting(
      'push',
      'forgejo/feat',
      async () => 'done',
      (v) => `${v}!`
    )
    expect(got).toBe('done')
    expect(await readActions()).toEqual([
      expect.objectContaining({ kind: 'push', target: 'forgejo/feat', ok: true, note: 'done!' })
    ])
  })

  it('**失敗は残して、そのまま投げ直す**', async () => {
    const { noting, readActions } = await load()
    await expect(
      noting('delete-branch', 'forgejo/x', async () => {
        throw new Error('remote が無い')
      })
    ).rejects.toThrow('remote が無い')
    expect(await readActions()).toEqual([
      expect.objectContaining({ kind: 'delete-branch', ok: false, note: 'remote が無い' })
    ])
  })

  it('**記録が書けなくても、元の操作は成功のまま**', async () => {
    const { noting } = await load()
    // `~/.izuna` をファイルにして、書けない状態を作る
    writeFileSync(join(home, '.izuna'), 'これはディレクトリではない')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(noting('push', 'x', async () => 'ok')).resolves.toBe('ok')
    expect(spy).toHaveBeenCalled()
  })
})

describe('読む', () => {
  it('無ければ空（まだ何もしていないだけ）', async () => {
    const { readActions } = await load()
    expect(await readActions()).toEqual([])
  })

  it('新しいものから 20 件まで', async () => {
    const { appendAction, readActions } = await load()
    for (let i = 0; i < 25; i++)
      await appendAction({
        at: new Date(Date.UTC(2026, 8, 14, 0, i)).toISOString(),
        kind: 'allow',
        target: `T${i}`,
        ok: true,
        note: ''
      })
    const got = await readActions()
    expect(got).toHaveLength(20)
    expect(got[0].target).toBe('T24')
  })

  it('ENOENT 以外の失敗は握らない（読めないことを空と言わない）', async () => {
    const { ACTIONS_PATH, readActions } = await load()
    mkdirSync(ACTIONS_PATH, { recursive: true })
    await expect(readActions()).rejects.toThrow()
  })

  it('人が手で足した行も読める。壊れた行は飛ばす', async () => {
    const { ACTIONS_PATH, appendAction, readActions } = await load()
    await appendAction({
      at: '2026-09-14T00:00:00.000Z',
      kind: 'push',
      target: 'a',
      ok: true,
      note: ''
    })
    writeFileSync(ACTIONS_PATH, `${readFileSync(ACTIONS_PATH, 'utf8')}こわれた行\n`)
    expect(await readActions()).toHaveLength(1)
  })
})

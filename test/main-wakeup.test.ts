import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Wakeup } from '../src/shared/wakeup'

/**
 * 予約の保存とタイマー。**再起動を跨いで残ること**が要点。
 */

let home: string
let realHome: string | undefined

const load = async (): Promise<typeof import('../src/main/wakeup')> => import('../src/main/wakeup')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'izuna-w-'))
  realHome = process.env.HOME
  process.env.HOME = home
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  rmSync(home, { recursive: true, force: true })
})

/** 条件が満たされるまで待つ。固定の sleep は負荷で伸びたときに落ちる */
const until = async (ok: () => Promise<boolean>, ms = 3000): Promise<void> => {
  const end = Date.now() + ms
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`until: ${ms}ms 待っても満たされない`)
    await new Promise((r) => setTimeout(r, 50))
  }
}

const seed = (list: Partial<Wakeup>[]): void => {
  mkdirSync(join(home, '.izuna'), { recursive: true })
  writeFileSync(
    join(home, '.izuna', 'wakeups.json'),
    JSON.stringify(
      list.map((o) => ({
        id: 'a',
        sessionId: 's',
        cwd: '/w',
        prompt: 'p',
        fireAt: Date.now() + 60_000,
        state: 'pending',
        createdAt: 0,
        ...o
      }))
    )
  )
}

describe('保存', () => {
  it('無くても起動する', async () => {
    const { Wakeups } = await load()
    expect(await new Wakeups().start()).toEqual([])
  })

  it('足したものが残る（再起動を跨ぐ）', async () => {
    const { Wakeups, WAKEUPS_PATH } = await load()
    const w = new Wakeups()
    await w.add({ sessionId: 's1', cwd: '/w', prompt: '続きを', fireAt: Date.now() + 3600_000 })
    w.stop()
    expect(readFileSync(WAKEUPS_PATH, 'utf8')).toContain('続きを')
    expect(await new Wakeups().list()).toHaveLength(1)
  })

  it('消せる', async () => {
    const { Wakeups } = await load()
    const w = new Wakeups()
    const added = await w.add({
      sessionId: 's',
      cwd: '/w',
      prompt: 'p',
      fireAt: Date.now() + 3600_000
    })
    await w.remove(added.id)
    w.stop()
    expect(await w.list()).toEqual([])
  })
})

describe('起動時', () => {
  it('**閉じているあいだに過ぎたものを、勝手に走らせない**', async () => {
    seed([{ id: 'old', fireAt: Date.now() - 60_000 }])
    const { Wakeups } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    const list = await w.start()
    w.stop()
    expect(list[0].state).toBe('overdue')
    expect(fired).toEqual([])
  })

  it('過ぎたものを、人が改めて起こせる', async () => {
    seed([{ id: 'old', fireAt: Date.now() - 60_000 }])
    const { Wakeups } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    await w.start()
    await w.fireNow('old')
    w.stop()
    expect(fired).toEqual(['old'])
    expect((await w.list())[0].state).toBe('fired')
  })

  it('いない id を起こそうとしても落ちない', async () => {
    const { Wakeups } = await load()
    const w = new Wakeups()
    expect(await w.fireNow('いない')).toBeNull()
    w.stop()
  })
})

describe('時が来たら', () => {
  it('起こして、状態を fired にする', async () => {
    const { Wakeups } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    await w.start()
    await w.add({ sessionId: 's', cwd: '/w', prompt: 'p', fireAt: Date.now() + 300 })
    await new Promise((r) => setTimeout(r, 900))
    w.stop()
    expect(fired).toHaveLength(1)
    expect((await w.list())[0].state).toBe('fired')
  })

  it('**二重に起こさない**（タイマーは 1 本だけ）', async () => {
    const { Wakeups } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    await w.add({ sessionId: 's', cwd: '/w', prompt: 'p', fireAt: Date.now() + 300 })
    await w.add({ sessionId: 's2', cwd: '/w', prompt: 'p2', fireAt: Date.now() + 350 })
    await new Promise((r) => setTimeout(r, 1200))
    w.stop()
    expect(fired).toHaveLength(2)
    expect(new Set(fired).size).toBe(2)
  })
})

describe('覚えの無い予約', () => {
  /**
   * `wakeups.json` は同じユーザなら誰でも書ける。エージェント自身が
   * 自分の起床を書き足せば、人が知らない指示が届く（§26）。
   */
  it('**走っている最中にファイルへ足されたものは起こさない**', async () => {
    const { Wakeups, WAKEUPS_PATH } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    await w.start()
    // 期限を同じにする。ずらすと planted は次の tick（最短 250ms 後）まで
    // 裁かれず、負荷が高いと固定の待ちに収まらない（2026-09-09 に pre-push で 1 度落ちた）
    const at = Date.now() + 300
    await w.add({ sessionId: 's', cwd: '/w', prompt: '本物', fireAt: at })
    // 別のプロセスが書き足した、という状況
    const all = JSON.parse(readFileSync(WAKEUPS_PATH, 'utf8')) as Wakeup[]
    all.push({
      id: 'planted',
      sessionId: 's',
      cwd: '/w',
      prompt: '勝手に続けて',
      fireAt: at,
      state: 'pending',
      createdAt: Date.now()
    })
    writeFileSync(WAKEUPS_PATH, JSON.stringify(all))
    await until(async () => (await w.list()).every((x) => x.state !== 'pending'))
    w.stop()
    expect(fired).toHaveLength(1)
    expect(fired[0]).not.toBe('planted')
    const states = Object.fromEntries((await w.list()).map((x) => [x.id, x.state]))
    expect(states.planted).toBe('rejected')
  })

  it('起動時に読んだものは起こす（一覧に出て人の目に触れる）', async () => {
    seed([{ id: 'seen', fireAt: Date.now() + 300 }])
    const { Wakeups } = await load()
    const w = new Wakeups()
    const fired: string[] = []
    w.onFire((x) => fired.push(x.id))
    await w.start()
    await new Promise((r) => setTimeout(r, 900))
    w.stop()
    expect(fired).toEqual(['seen'])
  })
})

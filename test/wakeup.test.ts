import { describe, expect, it } from 'vitest'
import { due, next, parseWakeups, reconcile, until, type Wakeup } from '../src/shared/wakeup'

const w = (over: Partial<Wakeup> = {}): Wakeup => ({
  id: 'a', sessionId: 's', cwd: '/w', prompt: '続きを',
  fireAt: 1_000, state: 'pending', createdAt: 0, ...over
})

describe('過ぎたものの扱い', () => {
  it('**自動で発火させない。** 過ぎていたら overdue にして見せる', () => {
    expect(reconcile([w({ fireAt: 500 })], 1_000)[0].state).toBe('overdue')
  })

  it('まだのものは触らない', () => {
    expect(reconcile([w({ fireAt: 2_000 })], 1_000)[0].state).toBe('pending')
  })

  it('一度起こしたものを蒸し返さない', () => {
    expect(reconcile([w({ fireAt: 500, state: 'fired' })], 1_000)[0].state).toBe('fired')
  })
})

describe('次に起こすもの', () => {
  it('いちばん近いもの', () => {
    const list = [w({ id: 'b', fireAt: 3_000 }), w({ id: 'a', fireAt: 2_000 })]
    expect(next(list, 1_000)?.id).toBe('a')
  })

  it('**同着は先に作ったほう**（呼ぶたびに順が変わらない）', () => {
    const list = [w({ id: 'b', fireAt: 2_000, createdAt: 5 }), w({ id: 'a', fireAt: 2_000, createdAt: 1 })]
    expect(next(list, 1_000)?.id).toBe('a')
  })

  it('過ぎたものは next に出さない（起こす対象ではない）', () => {
    expect(next([w({ fireAt: 500 })], 1_000)).toBeNull()
  })

  it('時が来たものは due に出る', () => {
    expect(due([w({ fireAt: 1_000 })], 1_000)).toHaveLength(1)
    expect(due([w({ fireAt: 1_001 })], 1_000)).toHaveLength(0)
  })
})

describe('記録の読み取り', () => {
  it('壊れていても起動不能にしない', () => {
    expect(parseWakeups('{壊れている')).toEqual([])
    expect(parseWakeups('"配列ではない"')).toEqual([])
  })

  it('形の違うものは黙って捨てる', () => {
    expect(parseWakeups(JSON.stringify([{ id: 'x' }, w()]))).toHaveLength(1)
  })

  it('知らない状態は受け付けない', () => {
    expect(parseWakeups(JSON.stringify([w({ state: 'へんな状態' as never })]))).toEqual([])
  })
})

describe('人に見せる待ち時間', () => {
  it('単位を切り替える', () => {
    expect(until(1_000 + 30 * 60_000, 1_000)).toBe('30分後')
    expect(until(1_000 + 3 * 3600_000, 1_000)).toBe('3時間後')
    expect(until(1_000 + 2 * 86400_000, 1_000)).toBe('2日後')
  })

  it('過ぎていたら「まもなく」（負の数を見せない）', () => {
    expect(until(0, 1_000)).toBe('まもなく')
  })
})

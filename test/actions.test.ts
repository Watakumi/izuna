import { describe, expect, it } from 'vitest'
import {
  ACTION_KINDS,
  ACTION_LABEL,
  formatAction,
  parseAction,
  parseActions,
  type Action
} from '../src/shared/actions'

/**
 * 外に出た操作の記録（§38）。**1 件 1 行が全部の前提**なので、そこを重点的に見る。
 */

const a = (over: Partial<Action> = {}): Action => ({
  at: '2026-09-14T08:30:00.000Z',
  kind: 'push',
  target: 'forgejo/feat-x',
  ok: true,
  note: '',
  ...over
})

describe('1 行にする', () => {
  it('書いて読み戻せる', () => {
    const one = a({ note: '3 コミット' })
    expect(parseAction(formatAction(one))).toEqual(one)
  })

  it('**行を壊させない。** 区切りと改行は潰す', () => {
    const line = formatAction(a({ target: 'a\tb\nc', note: '壊れた\n2 行目' }))
    expect(line.split('\n')).toHaveLength(1)
    expect(parseAction(line)).toMatchObject({ target: 'a b c', note: '壊れた 2 行目' })
  })

  it('失敗も残す（失敗したことこそ後から知りたい）', () => {
    const ng = a({ ok: false, note: 'remote が無い' })
    expect(formatAction(ng)).toContain('\tng\t')
    expect(parseAction(formatAction(ng))?.ok).toBe(false)
  })

  it('読めない行は null。**捨てるが落ちない**（人が手で触るファイル）', () => {
    for (const bad of [
      '',
      'めちゃくちゃ',
      '2026-09-14\tいない種類\tx\tok',
      '2026-09-14\tpush\tx\tmaybe',
      '\tpush\tx\tok'
    ])
      expect(parseAction(bad), bad).toBeNull()
  })

  it('全部の種類に画面の言葉がある', () => {
    for (const k of ACTION_KINDS) expect(ACTION_LABEL[k]).toBeTruthy()
  })
})

describe('新しいものから読む', () => {
  const text = [
    formatAction(a({ at: '2026-09-14T01:00:00.000Z', target: '1 番目' })),
    'これは読めない行',
    formatAction(a({ at: '2026-09-14T02:00:00.000Z', target: '2 番目' })),
    formatAction(a({ at: '2026-09-14T03:00:00.000Z', target: '3 番目' })),
    ''
  ].join('\n')

  it('末尾から、読めない行を飛ばして返す', () => {
    expect(parseActions(text).map((x) => x.target)).toEqual(['3 番目', '2 番目', '1 番目'])
  })

  it('上限で止まる', () => {
    expect(parseActions(text, 2).map((x) => x.target)).toEqual(['3 番目', '2 番目'])
  })

  it('空なら空', () => {
    expect(parseActions('')).toEqual([])
  })
})

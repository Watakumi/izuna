import { describe, expect, it } from 'vitest'
import { canReview, reviewPrompt, type ReviewContext } from '../src/shared/review'

/**
 * レビュー依頼の文面に対する門。
 *
 * **差分の中身を本文に入れない**ことを見る ——
 * 入れると大きな差分で窓が本文に埋まり、読む余地が無くなる。
 */

const ctx = (over: Partial<ReviewContext> = {}): ReviewContext =>
  ({ head: 'feat/a', base: 'main', pull: null, ...over })

describe('頼めるかどうか', () => {
  it('比べる先が揃っていれば頼める', () => {
    expect(canReview(ctx())).toBe(true)
  })

  it('**何と比べるか決まらなければ頼まない**', () => {
    expect(canReview(ctx({ base: null }))).toBe(false)
    expect(canReview(ctx({ head: null }))).toBe(false)
    expect(canReview(ctx({ base: '' }))).toBe(false)
  })
})

describe('文面', () => {
  it('比べる範囲を書く', () => {
    expect(reviewPrompt(ctx())).toContain('main...feat/a')
  })

  it('PR の番号があれば出す', () => {
    expect(reviewPrompt(ctx({ pull: 12 }))).toContain('#12')
  })

  it('番号が無ければ PR と書かない', () => {
    expect(reviewPrompt(ctx())).not.toContain('PR #')
  })

  it('**直さないことを明示する**（レビューは判断を人に返す）', () => {
    expect(reviewPrompt(ctx())).toContain('直さない')
  })

  it('場所の書き方を指定する', () => {
    expect(reviewPrompt(ctx())).toContain('ファイル:行')
  })

  it('埋め草を禁じる', () => {
    expect(reviewPrompt(ctx())).toContain('埋め草')
  })

  it('差分の中身は入れない（範囲だけ渡す）', () => {
    const p = reviewPrompt(ctx())
    expect(p).not.toContain('@@')
    expect(p.length).toBeLessThan(1200)
  })
})

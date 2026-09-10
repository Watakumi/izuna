import { describe, expect, it } from 'vitest'
import {
  decide,
  EMPTY_PROGRESS,
  iterationPrompt,
  MAX_LEARNINGS,
  parseProgress,
  trimLearnings,
  type Learning,
  type Progress
} from '../src/shared/loop'

/**
 * 自律ループの判断。**ここが間違うと、止まらないか、早く止まりすぎる。**
 */

const p = (over: Partial<Progress> = {}): Progress => ({ ...EMPTY_PROGRESS, ...over })

describe('進捗の読み取り', () => {
  it('普通に読む', () => {
    const r = parseProgress(
      JSON.stringify({
        currentIteration: 3,
        phase: 'building',
        status: 'running',
        completionSignal: false,
        learnings: [{ iteration: 1, summary: 'やった', filesChanged: ['a.ts'] }],
        blockers: []
      })
    )
    expect(r).toMatchObject({ currentIteration: 3, phase: 'building' })
    expect(r.learnings).toHaveLength(1)
  })

  it('**壊れていても止まらない。** 既定に倒す', () => {
    expect(parseProgress('{途中で切れて')).toEqual(EMPTY_PROGRESS)
    expect(parseProgress('null')).toEqual(EMPTY_PROGRESS)
    expect(parseProgress('')).toEqual(EMPTY_PROGRESS)
  })

  it('知らない値は既定に倒す（勝手に完了扱いしない）', () => {
    const r = parseProgress(
      JSON.stringify({ phase: 'なにこれ', status: 'ふしぎ', completionSignal: 'true' })
    )
    expect(r.phase).toBe('planning')
    expect(r.status).toBe('running')
    // **文字列の "true" を真と読まない。** 誤って完了にすると黙って止まる
    expect(r.completionSignal).toBe(false)
  })

  it('形の違う learnings は捨てる', () => {
    const r = parseProgress(
      JSON.stringify({ learnings: ['ただの文字列', { summary: 'ok', iteration: 1 }] })
    )
    expect(r.learnings).toHaveLength(1)
  })

  it('人からの指示は残す', () => {
    expect(parseProgress(JSON.stringify({ userFeedback: 'ここを直して' })).userFeedback).toBe(
      'ここを直して'
    )
  })
})

describe('続けるか、やめるか', () => {
  it('宣言されたら終わる', () => {
    expect(decide(p({ completionSignal: true }), 20)).toMatchObject({ reason: 'completed' })
  })

  it('詰まったら止まり、理由を残す', () => {
    expect(decide(p({ status: 'blocked', blockers: ['鍵が無い'] }), 20)).toMatchObject({
      reason: 'blocked',
      detail: '鍵が無い'
    })
  })

  it('理由が書かれていなくても、そう言う（黙らない）', () => {
    expect(decide(p({ status: 'blocked' }), 20)?.detail).toContain('理由は書かれていません')
  })

  it('上限で打ち切る', () => {
    expect(decide(p({ currentIteration: 20 }), 20)).toMatchObject({ reason: 'maxIterations' })
  })

  it('**最後の反復で終わったら「完了」。**「上限で打ち切り」にしない', () => {
    expect(decide(p({ currentIteration: 20, completionSignal: true }), 20)).toMatchObject({
      reason: 'completed'
    })
  })

  it('まだなら続ける', () => {
    expect(decide(p({ currentIteration: 5 }), 20)).toBeNull()
  })
})

describe('引き継ぐ量', () => {
  const many: Learning[] = Array.from({ length: 30 }, (_, i) => ({
    iteration: i + 1,
    summary: `${i + 1} 回目`,
    filesChanged: []
  }))

  it('増え続けさせない（プロンプトが膨らんで文脈を食う）', () => {
    expect(trimLearnings(many)).toHaveLength(MAX_LEARNINGS)
  })

  it('**古いほうを捨てる**（直近のほうが次の一手に効く）', () => {
    expect(trimLearnings(many).at(-1)?.summary).toBe('30 回目')
  })
})

describe('次の反復に渡す本文', () => {
  const base = { teamDir: '/t/teams/x', iteration: 3 }

  it('**引き継ぎを本文に入れる**（別の場所に置いてもモデルには届かない）', () => {
    const text = iterationPrompt({
      ...base,
      progress: p({
        learnings: [{ iteration: 2, summary: '検査を直した', filesChanged: ['a.ts'] }]
      })
    })
    expect(text).toContain('検査を直した')
    expect(text).toContain('a.ts')
  })

  it('最初の反復では、無いことを言う', () => {
    expect(iterationPrompt({ ...base, progress: p() })).toContain('これが最初の反復')
  })

  it('計画の相では実装を禁じる', () => {
    const text = iterationPrompt({ ...base, progress: p({ phase: 'planning' }) })
    expect(text).toContain('実装はしない')
    expect(text).toContain('/t/teams/x/brief.md')
  })

  it('実装の相では 1 件だけに絞る', () => {
    const text = iterationPrompt({ ...base, progress: p({ phase: 'building' }) })
    expect(text).toContain('1 反復 1 件')
    expect(text).toContain('/t/teams/x/tasks/')
  })

  it('人からの指示があれば渡す', () => {
    expect(iterationPrompt({ ...base, progress: p({ userFeedback: 'ここを直して' }) })).toContain(
      'ここを直して'
    )
  })

  it('**毎回、進捗を宣言させる**（文面から推測しない）', () => {
    const text = iterationPrompt({ ...base, progress: p() })
    expect(text).toContain('izuna_progress')
    expect(text).toContain('黙って諦めない')
  })

  it('文脈が残っていないことを明示する', () => {
    expect(iterationPrompt({ ...base, progress: p() })).toContain('前の反復の記憶は残っていない')
  })
})

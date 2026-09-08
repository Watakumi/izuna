import { describe, expect, it } from 'vitest'
import { answerInput, answered, questionsOf } from '../src/shared/question'

/** `AskUserQuestion` の受け皿（docs/NIMBALYST.md §3 の 2） */
const input = {
  questions: [
    { question: 'どれにする？', header: '選択', options: [{ label: 'A', description: '速い' }, { label: 'B' }], multiSelect: false },
    { question: '要るもの', options: [{ label: 'x' }, { label: 'y' }], multiSelect: true }
  ]
}

describe('問いを読む', () => {
  it('AskUserQuestion の入力を問いにする。説明は無ければ null', () => {
    const qs = questionsOf('AskUserQuestion', input)!
    expect(qs).toHaveLength(2)
    expect(qs[0]).toMatchObject({ question: 'どれにする？', header: '選択', multiSelect: false })
    expect(qs[0].options).toEqual([{ label: 'A', description: '速い' }, { label: 'B', description: null }])
    expect(qs[1]).toMatchObject({ header: null, multiSelect: true })
  })

  it('他のツールや、形の違う入力は null（ふつうの許可として扱う）', () => {
    expect(questionsOf('Bash', input)).toBeNull()
    expect(questionsOf('AskUserQuestion', {})).toBeNull()
    expect(questionsOf('AskUserQuestion', { questions: [] })).toBeNull()
    expect(questionsOf('AskUserQuestion', { questions: [{ options: [] }] })).toBeNull()
  })

  it('label の無い選択肢は落とす', () => {
    const qs = questionsOf('AskUserQuestion', { questions: [{ question: 'q', options: [{}, { label: 'ok' }] }] })!
    expect(qs[0].options.map((o) => o.label)).toEqual(['ok'])
  })
})

describe('答える', () => {
  const qs = questionsOf('AskUserQuestion', input)!

  it('全部に答えるまで送れない。空白は答えではない', () => {
    expect(answered(qs, { 'どれにする？': ['A'] })).toBe(false)
    expect(answered(qs, { 'どれにする？': ['A'], '要るもの': [' '] })).toBe(false)
    expect(answered(qs, { 'どれにする？': ['A'], '要るもの': ['x', 'y'] })).toBe(true)
  })

  it('元の入力に answers を足す。複数は「, 」で繋ぐ。空は入れない', () => {
    const out = answerInput(input, { 'どれにする？': ['A'], '要るもの': ['x', ' y '], '無い問い': [''] })
    expect(out.questions).toBe(input.questions)
    expect(out.answers).toEqual({ 'どれにする？': 'A', '要るもの': 'x, y' })
  })

  it('入力がオブジェクトでなくても落ちない', () => {
    expect(answerInput(null, { q: ['a'] })).toEqual({ answers: { q: 'a' } })
  })
})

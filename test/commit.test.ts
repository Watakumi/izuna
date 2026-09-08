import { describe, expect, it } from 'vitest'
import { canDraft, draftPrompt, extractMessage, type CommitContext } from '../src/shared/commit'

const ctx = (over: Partial<CommitContext> = {}): CommitContext => ({
  changed: [' M src/a.ts', '?? src/b.ts'], branch: 'main', recent: [], ...over
})

describe('頼むかどうか', () => {
  it('変更が無ければ頼まない（空のコミット文を作らせない）', () => {
    expect(canDraft(ctx({ changed: [] }))).toBe(false)
    expect(canDraft(ctx())).toBe(true)
  })
})

describe('頼み方', () => {
  it('触ったファイルを渡す', () => {
    expect(draftPrompt(ctx())).toContain('src/a.ts')
  })

  it('**差分の中身は渡さない**（意図は会話にあり、diff には無い）', () => {
    const text = draftPrompt(ctx())
    expect(text).not.toContain('@@')
    expect(text).not.toContain('diff')
  })

  it('直近のコミットがあれば、書き方を揃えさせる', () => {
    expect(draftPrompt(ctx({ recent: ['見た目の土台を作る'] }))).toContain('見た目の土台を作る')
  })

  it('無ければその節ごと出さない', () => {
    expect(draftPrompt(ctx())).not.toContain('直近のコミット')
  })

  it('「なぜ」を書かせる（何をしたかは差分で分かる）', () => {
    expect(draftPrompt(ctx())).toContain('なぜそうしたか')
  })
})

describe('受け取り', () => {
  it('そのまま返ってきたら、そのまま', () => {
    expect(extractMessage('直した\n\n理由はこう')).toBe('直した\n\n理由はこう')
  })

  it('**囲みを外す**（そのまま渡すとコミット文に ``` が入る）', () => {
    expect(extractMessage('```\n直した\n\n理由\n```')).toBe('直した\n\n理由')
    expect(extractMessage('```text\n直した\n```')).toBe('直した')
  })

  it('前置きを落とす', () => {
    expect(extractMessage('はい、こちらです：\n\n直した\n\n理由')).toBe('直した\n\n理由')
  })

  it('前置きに見える本文を落とさない（1 行目が件名のことがある）', () => {
    expect(extractMessage('直した\n\n理由はこう：\n- あれ')).toContain('直した')
  })

  it('前後の空白を落とす', () => {
    expect(extractMessage('\n\n  直した  \n\n')).toBe('直した')
  })
})

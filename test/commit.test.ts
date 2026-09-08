import { describe, expect, it } from 'vitest'
import { canDraft, draftPrompt, type CommitContext } from '../src/shared/commit'

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

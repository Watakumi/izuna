import { describe, expect, it } from 'vitest'
import { branchFromIssue, branchFromText, uniqueBranch } from '../src/shared/branch'

/**
 * ブランチ名の自動生成に対する門。
 *
 * **人間にブランチ名を考えさせない**ための機構なので、
 * 生成されたものが読めなければ意味がない。
 */

describe('Issue から', () => {
  it('番号と題から作る', () => {
    expect(branchFromIssue(12, 'Virtualize the palette list'))
      .toBe('issue-12-virtualize-the-palette-list')
  })

  it('**題が日本語でも番号で辿れる**', () => {
    // 非 ASCII を落とすと slug が空になる。番号が無いと何の作業か分からなくなる
    expect(branchFromIssue(12, 'パレットの補完を仮想化する')).toBe('issue-12')
  })

  it('混ざっていれば拾える部分だけ使う', () => {
    expect(branchFromIssue(7, 'fix: パレットの bug')).toMatch(/^issue-7-fix/)
  })

  it('長い題は切る', () => {
    const b = branchFromIssue(3, 'a'.repeat(80))
    expect(b.length).toBeLessThan(48)
    expect(b.endsWith('-')).toBe(false)
  })

  it('git が拒む文字を残さない', () => {
    const b = branchFromIssue(1, 'feat: a b~c^d:e?f*g[h')
    expect(/[\s~^:?*[\\]/.test(b)).toBe(false)
  })
})

describe('自由入力から', () => {
  it('英語ならそのまま読める', () => {
    expect(branchFromText('add dark mode')).toBe('task-add-dark-mode')
  })

  it('日本語だけなら日付で逃がす', () => {
    // 空のブランチ名を作るくらいなら、意味は薄くても衝突しない名前を出す。
    // 日付そのものは問わない —— 空でなく、git が通ることだけを守る
    const b = branchFromText('パレットを直す', new Date('2026-09-07T21:30:00Z'))
    expect(b).toMatch(/^task-\d+$/)
    expect(/[\s~^:?*[\\]/.test(b)).toBe(false)
  })

  it('同じ時刻なら同じ名前（衝突は uniqueBranch が畳む）', () => {
    const at = new Date('2026-09-07T21:30:00Z')
    expect(branchFromText('あ', at)).toBe(branchFromText('い', at))
  })
})

describe('衝突を避ける', () => {
  it('空いていればそのまま', () => {
    expect(uniqueBranch('issue-12', ['main'])).toBe('issue-12')
  })

  it('埋まっていれば番号を足す', () => {
    expect(uniqueBranch('issue-12', ['issue-12'])).toBe('issue-12-2')
    expect(uniqueBranch('issue-12', ['issue-12', 'issue-12-2'])).toBe('issue-12-3')
  })
})

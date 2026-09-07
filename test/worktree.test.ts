import { describe, expect, it } from 'vitest'
import {
  canRemove,
  parseWorktrees,
  slugifyBranch,
  validateNewWorktree,
  worktreePathFor,
  type Worktree
} from '../src/shared/worktree'

/**
 * worktree の扱いに対する門（段3）。
 *
 * 実行役ごとに worktree を分けるので、ここが崩れると並列そのものが
 * 成り立たない。**実出力（git 2.54）を材料にしている。**
 */

// izuna リポジトリで実際に撮ったもの
const REAL = `worktree /Users/someone/work/personal/izuna
HEAD 5a33038120310397f8c331965a724db824fcdbc0
branch refs/heads/main

worktree /private/tmp/izuna-wt-probe
HEAD 5a33038120310397f8c331965a724db824fcdbc0
branch refs/heads/probe/sample
`

const wt = (over: Partial<Worktree>): Worktree => ({
  path: '/x', head: null, branch: null, detached: false, bare: false,
  locked: null, prunable: null, main: false, ...over
})

describe('porcelain を読む', () => {
  const list = parseWorktrees(REAL)

  it('件数と順序', () => {
    expect(list).toHaveLength(2)
    expect(list[0].main).toBe(true)
    expect(list[1].main).toBe(false)
  })

  it('refs/heads/ を落とす。スラッシュを含むブランチも保つ', () => {
    expect(list[0].branch).toBe('main')
    expect(list[1].branch).toBe('probe/sample')
  })

  it('末尾の空行があってもなくても同じ', () => {
    expect(parseWorktrees(REAL.trimEnd())).toEqual(list)
  })

  it('detached / bare / locked / prunable を拾う', () => {
    const parsed = parseWorktrees(
      'worktree /a\nHEAD abc\ndetached\n\n' +
      'worktree /b\nbare\n\n' +
      'worktree /c\nHEAD d\nbranch refs/heads/x\nlocked 手で止めた\n\n' +
      'worktree /d\nHEAD e\nbranch refs/heads/y\nprunable gitdir が無い\n'
    )
    expect(parsed[0]).toMatchObject({ detached: true, branch: null })
    expect(parsed[1]).toMatchObject({ bare: true })
    expect(parsed[2]).toMatchObject({ locked: '手で止めた' })
    expect(parsed[3]).toMatchObject({ prunable: 'gitdir が無い' })
  })

  it('値のない locked も拾う（理由なしのロック）', () => {
    expect(parseWorktrees('worktree /a\nlocked\n')[0].locked).toBe('')
  })

  it('知らない属性が増えても壊れない', () => {
    const parsed = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/x\nbrand-new-thing 1\n')
    expect(parsed).toHaveLength(1)
    expect(parsed[0].branch).toBe('x')
  })

  it('空入力は空配列', () => {
    expect(parseWorktrees('')).toEqual([])
  })
})

describe('置き場所', () => {
  it('スラッシュを潰してディレクトリ名にする', () => {
    expect(slugifyBranch('feat/palette')).toBe('feat-palette')
    expect(slugifyBranch('FIX/Auth Bug')).toBe('fix-auth-bug')
  })

  it('前後の記号と重複を落とす', () => {
    expect(slugifyBranch('//a//b//')).toBe('a-b')
    expect(slugifyBranch('a---b')).toBe('a-b')
  })

  it('リポジトリの外に置く', () => {
    // 中に置くと、そのリポジトリ自身の worktree 一覧や ignore と噛み合って事故になる
    expect(worktreePathFor('/Users/x/.izuna/worktrees', 'izuna', 'feat/palette'))
      .toBe('/Users/x/.izuna/worktrees/izuna/feat-palette')
  })

  it('末尾のスラッシュを重ねない', () => {
    expect(worktreePathFor('/base/', 'r', 'b')).toBe('/base/r/b')
  })
})

describe('作る前の検査', () => {
  const existing = [
    wt({ path: '/repo', branch: 'main', main: true }),
    wt({ path: '/wt/feat-a', branch: 'feat/a' })
  ]

  it('問題なければ null', () => {
    expect(validateNewWorktree(existing, 'feat/b', '/wt/feat-b')).toBeNull()
  })

  it('本体のブランチは取り合わない', () => {
    expect(validateNewWorktree(existing, 'main', '/wt/main')).toContain('本体')
  })

  it('既に開いているブランチは場所を教える', () => {
    expect(validateNewWorktree(existing, 'feat/a', '/wt/x')).toContain('/wt/feat-a')
  })

  it('同じ場所には作らせない', () => {
    expect(validateNewWorktree(existing, 'feat/z', '/wt/feat-a')).toContain('既に worktree')
  })

  it('git が拒む名前は先に弾く（作ってから失敗するより分かりやすい）', () => {
    for (const bad of ['a b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a..b', '']) {
      expect(validateNewWorktree(existing, bad, '/wt/x'), `"${bad}" が通ってしまった`).not.toBeNull()
    }
  })
})

describe('畳んでよいか', () => {
  it('本体は畳めない', () => {
    expect(canRemove(wt({ main: true }))).toContain('本体')
  })

  it('ロック中は畳めない。理由があれば見せる', () => {
    expect(canRemove(wt({ locked: '実験中' }))).toContain('実験中')
    expect(canRemove(wt({ locked: '' }))).toContain('ロック')
  })

  it('普通のものは畳める', () => {
    expect(canRemove(wt({ branch: 'feat/a' }))).toBeNull()
  })
})

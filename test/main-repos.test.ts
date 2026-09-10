import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRepos, pickDirectory } from '../src/main/repos'

/**
 * リポジトリの探索（絶対パスの直打ちをやめるため）。
 *
 * **深く潜らないこと**が要点なので、そこを重点的に見る。
 * ホーム全体を舐めると遅いうえ、`node_modules` の中の `.git` まで拾って
 * 役に立たない。
 */

let dialogResult: { canceled: boolean; filePaths: string[] } = { canceled: true, filePaths: [] }
vi.mock('electron', () => ({ dialog: { showOpenDialog: async () => dialogResult } }))

let root: string
const repo = (rel: string): void => {
  mkdirSync(join(root, rel, '.git'), { recursive: true })
  writeFileSync(join(root, rel, '.git', 'HEAD'), 'ref: refs/heads/main\n')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'izuna-r-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('探索', () => {
  it('無い置き場は黙って飛ばす', async () => {
    expect(await findRepos([join(root, 'いない')], 3)).toEqual([])
  })

  it('.git を持つものを見つけ、親を見出しにする', async () => {
    repo('work/personal/izuna')
    const [r] = await findRepos([root], 3)
    expect(r.name).toBe('izuna')
    // 見出しは探索の起点も含む（`work/personal` のような形にするため）
    expect(r.group.endsWith('work/personal')).toBe(true)
    expect(r.path).toContain('izuna')
  })

  it('**リポジトリの中には降りない**（submodule や worktree まで並べても混乱する）', async () => {
    repo('a')
    repo('a/inner')
    const list = await findRepos([root], 4)
    expect(list.map((r) => r.name)).toEqual(['a'])
  })

  it('深さで止まる（ホーム全体を舐めない）', async () => {
    repo('one/two/three/deep')
    expect(await findRepos([root], 2)).toEqual([])
    expect((await findRepos([root], 4)).map((r) => r.name)).toEqual(['deep'])
  })

  it('node_modules や隠しディレクトリの中は見ない', async () => {
    repo('node_modules/pkg')
    repo('.cache/x')
    repo('ok')
    expect((await findRepos([root], 4)).map((r) => r.name)).toEqual(['ok'])
  })

  it('見出しと名前で並べる（呼ぶたびに順が変わらない）', async () => {
    repo('b/z')
    repo('b/a')
    repo('a/m')
    expect(
      (await findRepos([root], 3)).map((r) => `${r.group.split('/').pop()}/${r.name}`)
    ).toEqual(['a/m', 'b/a', 'b/z'])
  })

  it('複数の置き場をまたぐ', async () => {
    const other = mkdtempSync(join(tmpdir(), 'izuna-r2-'))
    mkdirSync(join(other, 'x', '.git'), { recursive: true })
    repo('y')
    const list = await findRepos([root, other], 3)
    expect(list.map((r) => r.name).sort()).toEqual(['x', 'y'])
    rmSync(other, { recursive: true, force: true })
  })
})

describe('フォルダを選ぶ', () => {
  it('選ばれた場所を返す', async () => {
    dialogResult = { canceled: false, filePaths: ['/選んだ場所'] }
    expect(await pickDirectory(null)).toBe('/選んだ場所')
  })

  it('やめたら null', async () => {
    dialogResult = { canceled: true, filePaths: [] }
    expect(await pickDirectory(null)).toBeNull()
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exists, writeAtomic } from '../src/main/fsx'

/** ファイルの小さな道具（`main/fsx.ts`）。会議・ループ・予約が使う */
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'izuna-fsx-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeAtomic', () => {
  it('書いて置き換え、一時ファイルを残さない', async () => {
    await writeAtomic(join(dir, 'a.json'), '1')
    await writeAtomic(join(dir, 'a.json'), '2')
    expect(readFileSync(join(dir, 'a.json'), 'utf8')).toBe('2')
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it('同時に書いても、どちらかが丸ごと残る（一時ファイルを取り合わない）', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => writeAtomic(join(dir, 'a.json'), `${i}`))
    )
    expect(Number(readFileSync(join(dir, 'a.json'), 'utf8'))).toBeGreaterThanOrEqual(0)
    expect(readdirSync(dir)).toEqual(['a.json'])
  })

  it('置き換えに失敗したら、一時ファイルを消して投げ直す', async () => {
    // 置き換え先がフォルダだと rename が失敗する
    mkdirSync(join(dir, 'a.json'))
    await expect(writeAtomic(join(dir, 'a.json'), '1')).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['a.json'])
  })
})

describe('exists', () => {
  it('あるものとないもの', async () => {
    expect(await exists(dir)).toBe(true)
    expect(await exists(join(dir, 'none'))).toBe(false)
  })
})

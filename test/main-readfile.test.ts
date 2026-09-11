import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readRepoFile } from '../src/main/readfile'
import { MAX_READ_BYTES } from '../src/shared/readfile'

/** 中で読む口（§34）。**読むだけ。** 本物のファイルで測る */
let root: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'izuna-read-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'big.txt'), 'x'.repeat(MAX_READ_BYTES + 100))
  writeFileSync(join(root, 'bin'), Buffer.from([0x89, 0x50, 0x00, 0x4e]))
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readRepoFile', () => {
  it('中のファイルは読める', async () => {
    const got = await readRepoFile([root], join(root, 'src', 'a.ts'))
    expect(got.text).toBe('export const a = 1\n')
    expect(got.truncated).toBe(false)
  })

  it('**外は読まない。** .. で出ようとしても断る', async () => {
    await expect(readRepoFile([root], '/etc/hosts')).rejects.toThrow(/外は読みません/)
    await expect(readRepoFile([root], join(root, '..', 'etc', 'hosts'))).rejects.toThrow(
      /外は読みません/
    )
  })

  it('大きいものは頭だけ返し、切ったと言う', async () => {
    const got = await readRepoFile([root], join(root, 'big.txt'))
    expect(got.truncated).toBe(true)
    expect(got.text.length).toBe(MAX_READ_BYTES)
    expect(got.bytes).toBe(MAX_READ_BYTES + 100)
  })

  it('字として読めないものは断る（画面を壊さない）', async () => {
    await expect(readRepoFile([root], join(root, 'bin'))).rejects.toThrow(/字として読めません/)
  })

  it('ディレクトリは断る', async () => {
    await expect(readRepoFile([root], join(root, 'src'))).rejects.toThrow(/ファイルではありません/)
  })
})

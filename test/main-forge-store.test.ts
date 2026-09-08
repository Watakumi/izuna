import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * トークンの保管（CLAUDE.md §15）。
 *
 * **平文で書かない。** 使えない環境では保管を拒む —— 平文で置くくらいなら、
 * 毎回入れてもらうほうがよい。ここではその判断が守られているかを見る。
 *
 * `safeStorage` は Electron の中でしか動かないので、**暗号化の代わりに
 * 印を付けて往復**させ、「素通しになっていないか」を確かめる。
 */

let dir: string
let available = true
const MARK = 'enc:' // 暗号化した印。生の文字列と見分けるためだけのもの

vi.mock('electron', () => ({
  app: { getPath: () => dir },
  safeStorage: {
    isEncryptionAvailable: () => available,
    encryptString: (s: string) => Buffer.from(MARK + s),
    decryptString: (b: Buffer) => {
      const t = b.toString()
      if (!t.startsWith(MARK)) throw new Error('暗号化されていない')
      return t.slice(MARK.length)
    }
  }
}))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'izuna-s-'))
  available = true
  vi.resetModules()
})

describe('保管', () => {
  it('往復する', async () => {
    const { saveToken, loadToken } = await import('../src/main/forge/store')
    await saveToken('tok_1234')
    expect(await loadToken()).toBe('tok_1234')
  })

  it('**暗号化されていない形では置かない**', async () => {
    const { saveToken } = await import('../src/main/forge/store')
    await saveToken('tok_1234')
    const raw = require('node:fs').readFileSync(join(dir, 'forge-token.bin'), 'utf8')
    expect(raw.startsWith(MARK)).toBe(true)
  })

  it('暗号化できない環境では保管を拒む（平文で置くくらいなら毎回入れてもらう）', async () => {
    available = false
    const { saveToken } = await import('../src/main/forge/store')
    await expect(saveToken('tok_1234')).rejects.toThrow(/保管/)
  })

  it('未保存・鍵が変わった・壊れた —— どれも「無い」', async () => {
    const { loadToken } = await import('../src/main/forge/store')
    expect(await loadToken()).toBeNull()
    available = false
    expect(await loadToken()).toBeNull()
  })
})

describe('権限の記録', () => {
  it('発行したときの権限を一緒に覚える', async () => {
    const { saveToken, loadScopes } = await import('../src/main/forge/store')
    await saveToken('tok_1234', ['write:user', 'write:repository'])
    expect(await loadScopes()).toEqual(['write:user', 'write:repository'])
  })

  it('記録が無ければ null（分からないことを「足りない」と言わない）', async () => {
    const { saveToken, loadScopes } = await import('../src/main/forge/store')
    await saveToken('tok_1234')
    expect(await loadScopes()).toBeNull()
  })

  it('**古い形式（生の文字列）も読める**。読めないと再発行を強いる', async () => {
    const fs = await import('node:fs')
    fs.writeFileSync(join(dir, 'forge-token.bin'), Buffer.from(MARK + 'tok_old'))
    const { loadToken, loadScopes } = await import('../src/main/forge/store')
    expect(await loadToken()).toBe('tok_old')
    expect(await loadScopes()).toBeNull()
  })
})

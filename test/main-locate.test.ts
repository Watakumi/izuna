import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * `claude` の実体とログインシェルの環境（CLAUDE.md §7 の一番上）。
 *
 * **Finder から起動した Electron はログインシェルの PATH を継承しない。**
 * `process.env.PATH` を信用すると mise / nvm / `~/.local/bin` 配下を丸ごと見失う。
 * ここが壊れると「手元では動くのに、アプリからは claude が無い」になる。
 */

let runs: string[][] = []
let out: Array<string | Error> = []
let configured: string | null = null
let dir: string

vi.mock('../src/main/config', () => ({ resolved: async () => ({ claudePath: configured }) }))
vi.mock('node:child_process', () => ({
  execFile: (...all: unknown[]) => {
    const cb = all[all.length - 1] as (
      e: Error | null,
      r?: { stdout: string; stderr: string }
    ) => void
    runs.push([all[0] as string, ...((all[1] as string[]) ?? [])])
    const next = out.shift()
    if (next instanceof Error) cb(next)
    else cb(null, { stdout: next ?? '', stderr: '' })
  }
}))

/** 実行できるファイルを 1 つ置く */
const executable = (name: string): string => {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
  return path
}

const load = async (): Promise<typeof import('../src/main/claude/locate')> =>
  import('../src/main/claude/locate')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'izuna-l-'))
  runs = []
  out = []
  configured = null
  process.env.SHELL = '/bin/zsh'
  vi.resetModules()
})

describe('claude を探す', () => {
  it('設定で指されていればそれを使う（PATH に無い場所に置いている人のため）', async () => {
    configured = executable('claude')
    const { locateClaude } = await load()
    expect(await locateClaude()).toBe(configured)
    expect(runs).toHaveLength(0) // シェルに聞かない
  })

  it('設定の場所が実行できなければ、無視して探しに行く', async () => {
    configured = join(dir, 'いない')
    const found = executable('claude')
    out = [`${found}\n`]
    const { locateClaude } = await load()
    expect(await locateClaude()).toBe(found)
  })

  it('**ログインシェルに聞く**（`-ilc` でないと設定ファイルが読まれない）', async () => {
    const found = executable('claude')
    out = [`${found}\n`]
    const { locateClaude } = await load()
    await locateClaude()
    expect(runs[0]).toEqual(['/bin/zsh', '-ilc', 'command -v claude'])
  })

  it('シェルの出力が複数行でも最後を採る（rc が何か出力する構成がある）', async () => {
    const found = executable('claude')
    out = [`挨拶\n${found}\n`]
    const { locateClaude } = await load()
    expect(await locateClaude()).toBe(found)
  })

  it('シェルが対話起動に失敗しても、既知の場所を当たる', async () => {
    out = [new Error('対話で起動できない')]
    const { locateClaude } = await load()
    // この機械に無ければ、見つからない旨で落ちる（どちらでも「落ちない」ことが要点）
    await locateClaude().catch((e: Error) => expect(e.message).toMatch(/見つかりません/))
  })

  it('**見つからなければ、直し方を言って落ちる**', async () => {
    out = [new Error('無い')]
    vi.doMock('node:fs/promises', async (orig) => ({
      ...(await orig<typeof import('node:fs/promises')>()),
      access: async () => {
        throw new Error('無い')
      }
    }))
    vi.resetModules()
    const { locateClaude } = await import('../src/main/claude/locate')
    await expect(locateClaude()).rejects.toThrow(/PATH に通す|パスを指定/)
  })
})

describe('ログインシェルの環境', () => {
  it('**NUL 区切りで読む**（値に改行が入っても壊れない）', async () => {
    out = ['PATH=/usr/bin\0GREETING=一行目\n二行目\0']
    const { loginShellEnv } = await load()
    const env = await loginShellEnv()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.GREETING).toBe('一行目\n二行目')
    expect(runs[0]).toEqual(['/bin/zsh', '-ilc', 'env -0'])
  })

  it('取れなければ、いまの環境に落ちる（空を返して claude を壊さない）', async () => {
    out = [new Error('駄目')]
    const { loginShellEnv } = await load()
    expect((await loginShellEnv()).PATH).toBe(process.env.PATH)
  })

  it('空が返っても、いまの環境に落ちる', async () => {
    out = ['']
    const { loginShellEnv } = await load()
    expect(Object.keys(await loginShellEnv()).length).toBeGreaterThan(0)
  })
})

describe('環境は一度取ったら覚える（§27）', () => {
  it('**二度目はシェルを起こさない**（git を呼ぶたびに .zshrc を評価していた）', async () => {
    out = ['PATH=/a\0HOME=/h\0', 'PATH=/b\0']
    const { loginShellEnv } = await load()
    expect((await loginShellEnv()).PATH).toBe('/a')
    expect((await loginShellEnv()).PATH).toBe('/a')
    expect(runs.filter((r) => r.includes('env -0'))).toHaveLength(1)
  })

  it('取り直せば新しいものになる', async () => {
    out = ['PATH=/a\0', 'PATH=/b\0']
    const { loginShellEnv, refreshLoginShellEnv } = await load()
    await loginShellEnv()
    expect((await refreshLoginShellEnv()).PATH).toBe('/b')
    expect((await loginShellEnv()).PATH).toBe('/b')
  })
})

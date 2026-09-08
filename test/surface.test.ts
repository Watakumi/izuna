import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * renderer に出す面の門（§26）。
 *
 * 会話の本文は LLM が書く。renderer が破られたときに手に入るものを
 * 増やさない —— main の環境変数、任意チャネルの ipc、砂場の外の preload。
 * 一度ゆるめると気づけないので、文字列で見張る。
 */
const ROOT = join(__dirname, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

describe('preload', () => {
  const src = read('src/preload/index.ts')

  it('`electronAPI` を出さない（process.env を丸ごと返す）', () => {
    expect(src).not.toMatch(/from '@electron-toolkit\/preload'/)
    expect(src).not.toMatch(/exposeInMainWorld\('electron'/)
  })

  it('出すのは izuna だけ', () => {
    const exposed = [...src.matchAll(/exposeInMainWorld\('(\w+)'/g)].map((m) => m[1])
    expect(exposed).toEqual(['izuna'])
  })

  it('contextIsolation が切れていたら露出せずに落とす', () => {
    expect(src).not.toMatch(/window\.izuna\s*=/)
  })
})

describe('BrowserWindow', () => {
  const src = read('src/main/index.ts')

  it('砂場・隔離・Node 統合は Electron の既定のまま', () => {
    expect(src).not.toMatch(/sandbox:\s*false/)
    expect(src).not.toMatch(/contextIsolation:\s*false/)
    expect(src).not.toMatch(/nodeIntegration:\s*true/)
    expect(src).not.toMatch(/webSecurity:\s*false/)
  })

  it('外に出す URL は必ず判定を通す', () => {
    // openExternal を直接呼ぶ箇所が無い（escape() だけが呼ぶ）
    const direct = [...src.matchAll(/shell\.openExternal\(/g)].length
    expect(direct).toBe(1)
    expect(src).toContain('openableOutside(url)')
    expect(src).toContain('isOwnPage(')
  })
})

describe('HTML の注入口', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full, out)
      else if (/\.tsx?$/.test(name)) out.push(full)
    }
    return out
  }
  const sinks = walk(join(ROOT, 'src')).filter((f) =>
    /dangerouslySetInnerHTML|\.innerHTML\s*=/.test(
      // コメントの中の言及は数えない。見たいのは実際に流している箇所
      readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    ))

  it('**mermaid 以外に無い**（本文は木で描く。`shared/markdown.ts` の註）', () => {
    expect(sinks.map((f) => f.replace(ROOT + '/', ''))).toEqual(['src/renderer/src/components/Mermaid.tsx'])
  })

  it('mermaid は消毒し、失敗した図を body に描かせない', () => {
    const src = read('src/renderer/src/components/Mermaid.tsx')
    expect(src).toMatch(/securityLevel:\s*'strict'/)
    expect(src).toMatch(/suppressErrorRendering:\s*true/)
  })
})

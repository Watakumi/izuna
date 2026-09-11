import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * **握りつぶした例外の ratchet。** §27 は「握りつぶした例外 57 か所の仕分け」を宿題に残し、
 * 数えるだけで 3 日が過ぎた。Orca の `check-*-ratchet.mjs`（docs/ORCA.md §2）は baseline を
 * 縮む方向にしか動かせない。同じ形にする —— **増えたら落ちる。減ったら baseline を下げるまで落ちる。**
 * 減ったのに baseline を残すと、次に増えたとき気づけない。
 *
 * 数えるのは 2 つの形だけ。`.catch(() => null)` のように値で握るものと、空の `catch {}`。
 * 理由を書いて握るもの（`catch (e) { setMsg(...) }`）は数えない —— それは処理であって握りつぶしではない。
 */
const ROOT = join(__dirname, '..')
const BASELINE = join(__dirname, 'fixtures', 'swallowed-catches.json')

const SWALLOW = [
  /\.catch\(\(\)\s*=>\s*(null|undefined|false|true|\[\]|''|""|\{\}|void 0)\)/g,
  /catch\s*(\([^)]*\))?\s*\{\s*\}/g
]
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

/** 純粋な数え方。baseline を作るときも同じ関数で数える */
export function countSwallowed(text: string): number {
  const t = stripComments(text)
  return SWALLOW.reduce((n, re) => n + (t.match(re)?.length ?? 0), 0)
}

describe('握りつぶした例外は増やさない', () => {
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>
  const now: Record<string, number> = {}
  for (const f of walk(join(ROOT, 'src'))) {
    const n = countSwallowed(readFileSync(f, 'utf8'))
    if (n) now[relative(ROOT, f)] = n
  }

  it('baseline より増えたファイルが無い', () => {
    const grew = Object.entries(now)
      .filter(([f, n]) => n > (baseline[f] ?? 0))
      .map(([f, n]) => `${f}: ${baseline[f] ?? 0} → ${n}`)
    expect(grew, `握りつぶした例外が増えた:\n${grew.join('\n')}`).toEqual([])
  })

  it('減ったら baseline も下げる（test/fixtures/swallowed-catches.json）', () => {
    const shrank = Object.entries(baseline)
      .filter(([f, n]) => (now[f] ?? 0) < n)
      .map(([f, n]) => `${f}: ${n} → ${now[f] ?? 0}`)
    expect(shrank, `減った。baseline を下げること:\n${shrank.join('\n')}`).toEqual([])
  })

  it('数えられている', () => {
    expect(Object.values(now).reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
  })
})

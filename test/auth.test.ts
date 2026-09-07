import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseLine, isInit, type InitEvent } from '../src/shared/protocol'

/**
 * Izuna は利用者の Pro プラン（claude.ai の OAuth ログイン）で動く前提で作っている。
 * API キーに落ちると**課金経路が変わる**ので、黙って切り替わったら気づきたい。
 *
 * `apiKeySource` は SDK の型定義いわく
 *   'none' = API キー不使用（claude.ai OAuth ログイン等）
 *   'ANTHROPIC_API_KEY' = 環境変数のキー
 * である。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SAFE = join(ROOT, 'test', 'fixtures', 'session-safe.ndjson')

function initOf(path: string): InitEvent | undefined {
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map(parseLine)
    .flatMap((r) => (r.kind === 'event' ? [r.event] : []))
    .find(isInit)
}

describe('認証経路', () => {
  it('録画は API キー経由ではない（= サブスクリプションで動いている）', () => {
    const init = initOf(SAFE)
    expect(init, 'fixture が無い。先に録ること').toBeDefined()
    expect(
      init!.apiKeySource,
      `apiKeySource が ${init!.apiKeySource} になっている。\n` +
        '  ANTHROPIC_API_KEY が設定されると従量課金の経路に切り替わる。\n' +
        '  Pro プランの枠で動かすつもりなら、キーを外して録り直すこと。'
    ).not.toBe('ANTHROPIC_API_KEY')
  })

  it('--bare は使わない（OAuth とキーチェーンを読まなくなる）', () => {
    // 起動引数を組み立てる場所が増えたら、ここも増やすこと。
    const sources = ['src/main/claude/session.ts', 'scripts/record-fixture.ts']
    for (const rel of sources) {
      const src = readFileSync(join(ROOT, rel), 'utf8')
      expect(src.includes("'--bare'"), `${rel} に --bare がある`).toBe(false)
    }
  })
})

describe('SDK と CLI の版', () => {
  it('パッチ番号が揃っている', () => {
    // SDK 0.3.263 ↔ CLI 2.1.263 のように、末尾が連動している。
    // ずれたまま使うと、SDK が知らないイベントを CLI が吐く。
    const sdk = JSON.parse(
      readFileSync(join(ROOT, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')
    ).version as string
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8' })
    expect(r.status, 'claude が見つからない').toBe(0)
    const cli = (r.stdout.match(/\d+\.\d+\.\d+/) ?? [''])[0]

    const patch = (v: string): string => v.split('.').at(-1) ?? ''
    expect(
      patch(sdk),
      `SDK は ${sdk}、CLI は ${cli}。\n` +
        '  pnpm add @anthropic-ai/claude-agent-sdk@0.3.<CLI のパッチ番号> で揃えること。'
    ).toBe(patch(cli))
  })
})

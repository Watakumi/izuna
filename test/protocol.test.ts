import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  MEASURED_CLI_VERSION,
  isAssistant,
  isInit,
  isResult,
  parseLine,
  versionDrift,
  type ClaudeEvent,
  type InitEvent
} from '../src/shared/protocol'

/**
 * ワイヤ形式に対する門。
 *
 * CLAUDE.md §5 は「claude 2.1.263 での実測。公開仕様ではない」と書いてある。
 * つまり**上流はいつでも黙って変わる**。変わったことに気づく仕掛けが無いと、
 * 気づくのは UI が壊れたときになる。
 *
 * `scripts/smoke-session.ts` は実 API を呼ぶので、費用が理由で手でしか回らない。
 * **毎回ただで回らないものは門にならない**ので、
 * ここでは録画した NDJSON(= 化石)に対して回す。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * fixture は 2 本ある(CLAUDE.md §11)。
 *
 *   safe  --safe-mode で録った。**版管理に入る**。この門が見るのはこれ
 *   full  素で録った。gitignore。hook がプラグイン経由で過去セッションの要約を
 *         注入するため commit できない。init の実物を見たいときの手元用
 *
 * 後から削るのは「加工しない」に反するので、代わりに観測条件を統制している。
 */
const SAFE = join(ROOT, 'test', 'fixtures', 'session-safe.ndjson')
const FULL = join(ROOT, 'test', 'fixtures', 'session-full.ndjson')

const RECORD_HINT =
  `fixture が無い: ${SAFE}\n` +
  '  npx tsx scripts/record-fixture.ts --safe で録ってから commit すること。\n' +
  '  実 API を呼ぶ(haiku に pong と返させるだけなので費用はごく小さい)。'

function read(path: string): string[] {
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
    : []
}
function toEvents(src: string[]): ClaudeEvent[] {
  return src.map(parseLine).flatMap((r) => (r.kind === 'event' ? [r.event] : []))
}

const lines = read(SAFE)
const events = toEvents(lines)
const fullLines = read(FULL)
const fullEvents = toEvents(fullLines)

describe('録画した NDJSON に対するパース', () => {
  // ここは飛ばさず落とす。skip すると門にならない。
  // fixture が無いあいだ verify は赤のままで、それが「まず録れ」の合図になる。
  it('fixture が版管理に入っている', () => {
    expect(existsSync(SAFE), RECORD_HINT).toBe(true)
  })

  it.skipIf(!lines.length)('全行がイベントか診断に落ちる(未知の形で例外にしない)', () => {
    for (const line of lines) {
      expect(() => parseLine(line)).not.toThrow()
    }
  })

  it.skipIf(!lines.length)('1 回のセッションに init と result がちょうど 1 つずつある', () => {
    expect(events.filter(isInit)).toHaveLength(1)
    expect(events.filter(isResult)).toHaveLength(1)
  })

  it.skipIf(!lines.length)('init が / パレットの材料を持っている', () => {
    const init = events.find(isInit) as InitEvent
    // 素で録ると slash_commands 317 / skills 206 / agents 53(§5)。
    // safe 版はプラグインとスキルが落ちて 52 / 17 / 4 になるが、**空にはならない**
    // (組み込み分が残る。実測 2026-09-07)。数は環境で変わるので型と非空だけ見る。
    expect(init.slash_commands.length).toBeGreaterThan(0)
    expect(Array.isArray(init.terminal_slash_commands)).toBe(true)
    expect(Array.isArray(init.skills)).toBe(true)
    expect(Array.isArray(init.agents)).toBe(true)
    expect(typeof init.session_id).toBe('string')
  })

  it.skipIf(!lines.length)('ツール結果は type:"user" で来る(人間の発話と混ぜない)', () => {
    // §5 の観測。UI がここを取り違えると、ツール出力が発話として描かれる。
    for (const u of events.filter((e) => e.type === 'user')) {
      expect(u).toHaveProperty('message')
    }
  })

  it.skipIf(!lines.length)('assistant の本文が組み立てられる', () => {
    const texts = events
      .filter(isAssistant)
      .flatMap((e) => e.message.content)
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
    expect(texts.join('')).toMatch(/pong/i)
  })

  it.skipIf(!lines.length)('録画した版が MEASURED_CLI_VERSION と一致する', () => {
    const init = events.find(isInit) as InitEvent
    const drift = versionDrift(init)
    expect(drift.drifted, `fixture は ${drift.actual}、定数は ${drift.measured}`).toBe(false)
  })
})

/**
 * 手元にしか無い全記録に対する検査。
 *
 * CI にも他人の手元にも無いので `skipIf` で飛ばす —— ここだけは skip が正しい。
 * 「まだ録っていない」ではなく「**設計上 commit しない**」ものだからである。
 */
describe('全記録(gitignore・手元のみ)', () => {
  it.skipIf(!fullLines.length)('hook イベントもパースできる', () => {
    // safe 版には hook が出ない。パーサが hook を扱えることは full でしか見られない。
    const hooks = fullEvents.filter(
      (e) => e.type === 'system' && String((e as { subtype?: string }).subtype).startsWith('hook_')
    )
    expect(hooks.length).toBeGreaterThan(0)
  })

  it.skipIf(!fullLines.length)('プラグインを積んだ init のほうが厚い', () => {
    // safe 版だけを見ていると「slash_commands はこの程度」と誤解する。
    // 実際の利用環境ではこちらが本番の規模になる。
    const full = fullEvents.find(isInit) as InitEvent
    const safe = events.find(isInit) as InitEvent | undefined
    if (!safe) return
    expect(full.slash_commands.length).toBeGreaterThan(safe.slash_commands.length)
  })
})

describe('パースの端', () => {
  it('空行は blank', () => {
    expect(parseLine('')).toEqual({ kind: 'blank' })
    expect(parseLine('   ')).toEqual({ kind: 'blank' })
  })

  it('JSON でない行は握りつぶさず診断として返す', () => {
    // CLI の警告がここに混ざる。捨てると、警告が存在しないことになる。
    expect(parseLine('warning: something')).toEqual({
      kind: 'diagnostic',
      text: 'warning: something'
    })
  })

  it('type を持たない JSON も診断に落ちる', () => {
    expect(parseLine('{"foo":1}').kind).toBe('diagnostic')
    expect(parseLine('[1,2]').kind).toBe('diagnostic')
    expect(parseLine('null').kind).toBe('diagnostic')
  })

  it('未知の type は例外にせず、そのまま通す', () => {
    // 上流が新しいイベントを足しても、アプリが落ちてはいけない。
    expect(parseLine('{"type":"brand_new_event","x":1}').kind).toBe('event')
  })
})

describe('手元の CLI', () => {
  it('実測した版と同じ claude が入っている', () => {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8' })
    // izuna は claude が無いと動かない。無いことを緑で通さない。
    expect(r.status, 'claude が見つからない。izuna は claude CLI 無しでは動かない').toBe(0)
    const version = (r.stdout.match(/\d+\.\d+\.\d+/) ?? [''])[0]
    expect(
      version,
      `手元の claude は ${version}、実測は ${MEASURED_CLI_VERSION}。\n` +
        '  CLAUDE.md §5 を測り直し、fixture を録り直してから MEASURED_CLI_VERSION を更新すること。'
    ).toBe(MEASURED_CLI_VERSION)
  })
})

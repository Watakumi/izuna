import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  applyMessage,
  appendUserText,
  buildTranscript,
  emptyTranscript,
  plainText,
  type Block,
  type Item
} from '../src/shared/transcript'

/**
 * 会話の状態モデルに対する門（段1-b）。
 *
 * 録画に対して回すので、網も費用も要らない。ここが緑なら
 * 「描画がおかしい」ときの原因は必ず描画側にある、と言い切れる。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(ROOT, 'test', 'fixtures', 'transcript-tools.ndjson')

const messages: SDKMessage[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as SDKMessage)

const t = buildTranscript(messages)
const assistants = t.items.filter((i): i is Extract<Item, { kind: 'assistant' }> => i.kind === 'assistant')
const tools = assistants.flatMap((a) => a.blocks).filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')

describe('録画を通すと期待どおりの形になる', () => {
  it('init からセッションとモデルとコマンド一覧を拾う', () => {
    expect(t.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(t.model).toContain('haiku')
    expect(t.slashCommands.length).toBeGreaterThan(0)
  })

  it('assistant は message id ごとに 1 件にまとまる', () => {
    // SDK は 1 ブロックにつき 1 回 assistant を出す。足さずに置き換えると
    // 前のブロックが消えるので、ここが件数の門になる。
    const raw = messages.filter((m) => m.type === 'assistant').length
    expect(raw).toBeGreaterThan(assistants.length)
    expect(assistants).toHaveLength(3)
    expect(new Set(assistants.map((a) => a.id)).size).toBe(3)
  })

  it('ブロックの並びが崩れない', () => {
    expect(assistants.map((a) => a.blocks.map((b) => b.kind))).toEqual([
      ['thinking', 'tool'],
      ['thinking', 'tool'],
      ['thinking', 'text']
    ])
  })

  it('ツールは Write → Read の順で、両方に結果が畳み込まれている', () => {
    expect(tools.map((b) => b.name)).toEqual(['Write', 'Read'])
    for (const b of tools) {
      expect(b.state, `${b.name} の状態`).toBe('done')
      expect(b.result, `${b.name} の結果`).toBeTruthy()
    }
  })

  it('ツール入力が読める形で残る', () => {
    const write = tools[0].input as { file_path?: string; content?: string }
    expect(write.file_path).toContain('notes.txt')
    expect(write.content).toContain('hello izuna')
  })

  it('本文が一度だけ現れる（二重描画していない）', () => {
    const text = plainText(t)
    expect(text).toContain('hello izuna')
    // stream_event と assistant の両方を状態に入れると、ここで 2 になる
    expect(text.split('hello izuna')).toHaveLength(2)
  })

  it('終わったら draft が残らず、running が下りている', () => {
    expect(t.draft).toBeNull()
    expect(t.running).toBe(false)
    expect(t.costUsd).toBeGreaterThan(0)
  })
})

describe('途中経過は状態を汚さない', () => {
  it('流れている最中は draft に出る', () => {
    // content_block_stop の直前まで積むと、draft に文字が乗っている
    const upto = messages.findIndex((m) => m.type === 'stream_event' && m.event.type === 'content_block_stop')
    const mid = messages.slice(0, upto).reduce(applyMessage, emptyTranscript())
    expect(mid.draft).not.toBeNull()
    expect(mid.draft?.kind).toBe('thinking')
  })

  it('ブロックが閉じたら draft を捨てる', () => {
    const upto = messages.findIndex((m) => m.type === 'stream_event' && m.event.type === 'content_block_stop')
    const closed = messages.slice(0, upto + 1).reduce(applyMessage, emptyTranscript())
    expect(closed.draft).toBeNull()
  })

  it('stream_event を全部落としても確定状態は変わらない', () => {
    // これが成り立つ限り、途中経過は表示専用であって状態ではない
    const withoutStream = buildTranscript(messages.filter((m) => m.type !== 'stream_event'))
    expect(withoutStream.items).toEqual(t.items)
  })

  it('セッションが 2 本あっても互いに干渉しない', () => {
    // モジュール変数に message id を置くと、ここで混ざる
    let a = emptyTranscript()
    let b = emptyTranscript()
    for (const m of messages) {
      a = applyMessage(a, m)
      b = applyMessage(b, m)
    }
    expect(a.items).toEqual(b.items)
    expect(a.items).toEqual(t.items)
  })
})

describe('人間の発話', () => {
  it('SDK のストリームには戻ってこないので、送った側で足す', () => {
    expect(messages.some((m) => m.type === 'user' && typeof m.message.content === 'string')).toBe(false)
    const withUser = appendUserText(emptyTranscript(), 'やって', 'u1')
    expect(withUser.items).toEqual([{ kind: 'user', id: 'u1', text: 'やって' }])
    expect(withUser.running).toBe(true)
  })
})

describe('未知のものを落とさない', () => {
  it('知らない type が来ても状態を壊さない', () => {
    const before = buildTranscript(messages)
    const after = applyMessage(before, { type: 'brand_new_event' } as unknown as SDKMessage)
    expect(after).toEqual(before)
  })
})

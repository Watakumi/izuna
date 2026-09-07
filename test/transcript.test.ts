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
  markDenied,
  plainText,
  stripAnsi,
  setPermissionMode,
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

describe('拒否の判定', () => {
  const toolId = 'toolu_x'
  const userMsg = (isError: boolean, text: string): SDKMessage => ({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId, content: text, is_error: isError }] },
    parent_tool_use_id: null, session_id: 's', uuid: 'u'
  } as unknown as SDKMessage)
  const withTool = (): ReturnType<typeof emptyTranscript> =>
    applyMessage(emptyTranscript(), {
      type: 'assistant', parent_tool_use_id: null, session_id: 's', uuid: 'u',
      message: { id: 'm1', model: 'x', role: 'assistant', stop_reason: null,
        content: [{ type: 'tool_use', id: toolId, name: 'Write', input: {} }] }
    } as unknown as SDKMessage)

  const stateOf = (t: ReturnType<typeof emptyTranscript>): string => {
    const a = t.items.find((i) => i.kind === 'assistant')
    const b = a && a.kind === 'assistant' ? a.blocks[0] : undefined
    return b && b.kind === 'tool' ? b.state : '?'
  }

  it('EACCES はファイルシステムの失敗であって、人間の拒否ではない', () => {
    // 文面の /permission/i で当てていたときはここが denied になっていた
    const t2 = applyMessage(withTool(), userMsg(true, "EACCES: permission denied, mkdir '/Users/x'"))
    expect(stateOf(t2)).toBe('error')
  })

  it('自分が拒否したものだけ denied になる', () => {
    const t2 = applyMessage(markDenied(withTool(), toolId), userMsg(true, '拒否しました'))
    expect(stateOf(t2)).toBe('denied')
  })

  it('成功は done', () => {
    expect(stateOf(applyMessage(withTool(), userMsg(false, 'ok')))).toBe('done')
  })

  it('markDenied は同じ id を重ねない', () => {
    const once = markDenied(emptyTranscript(), toolId)
    expect(markDenied(once, toolId).deniedToolUseIds).toEqual([toolId])
    expect(markDenied(once, undefined)).toEqual(once)
  })
})

describe('枠の使用率', () => {
  it('rate_limit_event から拾う', () => {
    // 金額（costBasis: "list"）は請求額ではないので画面に出さない。
    // 実際の制約はこちらで、ターミナルの Claude Code と同じ窓を共有する
    expect(t.limits).not.toBeNull()
    expect(t.limits!.fiveHour).toBeGreaterThanOrEqual(0)
    expect(t.limits!.fiveHour).toBeLessThanOrEqual(1)
    expect(t.limits!.sevenDay).toBeGreaterThanOrEqual(0)
  })

  it('片方しか来なくても前の値を保つ', () => {
    const seeded = { ...emptyTranscript(), limits: { fiveHour: 0.3, sevenDay: 0.5 } }
    const next = applyMessage(seeded, {
      type: 'rate_limit_event',
      rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.4 } } }
    } as unknown as SDKMessage)
    expect(next.limits).toEqual({ fiveHour: 0.4, sevenDay: 0.5 })
  })
})

describe('権限モードと稼働状態', () => {
  it('init のモードを起点にする', () => {
    expect(t.permissionMode).toBe('default')
  })

  it('モード変更の通知イベントは無いので、状態は持つしかない', () => {
    // 上流が通知を出すようになったらこの検査は落ちる。そのとき設計を見直す
    const hasNotice = messages.some(
      (m) => m.type === 'system' && String((m as { subtype?: string }).subtype).includes('permission_mode')
    )
    expect(hasNotice).toBe(false)
    expect(setPermissionMode(t, 'plan').permissionMode).toBe('plan')
    // ほかは変えない
    expect(setPermissionMode(t, 'plan').items).toEqual(t.items)
  })

  it('session_state_changed で稼働状態を取る', () => {
    const running = applyMessage(emptyTranscript(), {
      type: 'system', subtype: 'session_state_changed', state: 'running',
      uuid: 'u', session_id: 's'
    } as unknown as SDKMessage)
    expect(running.state).toBe('running')
    expect(applyMessage(running, {
      type: 'system', subtype: 'session_state_changed', state: 'requires_action',
      uuid: 'u', session_id: 's'
    } as unknown as SDKMessage).state).toBe('requires_action')
  })
})

describe('端末のエスケープシーケンス', () => {
  it('色を落とす', () => {
    // git -c color.ui=always が実際に吐く形
    expect(stripAnsi('\u001B[31m??\u001B[m src/a.ts')).toBe('?? src/a.ts')
  })

  it('OSC（タイトル・ハイパーリンク）も落とす', () => {
    expect(stripAnsi('\u001B]8;;https://x\u0007link\u001B]8;;\u0007')).toBe('link')
  })

  it('普通の文字列は触らない', () => {
    expect(stripAnsi('hello izuna\n2 passed')).toBe('hello izuna\n2 passed')
  })

  it('録画には元々入っていない（Bash は TTY 無しで動くため）', () => {
    // 段6 で ghostty-web を入れたら、落とさずに描くようにする
    const raw = readFileSync(FIXTURE, 'utf8')
    expect(/\\u001[bB]/.test(raw)).toBe(false)
  })
})

describe('未知のものを落とさない', () => {
  it('知らない type が来ても状態を壊さない', () => {
    const before = buildTranscript(messages)
    const after = applyMessage(before, { type: 'brand_new_event' } as unknown as SDKMessage)
    expect(after).toEqual(before)
  })
})

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { buildTranscript, plainText, type Block, type Item } from '../src/shared/transcript'

/**
 * ブレインと実行役に対する門（段4）。
 *
 * **実行役の発話をブレインの会話に混ぜない**のが要。混ぜると誰が言ったのか
 * 分からなくなり、承認の判断も鈍る。録画で固定しておく。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = join(ROOT, 'test', 'fixtures', 'transcript-teammate.ndjson')

const messages: SDKMessage[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as SDKMessage)

const t = buildTranscript(messages)
const task = t.tasks[0]

describe('実行役を拾う', () => {
  it('1 人起きている', () => {
    expect(t.tasks).toHaveLength(1)
    expect(task.subagentType).toBe('general-purpose')
    expect(task.backgrounded).toBe(false)
  })

  it('ライフサイクルの終わりまで追える', () => {
    // task_started → task_progress → task_updated(patch.status) → task_notification
    expect(task.status).toBe('completed')
    expect(task.summary).toContain('from-executor.txt')
    expect(task.lastTool).toBe('Write')
    expect(task.usage?.toolUses).toBeGreaterThan(0)
  })

  it('ブレインの tool_use と同じ id で繋がる', () => {
    const brainTools = t.items
      .flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
      .filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')
    expect(brainTools.some((b) => b.id === task.toolUseId)).toBe(true)
  })

  it('依頼の本文が残る（あとで共有フォルダに書き出すため）', () => {
    expect(task.prompt).toContain('from-executor.txt')
  })
})

describe('ブレインと実行役を混ぜない', () => {
  it('実行役の発話は tasks 側にだけ入る', () => {
    expect(task.blocks.length).toBeGreaterThan(0)
    const executorText = task.blocks
      .filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
      .map((b) => b.text)
      .join('')
    expect(executorText).toContain('from-executor.txt')
    // ブレインの本文には出てこない
    expect(plainText(t)).not.toContain(executorText)
  })

  it('実行役のツールと結果も tasks 側で閉じる', () => {
    const tools = task.blocks.filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')
    expect(tools.map((b) => b.name)).toContain('Write')
    for (const b of tools) expect(b.state).toBe('done')
  })

  it('ブレインの会話には Agent の呼び出しだけが残る', () => {
    const names = t.items
      .flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
      .filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')
      .map((b) => b.name)
    expect(names).toContain('Agent')
    // 実行役が使った Write がブレイン側に現れてはいけない
    expect(names).not.toContain('Write')
  })

  it('実行役の逐次差分でブレインの途中経過を上書きしない', () => {
    expect(t.draft).toBeNull()
  })
})

describe('会話の並び', () => {
  it('ブレインの assistant は message id ごとにまとまる', () => {
    const assistants = t.items.filter((i): i is Extract<Item, { kind: 'assistant' }> => i.kind === 'assistant')
    const raw = messages.filter((m) => m.type === 'assistant' && !m.parent_tool_use_id).length
    expect(assistants.length).toBeLessThan(raw)
    expect(new Set(assistants.map((a) => a.id)).size).toBe(assistants.length)
  })
})

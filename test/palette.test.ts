import { describe, expect, it } from 'vitest'
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import {
  applyCompletion,
  filterCommands,
  originOf,
  parseSlashInput
} from '../src/shared/palette'

/**
 * `/` パレットの絞り込みに対する門。
 *
 * ここは Izuna の差別化の本体なので、「それらしく動く」では足りない。
 * **打った人が期待する順に出ること**を具体例で固定する。
 */

const cmd = (name: string, description = '', argumentHint = '', aliases?: string[]): SlashCommand =>
  ({ name, description, argumentHint, ...(aliases ? { aliases } : {}) }) as SlashCommand

const SET: SlashCommand[] = [
  cmd('code-review', '差分を正しさと簡潔さの観点でレビューする', '[level] [--fix]'),
  cmd('review-pr', '専用エージェントで PR を通しでレビューする', '<pr>'),
  cmd('security-review', '脆弱性の観点で変更を点検する'),
  cmd('commit', '変更をコミットする'),
  cmd('compact', '会話を圧縮する'),
  cmd('usage', '使用量を見る', '', ['cost', 'stats']),
  cmd('init', 'CLAUDE.md を作る')
]

const names = (q: string): string[] => filterCommands(q, SET).map((s) => s.command.name)

describe('打った人が期待する順に出る', () => {
  it('完全一致が最上位', () => {
    expect(names('commit')[0]).toBe('commit')
  })

  it('前方一致は部分列より上', () => {
    // 'co' は commit/compact に前方一致し、code-review にも当たる
    const top2 = names('co').slice(0, 3)
    expect(top2).toContain('commit')
    expect(top2).toContain('compact')
  })

  it('語頭に当たるものを優先する', () => {
    // 'rev' は review-pr（語頭）と code-review（途中）の両方に当たる
    const r = names('rev')
    expect(r.indexOf('review-pr')).toBeLessThan(r.indexOf('code-review'))
  })

  it('飛び飛びでも当たる', () => {
    expect(names('crv')).toContain('code-review')
  })

  it('当たらないものは出さない', () => {
    expect(names('zzzz')).toEqual([])
  })

  it('空の問い合わせは全部返す', () => {
    expect(filterCommands('', SET)).toHaveLength(SET.length)
  })
})

describe('名前で当たらないときは説明で拾う', () => {
  it('「脆弱性」で security-review が出る', () => {
    const r = filterCommands('脆弱性', SET)
    expect(r.map((s) => s.command.name)).toEqual(['security-review'])
    expect(r[0].viaDescription).toBe(true)
  })

  it('1 文字では説明を引かない（雑に当たりすぎる）', () => {
    expect(filterCommands('る', SET)).toHaveLength(0)
  })

  it('名前で当たったものは説明扱いにしない', () => {
    expect(filterCommands('commit', SET)[0].viaDescription).toBe(false)
  })
})

describe('別名', () => {
  it('cost で usage が出る', () => {
    const r = filterCommands('cost', SET)
    expect(r[0].command.name).toBe('usage')
    expect(r[0].viaAlias).toBe('cost')
  })

  it('正式名で当たったほうが別名より上', () => {
    // 'us' は usage の前方一致。別名経由より優先される
    expect(filterCommands('us', SET)[0].viaAlias).toBeNull()
  })
})

describe('強調のための位置', () => {
  it('前方一致では打った長さぶん返る', () => {
    expect(filterCommands('com', SET)[0].matches).toEqual([0, 1, 2])
  })

  it('飛び飛びの位置がそのまま返る', () => {
    const s = filterCommands('crv', SET).find((x) => x.command.name === 'code-review')
    expect(s?.matches).toHaveLength(3)
    expect(s?.matches[0]).toBe(0)
    // 位置は昇順でなければ強調がずれる
    expect(s?.matches).toEqual([...(s?.matches ?? [])].sort((a, b) => a - b))
  })
})

describe('入力欄の解釈', () => {
  it('/ で始まる 1 行目だけを見る', () => {
    expect(parseSlashInput('/code-review high')).toEqual({ name: 'code-review', args: 'high' })
    expect(parseSlashInput('/commit')).toEqual({ name: 'commit', args: '' })
  })

  it('本文の途中の / には反応しない（パスを書いているだけのことが多い）', () => {
    expect(parseSlashInput('src/main を直して')).toBeNull()
    expect(parseSlashInput('これを見て /tmp/a.txt')).toBeNull()
  })

  it('2 行目以降は引数に含めない', () => {
    expect(parseSlashInput('/review-pr 12\nあと説明もお願い')).toEqual({ name: 'review-pr', args: '12' })
  })

  it('確定すると引数を打てる形になる', () => {
    expect(applyCompletion(cmd('commit'), '')).toBe('/commit ')
    expect(applyCompletion(cmd('review-pr'), '12')).toBe('/review-pr 12')
  })
})

describe('後ろに下げるもの', () => {
  const SET2: SlashCommand[] = [
    ...SET,
    cmd('__remote-workflow', 'Run the workflow script delivered in this session environment'),
    cmd('agents', '(removed) Ask Claude to create/manage subagents')
  ]
  const names2 = (q: string): string[] => filterCommands(q, SET2).map((s) => s.command.name)

  it('空の問い合わせで内部用と廃止済みが先頭に来ない', () => {
    // 全員同点だと名前順になり、`_` 始まりが最初に来てしまう
    const top = filterCommands('', SET2).slice(0, 3).map((s) => s.command.name)
    expect(top).not.toContain('__remote-workflow')
    expect(top).not.toContain('agents')
  })

  it('隠さない。打てば出る', () => {
    expect(names2('remote')).toContain('__remote-workflow')
    expect(names2('agents')).toContain('agents')
  })

  it('同じ当たり方なら普通のものが上', () => {
    // 'age' は agents（廃止済み・前方一致）と usage（部分列）の両方に当たる。
    // 素の点数なら前方一致の agents が上に来るが、廃止済みなので下がる
    const r = names2('age')
    expect(r).toContain('agents')
    expect(r).toContain('usage')
    expect(r.indexOf('agents')).toBeGreaterThan(r.indexOf('usage'))
  })
})

describe('出どころ', () => {
  it('名前空間つきを見分ける', () => {
    expect(originOf(cmd('everything-claude-code:code-review'))).toEqual({
      kind: 'namespaced', namespace: 'everything-claude-code'
    })
    expect(originOf(cmd('commit'))).toEqual({ kind: 'plain', namespace: null })
  })
})

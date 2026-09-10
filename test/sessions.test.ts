import { describe, expect, it } from 'vitest'
import {
  belongsTo,
  byNewest,
  filterSessions,
  labelOf,
  persistedOutputPath,
  replay,
  replayTask,
  summarize,
  withPersistedOutput,
  type SessionSummary
} from '../src/shared/sessions'

/**
 * ここの入力は**録画ではなく手で書いた**（`test/fixtures/*.ndjson` とは性格が違う）。
 * 形は実測（CLAUDE.md §18）に合わせてあるが、実物の記録は私的な会話を含むので
 * 版管理に入れない —— §11 と同じ理由である。
 */

const j = (o: unknown): string => JSON.stringify(o)
const meta = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', updatedAt: 1_000, bytes: 42 }

describe('一覧の要約', () => {
  const head = [
    j({ type: 'last-prompt', sessionId: meta.id }),
    j({
      type: 'user',
      cwd: '/Users/x/work/repo',
      gitBranch: 'main',
      version: '2.1.263',
      origin: { kind: 'human' },
      message: { content: 'はじめの発話' }
    })
  ]
  const tail = [
    j({ type: 'ai-title', aiTitle: '古い題名' }),
    j({ type: 'assistant', slug: 'happy-jingling-cherny', message: { content: [] } }),
    j({ type: 'ai-title', aiTitle: '新しい題名' })
  ]

  it('頭から cwd・ブランチ・版・最初の発話を取る', () => {
    const s = summarize(head, tail, meta)
    expect(s.cwd).toBe('/Users/x/work/repo')
    expect(s.branch).toBe('main')
    expect(s.cliVersion).toBe('2.1.263')
    expect(s.firstPrompt).toBe('はじめの発話')
  })

  it('題名は最後のものを採る（会話が進むと付け直される）', () => {
    expect(summarize(head, tail, meta).title).toBe('新しい題名')
  })

  it('コードネームを拾う', () => {
    expect(summarize(head, tail, meta).slug).toBe('happy-jingling-cherny')
  })

  it('壊れた行があっても落ちない（書き込み中の末尾は千切れている）', () => {
    const broken = ['{"type":"user","message":{"content":"生き残る', '', ...head]
    expect(summarize(broken, tail, meta).firstPrompt).toBe('はじめの発話')
  })
})

describe('人間の発話の判定', () => {
  /**
   * これが今回の実装で最初に間違えたところ。`origin.kind === 'human'` で
   * 判定すると、**SDK 経由（＝ Izuna 自身）のセッションだけ**見出しが出ない。
   */
  it('origin が無い SDK 経由のセッションでも発話を拾う', () => {
    const head = [
      j({
        type: 'user',
        cwd: '/w',
        origin: null,
        promptSource: 'sdk',
        entrypoint: 'sdk-cli',
        message: { content: 'Reply with exactly: pong' }
      })
    ]
    expect(summarize(head, [], meta).firstPrompt).toBe('Reply with exactly: pong')
  })

  it('ツール結果は発話ではない', () => {
    const head = [
      j({
        type: 'user',
        cwd: '/w',
        message: { content: [{ type: 'tool_result', content: 'ok' }] }
      }),
      j({ type: 'user', cwd: '/w', message: { content: '本当の発話' } })
    ]
    expect(summarize(head, [], meta).firstPrompt).toBe('本当の発話')
  })

  it('CLI が差し込んだ本文を見出しにしない', () => {
    const head = [
      j({
        type: 'user',
        isMeta: true,
        cwd: '/w',
        message: { content: '<local-command-caveat>Caveat…' }
      }),
      j({ type: 'user', cwd: '/w', message: { content: '<command-name>/agents</command-name>' } }),
      j({ type: 'user', cwd: '/w', message: { content: '人の発話' } })
    ]
    expect(summarize(head, [], meta).firstPrompt).toBe('人の発話')
  })
})

describe('見出しの落とし方', () => {
  const base: SessionSummary = {
    id: 'abcdef12-0000-0000-0000-000000000000',
    cwd: '/w',
    title: null,
    slug: null,
    firstPrompt: null,
    branch: null,
    cliVersion: null,
    updatedAt: 0,
    bytes: 0
  }

  it('題名 → 最初の発話 → コードネーム → id の順に落ちる', () => {
    expect(labelOf({ ...base, title: 'T', firstPrompt: 'F', slug: 'S' })).toBe('T')
    expect(labelOf({ ...base, firstPrompt: 'F', slug: 'S' })).toBe('F')
    expect(labelOf({ ...base, slug: 'S' })).toBe('S')
    expect(labelOf(base)).toBe('abcdef12')
  })

  it('長い発話は詰める。改行は畳む', () => {
    expect(labelOf({ ...base, firstPrompt: `a\n\nb${'x'.repeat(100)}` })).toHaveLength(60)
  })
})

describe('どのリポジトリのものか', () => {
  const s = (cwd: string): SessionSummary => ({
    id: 'i',
    cwd,
    title: null,
    slug: null,
    firstPrompt: null,
    branch: null,
    cliVersion: null,
    updatedAt: 0,
    bytes: 0
  })

  it('worktree のセッションも同じリポジトリとして拾う', () => {
    expect(belongsTo(s('/w/repo'), '/w/repo')).toBe(true)
    expect(belongsTo(s('/w/repo/src'), '/w/repo')).toBe(true)
    expect(belongsTo(s('/wt/feat'), '/w/repo', ['/wt/feat'])).toBe(true)
  })

  it('名前が前方一致するだけの別リポジトリを拾わない', () => {
    expect(belongsTo(s('/w/repo-old'), '/w/repo')).toBe(false)
  })

  it('cwd が読めなかったものは含めない', () => {
    expect(belongsTo({ ...s('/w/repo'), cwd: null }, '/w/repo')).toBe(false)
  })
})

describe('並びと絞り込み', () => {
  const mk = (id: string, updatedAt: number, title: string): SessionSummary => ({
    id,
    cwd: '/w',
    title,
    slug: null,
    firstPrompt: null,
    branch: null,
    cliVersion: null,
    updatedAt,
    bytes: 0
  })
  const list = [mk('b', 1, '設計の見直し'), mk('a', 1, 'padding の検査'), mk('c', 9, '最新')]

  it('新しい順。同着は id で決める（呼ぶたびに並びが変わらない）', () => {
    expect([...list].sort(byNewest).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('題名で絞り込める', () => {
    expect(filterSessions(list, 'padding').map((s) => s.id)).toEqual(['a'])
  })

  it('空の問い合わせは全部を新しい順で返す', () => {
    expect(filterSessions(list, '  ').map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('会話の復元', () => {
  const lines = [
    j({ type: 'user', origin: { kind: 'human' }, message: { content: 'やって' } }),
    j({
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'はい' },
          { type: 'tool_use', id: 'toolu_1', name: 'Write', input: { file_path: '/a' } }
        ]
      }
    }),
    j({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }
    })
  ]

  it('発話と応答が並ぶ', () => {
    const t = replay(lines)
    expect(t.items.map((i) => i.kind)).toEqual(['user', 'assistant'])
  })

  it('本文の無い thinking は捨てる（記録に思考は残っていない）', () => {
    const t = replay(lines)
    const blocks = t.items.flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
    expect(blocks.some((b) => b.kind === 'thinking')).toBe(false)
    expect(blocks.filter((b) => b.kind === 'text')).toHaveLength(1)
  })

  it('ツール結果が対応するツールに付く', () => {
    const blocks = replay(lines).items.flatMap((i) => (i.kind === 'assistant' ? i.blocks : []))
    const tool = blocks.find((b) => b.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', name: 'Write', state: 'done' })
  })

  it('実行役の発話をブレインの会話に混ぜない', () => {
    const withSide = [
      ...lines,
      j({
        type: 'assistant',
        isSidechain: true,
        message: { id: 'm2', content: [{ type: 'text', text: '実行役' }] }
      })
    ]
    expect(replay(withSide).items).toHaveLength(2)
  })

  it('**貼った画像は復元でも残る**（何を見せたのかが分からないと返事の意味も分からない）', () => {
    const withImage = [
      j({
        type: 'user',
        origin: { kind: 'human' },
        message: {
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' }
            },
            { type: 'text', text: 'この画面のここ' }
          ]
        }
      })
    ]
    const item = replay(withImage).items[0]
    expect(item).toMatchObject({
      kind: 'user',
      text: 'この画面のここ',
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }]
    })
  })

  it('画像の無い発話には images を付けない（形を増やさない）', () => {
    expect(replay(lines).items[0]).not.toHaveProperty('images')
  })

  it('復元した時点では走っていない（走ったままだと止められない画面になる）', () => {
    expect(replay(lines).running).toBe(false)
    expect(replay(lines).draft).toBeNull()
  })
})

describe('外に逃がされたツール出力', () => {
  /**
   * 巨大な出力は `<sessionId>/tool-results/*.txt` に逃がされ、記録には印だけが残る。
   * **読まないと抜粋しか復元されない**（実測で 23 セッション該当）。
   */
  const MARK = [
    '<persisted-output>',
    'Output too large (33.5KB). Full output saved to: /x/tool-results/abc.txt',
    '</persisted-output>'
  ].join('\n')

  it('印からパスを取り出す', () => {
    expect(persistedOutputPath(MARK)).toBe('/x/tool-results/abc.txt')
  })

  it('印が無ければ null', () => {
    expect(persistedOutputPath('ふつうの出力')).toBeNull()
  })

  it('印を中身で置き換える', () => {
    expect(withPersistedOutput(`前${MARK}後`, '本当の中身')).toBe('前本当の中身後')
  })

  it('印が無ければ何もしない', () => {
    expect(withPersistedOutput('そのまま', 'x')).toBe('そのまま')
  })
})

describe('実行役の記録', () => {
  /**
   * `<sessionId>/subagents/agent-<id>.jsonl`。実測で 154 本あった。
   * **全行が `isSidechain`** なので、親の会話と同じ扱いで読むと空になる。
   */
  const lines = [
    j({ type: 'user', isSidechain: true, message: { content: 'この関数を調べて' } }),
    j({
      type: 'assistant',
      isSidechain: true,
      message: { id: 'm1', content: [{ type: 'text', text: '調べました' }] }
    })
  ]

  it('ファイルそのものを 1 件の実行役として組み立てる', () => {
    const t = replayTask('a1b2c3', lines)!
    expect(t.taskId).toBe('a1b2c3')
    expect(t.description).toContain('この関数')
    expect(t.blocks).toHaveLength(1)
  })

  it('**記録から読んだ時点で、その実行役は走っていない**', () => {
    expect(replayTask('a1', lines)!.status).toBe('completed')
  })

  it('親のツール呼び出しには紐付けない（task_* は記録に残らない）', () => {
    expect(replayTask('a1', lines)!.toolUseId).toBeNull()
  })

  it('中身が無ければ null（空の札を並べない）', () => {
    expect(replayTask('a1', ['', '{壊れている'])).toBeNull()
  })

  it('親の会話を読むときは sidechain を飛ばす（混ぜない）', () => {
    expect(replay(lines).items).toHaveLength(0)
  })
})

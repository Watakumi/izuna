import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, type Inline, type Node } from '../src/shared/markdown'

/**
 * 会話の本文に対する門。
 *
 * **逐次描画の途中の文字列が必ず通る**ので、閉じていない印で壊れないことを
 * 重点的に見る。壊れると会話そのものが読めなくなる。
 */

/** 木を読みやすい文字列にして比べる（構造だけ見たいとき用） */
const flat = (ns: Inline[]): string =>
  ns.map((n) => (n.kind === 'text' ? n.text : n.kind === 'code' ? `<${n.text}>` : `${n.kind}(${flat(n.children)})`)).join('')

describe('行内', () => {
  it('強調を取る', () => {
    expect(flat(parseInline('これは **太字** です'))).toBe('これは strong(太字) です')
  })

  it('日本語に貼り付いていても取る（英語の語境界に頼らない）', () => {
    expect(flat(parseInline('現状は**MVP 完了**、次は'))).toBe('現状はstrong(MVP 完了)、次は')
  })

  it('コードの中の記号は記号のまま', () => {
    expect(flat(parseInline('`a * b * c` を見る'))).toBe('<a * b * c> を見る')
  })

  it('閉じていない印はそのまま文字にする（消さない）', () => {
    expect(flat(parseInline('書きかけの **太字'))).toBe('書きかけの **太字')
    expect(flat(parseInline('`閉じないコード'))).toBe('`閉じないコード')
  })

  it('中身が空の強調は印のまま', () => {
    expect(flat(parseInline('****'))).toBe('****')
  })

  it('リンク', () => {
    const [n] = parseInline('[説明](https://example.com)')
    expect(n).toMatchObject({ kind: 'link', href: 'https://example.com' })
  })

  it('入れ子', () => {
    expect(flat(parseInline('**太字の中の `code`**'))).toBe('strong(太字の中の <code>)')
  })

  it('掛け算の * を強調にしない（閉じないので文字のまま）', () => {
    expect(flat(parseInline('2 * 3 = 6'))).toBe('2 * 3 = 6')
  })
})

describe('塊', () => {
  const kinds = (src: string): string[] => parseMarkdown(src).map((n) => n.kind)

  it('見出し', () => {
    const [n] = parseMarkdown('## 見出し')
    expect(n).toMatchObject({ kind: 'heading', level: 2 })
  })

  it('箇条書き', () => {
    const [n] = parseMarkdown('- 一\n- 二\n- 三')
    expect(n.kind === 'list' && n.items).toHaveLength(3)
    expect(n.kind === 'list' && n.ordered).toBe(false)
  })

  it('番号付きは開始番号を覚える', () => {
    const [n] = parseMarkdown('3. 三\n4. 四')
    expect(n).toMatchObject({ kind: 'list', ordered: true, start: 3 })
  })

  it('入れ子を 1 段だけ持つ', () => {
    const [n] = parseMarkdown('- 親\n  - 子\n- 親2')
    if (n.kind !== 'list') throw new Error('list ではない')
    expect(n.items).toHaveLength(2)
    expect(n.items[0].sub?.kind).toBe('list')
  })

  it('コードは中の記号を解釈しない', () => {
    const [n] = parseMarkdown('```ts\nconst a = **b**\n```')
    expect(n).toMatchObject({ kind: 'code', lang: 'ts', text: 'const a = **b**' })
  })

  it('閉じていないコードでも、そこまでを出す（逐次描画の途中）', () => {
    const [n] = parseMarkdown('```\n書きかけ')
    expect(n).toMatchObject({ kind: 'code', text: '書きかけ' })
  })

  it('表', () => {
    const [n] = parseMarkdown('| 名前 | 値 |\n| --- | ---: |\n| a | 1 |\n| b | 2 |')
    if (n.kind !== 'table') throw new Error('table ではない')
    expect(n.header).toHaveLength(2)
    expect(n.rows).toHaveLength(2)
    expect(n.align).toEqual(['left', 'right'])
  })

  it('区切りが無ければ表にしない（| を含むただの文）', () => {
    expect(kinds('a | b\nc | d')).toEqual(['p'])
  })

  it('引用は中も解釈する', () => {
    const [n] = parseMarkdown('> ## 中の見出し')
    expect(n.kind === 'quote' && n.children[0].kind).toBe('heading')
  })

  it('区切り線', () => {
    expect(kinds('---')).toEqual(['hr'])
    expect(kinds('***')).toEqual(['hr'])
  })

  it('段落は空行で切れる', () => {
    expect(kinds('一行目\n続き\n\n別の段落')).toEqual(['p', 'p'])
  })

  it('段落の直後の箇条書きを飲み込まない', () => {
    expect(kinds('前置き\n- 一\n- 二')).toEqual(['p', 'list'])
  })

  it('空の入力は空', () => {
    expect(parseMarkdown('')).toEqual([])
    expect(parseMarkdown('\n\n  \n')).toEqual([])
  })
})

describe('実際に出た文面', () => {
  // 画面写真から起こしたもの（2026-09-08）
  const REAL = [
    'CLAUDE.md を読む限り、現状は **MVP 完了・`pnpm verify` は緑（207件）**、次は v1 の 7 手を通しで実機確認、という段階です。',
    '',
    '- **v1 の 7 手を通しで実機確認**（docs/GOAL.md の次のステップ）',
    '- **§9-5: `interrupt()` の SIGINT 疑い** — 未計測'
  ].join('\n')

  it('段落と箇条書きに分かれる', () => {
    const ns: Node[] = parseMarkdown(REAL)
    expect(ns.map((n) => n.kind)).toEqual(['p', 'list'])
  })

  it('** も ` も文字として残らない', () => {
    const text = JSON.stringify(parseMarkdown(REAL))
    expect(text).not.toContain('**')
    expect(text).not.toContain('`')
  })
})

describe('画像', () => {
  it('`![alt](src)` を画像として読む', () => {
    expect(parseInline('![図](/a.png)')).toEqual([{ kind: 'image', src: '/a.png', alt: '図' }])
  })

  it('**リンクより先に見る**（順が逆だと画像がリンクになる）', () => {
    const [n] = parseInline('![図](/a.png)')
    expect(n.kind).toBe('image')
  })

  it('`!` の付かないものはリンクのまま', () => {
    const [n] = parseInline('[図](/a.png)')
    expect(n.kind).toBe('link')
  })

  it('閉じていなければただの文字', () => {
    expect(parseInline('![図(/a.png')).toEqual([{ kind: 'text', text: '![図(/a.png' }])
  })

  it('alt が空でも読む', () => {
    expect(parseInline('![](/a.png)')).toEqual([{ kind: 'image', src: '/a.png', alt: '' }])
  })
})

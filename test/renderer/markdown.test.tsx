// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { Markdown } from '../../src/renderer/src/components/Markdown'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

/**
 * 会話の本文を**実際に描いて**確かめる（§28）。
 * それまで renderer は撮影でしか見ておらず、通っても壊れていても分からない場面があった。
 */

vi.mock('mermaid', () => ({
  default: {
    initialize: (): void => {},
    render: async (id: string, text: string) => {
      if (text.includes('ではない')) throw new Error('Parse error on line 1')
      return { svg: `<svg id="${id}"><text>図</text></svg>` }
    }
  }
}))

describe('本文', () => {
  it('見出しは本文より小さくしない。段は色と余白で分ける', () => {
    const { container } = render(<Markdown text={'# 大\n\n## 中\n\n### 小\n\n本文'} />)
    const divs = [...container.querySelectorAll('div')].filter((d) => /^(大|中|小)$/.test(d.textContent ?? ''))
    const size = (d: Element): number => parseFloat((d as HTMLElement).style.fontSize)
    expect(size(divs[0])).toBeGreaterThan(size(divs[1]))
    expect(size(divs[1])).toBe(size(divs[2]))
    expect((divs[2] as HTMLElement).style.color).not.toBe((divs[1] as HTMLElement).style.color)
  })

  it('**言語名を pre の中に入れない**（1 行目のコードとして読める）', () => {
    const { container } = render(<Markdown text={'```ts\nconst a = 1\n```'} />)
    const pre = container.querySelector('pre')!
    expect(pre.textContent).toBe('const a = 1')
    expect(container.textContent).toContain('ts')
  })

  it('リンクは新しい窓で。素の遷移でアプリの窓を失わない', () => {
    render(<Markdown text="[docs](https://example.com/x)" />)
    const a = screen.getByText('docs').closest('a')!
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('href')).toBe('https://example.com/x')
  })

  it('**外の画像は出さない**（会話を開いただけで取りに行く）。手元と data: は出す', () => {
    const { container } = render(<Markdown text={'![遠](https://evil.example/t.png)\n\n![近](data:image/png;base64,AAAA)'} />)
    const imgs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(imgs).toEqual(['data:image/png;base64,AAAA'])
    expect(container.textContent).toContain('遠')
  })

  it('表・箇条書き・引用・区切りを描く', () => {
    const { container } = render(<Markdown text={'| a | b |\n| --- | ---: |\n| 1 | 2 |\n\n- x\n  - y\n\n> 引用\n\n---'} />)
    expect(container.querySelectorAll('th')).toHaveLength(2)
    expect(container.querySelectorAll('td')[1].getAttribute('style')).toContain('text-align: right')
    expect(container.textContent).toContain('y')
    expect(container.textContent).toContain('引用')
  })
})

describe('mermaid', () => {
  it('落ち着いてから図にする。それまでは字を出す', async () => {
    const { container } = render(<Markdown text={'```mermaid\nflowchart LR\n  A --> B\n```'} />)
    expect(container.querySelector('pre')?.textContent).toContain('A --> B')
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull(), { timeout: 2000 })
    expect(screen.getByText('字で見る')).toBeTruthy()
  })

  it('**図にできなくても字は失わない**。理由を添える', async () => {
    const { container } = render(<Markdown text={'```mermaid\nこれは mermaid ではない\n```'} />)
    await waitFor(() => expect(container.textContent).toContain('図にできません'), { timeout: 2000 })
    expect(container.textContent).toContain('これは mermaid ではない')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('字と図を切り替えられる', async () => {
    const { container } = render(<Markdown text={'```mermaid\nflowchart LR\n  A --> B\n```'} />)
    await waitFor(() => expect(container.querySelector('svg')).not.toBeNull(), { timeout: 2000 })
    screen.getByText('字で見る').click()
    await waitFor(() => expect(container.querySelector('svg')).toBeNull())
    expect(screen.getByText('図で見る')).toBeTruthy()
  })
})

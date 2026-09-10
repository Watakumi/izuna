// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Palette } from '../../src/renderer/src/components/Palette'
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import type { Scored } from '../../src/shared/palette'

// jsdom は scrollIntoView を持たない。選択の追従は呼ばれるだけを見る
Element.prototype.scrollIntoView = () => {}

afterEach(cleanup)

const scored = (
  name: string,
  over: Partial<Omit<Scored, 'command'>> = {},
  command: Partial<SlashCommand> = {}
): Scored => ({
  command: { name, description: '', argumentHint: '', ...command },
  score: 1,
  matches: [],
  viaDescription: false,
  viaAlias: null,
  ...over
})

/** `/` パレット（差別化の本体）。並びと詳細は filterCommands の結果をそのまま描く */
describe('Palette', () => {
  it('当たりが無ければそう言い、件数を出す', () => {
    render(<Palette results={[]} total={52} selected={0} onSelect={() => {}} onChoose={() => {}} />)
    expect(screen.getByText('一致するコマンドがありません')).toBeTruthy()
    expect(screen.getByText('0 / 52 件')).toBeTruthy()
  })

  it('選んだ行の詳細を下に出し、別名・説明での一致・引数ヒントを行に添える', () => {
    const results = [
      scored('compact', { viaAlias: 'c' }, { description: '会話を圧縮する' }),
      scored(
        'review',
        { viaDescription: true },
        { description: 'レビューを頼む', argumentHint: '[PR 番号]' }
      )
    ]
    render(
      <Palette results={results} total={2} selected={1} onSelect={() => {}} onChoose={() => {}} />
    )
    expect(screen.getByText('別名 c')).toBeTruthy()
    expect(screen.getByText('説明で一致')).toBeTruthy()
    // 引数ヒントは行と詳細の 2 か所に出る
    expect(screen.getAllByText('[PR 番号]').length).toBe(2)
    // 行と詳細の 2 か所
    expect(screen.getAllByText('/review').length).toBe(2)
    expect(screen.getByText('2 / 2 件')).toBeTruthy()
  })

  it('マウスを乗せると onSelect、押すと onChoose に Scored が渡る', () => {
    const selected: number[] = []
    const chosen: string[] = []
    const results = [scored('clear'), scored('cost')]
    render(
      <Palette
        results={results}
        total={2}
        selected={0}
        onSelect={(i) => selected.push(i)}
        onChoose={(s) => chosen.push(s.command.name)}
      />
    )
    const row = screen.getByText('/cost').closest('[data-selected]') as HTMLElement
    fireEvent.mouseEnter(row)
    fireEvent.mouseDown(row)
    expect(selected).toEqual([1])
    expect(chosen).toEqual(['cost'])
  })

  it('当たった文字だけ強調し、内部用のコマンドにはその旨を付ける', () => {
    const results = [scored('__compact', { matches: [0, 1] }, { description: '(removed) 古い' })]
    const { container } = render(
      <Palette results={results} total={1} selected={0} onSelect={() => {}} onChoose={() => {}} />
    )
    // 強調は文字ごとの span。当たった 2 文字だけ色が付く
    const colored = [...container.querySelectorAll('span')].filter(
      (s) => s.textContent?.length === 1 && s.getAttribute('style')?.includes('color')
    )
    expect(colored.map((s) => s.textContent)).toEqual(['_', '_'])
    expect(screen.getByText('内部用・廃止済み')).toBeTruthy()
  })
})

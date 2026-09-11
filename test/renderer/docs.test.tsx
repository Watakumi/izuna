// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Docs } from '../../src/renderer/src/components/Docs'
import type { Panel } from '../../src/renderer/src/useSessions'
import { emptyTranscript } from '../../src/shared/transcript'

afterEach(cleanup)

const panel = (over: Partial<Panel>): Panel => ({
  id: 's1',
  label: 'x',
  cwd: '/r',
  branch: null,
  team: 't',
  transcript: emptyTranscript(),
  pending: null,
  prompt: '',
  commands: [],
  ended: false,
  loop: null,
  ...over
})

const commands = [
  { name: 'verify', description: '検査', argumentHint: '' },
  {
    name: 'doc-now-next-later',
    description: '資料 — Now / Next / Later。3 列に並べる (project)',
    argumentHint: ''
  },
  {
    name: 'doc-example-map',
    description: '資料 — Example Mapping。規則と具体例に分ける (project)',
    argumentHint: '[Issue 番号]'
  }
] as Panel['commands']

/** 右パネルの「資料」タブ。skill を説明つきで並べ、「頼む」で会話に送る */
describe('Docs', () => {
  it('資料の skill だけを枠組みと説明つきで並べ、「頼む」で /name を送る。引数があれば添える', () => {
    const asked: string[] = []
    render(<Docs panel={panel({ commands })} onAsk={(t) => asked.push(t)} />)
    expect(screen.getByText('Now / Next / Later')).toBeTruthy()
    expect(screen.getByText('3 列に並べる')).toBeTruthy()
    expect(screen.queryByText('検査')).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('[Issue 番号]'), { target: { value: '12' } })
    const buttons = screen.getAllByText('頼む')
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[1])
    expect(asked).toEqual(['/doc-example-map 12', '/doc-now-next-later'])
  })

  it('無ければ置き場を言う。終わったセッションでは頼めない', () => {
    render(<Docs panel={panel({})} onAsk={() => {}} />)
    expect(screen.getByText('このリポジトリに資料の skill がありません')).toBeTruthy()
    cleanup()
    render(<Docs panel={panel({ commands, ended: true })} onAsk={() => {}} />)
    expect((screen.getAllByText('頼む')[0] as HTMLButtonElement).disabled).toBe(true)
  })
})

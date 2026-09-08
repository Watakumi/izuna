// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { Panel } from '../../src/renderer/src/useSessions'
import { emptyTranscript, type Transcript } from '../../src/shared/transcript'
import { Files } from '../../src/renderer/src/components/Files'
import { Board } from '../../src/renderer/src/components/Board'
import { Sidebar } from '../../src/renderer/src/components/Sidebar'
import type { TeamBoard } from '../../src/main/team'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

/** props だけで決まる部品を描いて確かめる（§28） */

const panel = (over: Partial<Panel> = {}, t: Partial<Transcript> = {}): Panel => ({
  id: 's1', label: 'izuna', cwd: '/Users/x/work/izuna', branch: null, team: 'izuna',
  transcript: { ...emptyTranscript(), ...t }, pending: null, prompt: '', commands: [], ended: false, ...over
})

const tool = (name: string, path: string, state: 'done' | 'denied' = 'done'): Transcript['items'][number] => ({
  kind: 'assistant', id: 'm1',
  blocks: [{ kind: 'tool', id: 't', name, input: { file_path: path }, state, result: null }]
})

describe('触ったファイル', () => {
  it('何も無ければそう言う', () => {
    render(<Files panel={panel()} />)
    expect(screen.getByText('まだファイルを触っていません')).toBeTruthy()
  })

  it('書いたものを上に、作業ディレクトリからの相対で出す。外は絶対のまま', () => {
    const p = panel({}, { items: [
      tool('Read', '/Users/x/work/izuna/src/a.ts'),
      tool('Write', '/Users/x/work/izuna/src/b.ts'),
      tool('Edit', '/etc/hosts')
    ] })
    const { container } = render(<Files panel={p} />)
    const text = container.textContent ?? ''
    expect(text).toContain('書き換えた 2 件')
    expect(text).toContain('読んだだけ 1 件')
    expect(text.indexOf('src/b.ts')).toBeLessThan(text.indexOf('src/a.ts'))
    expect(text).toContain('/etc/hosts')
    expect(text).not.toContain('../')
  })

  it('実行役が触った分は誰かを札で出す', () => {
    const p = panel({}, { tasks: [{
      taskId: 'a', toolUseId: null, description: '直す', subagentType: 'exec', prompt: null,
      status: 'completed', summary: null, lastTool: null, backgrounded: false, usage: null,
      blocks: [{ kind: 'tool', id: 't', name: 'Write', input: { file_path: '/Users/x/work/izuna/c.ts' }, state: 'done', result: null }]
    }] })
    render(<Files panel={p} />)
    expect(screen.getByText('exec')).toBeTruthy()
  })
})

describe('盤面', () => {
  const board = (over: Partial<TeamBoard> = {}): TeamBoard => ({
    dir: '/t', brief: { issue: null, created: null, body: '' }, tasks: [], errors: [], summaries: [],
    decisions: [], log: [], collisions: [], ready: [], ...over
  })
  const izuna = (b: TeamBoard | null | Error): void => {
    ;(window as unknown as { izuna: unknown }).izuna = {
      teamBoard: async () => { if (b instanceof Error) throw b; return b }
    }
  }

  it('共有フォルダが無ければそう言う', async () => {
    izuna(null)
    render(<Board panel={panel()} />)
    await waitFor(() => expect(screen.getByText('共有フォルダがありません')).toBeTruthy())
  })

  it('読めなければ「無い」に倒す（落とさない）', async () => {
    izuna(new Error('壊れた'))
    render(<Board panel={panel()} />)
    await waitFor(() => expect(screen.getByText('共有フォルダがありません')).toBeTruthy())
  })

  it('**重なる組と読めなかった札を目立たせる**', async () => {
    izuna(board({
      tasks: [{ id: 'A-01', title: '読む', assignee: null, branch: null, status: 'doing', depends_on: [], paths: ['src/'], updated: '', body: '' }],
      collisions: [{ a: 'A-01', b: 'A-02', paths: ['src/', 'src/a.ts'] }],
      errors: ['tasks/03.md: id がない'],
      ready: [{ id: 'A-03', title: '次', assignee: null, branch: null, status: 'todo', depends_on: [], paths: [], updated: '', body: '' }],
      summaries: [{ task: 'A-01', by: 'exec', at: '', outcome: 'blocked', body: '' }],
      decisions: [{ at: '', target: null, by: 'brain', body: '先に読む\n詳細' }],
      log: [{ at: '', from: 'izuna', to: 'brain', kind: 'start', target: '/w', note: '新規' }]
    }))
    const { container } = render(<Board panel={panel()} />)
    await waitFor(() => expect(screen.getByText('同時に走らせてはいけない組があります')).toBeTruthy())
    const text = container.textContent ?? ''
    expect(text).toContain('A-01 と A-02')
    expect(text).toContain('読めなかった札')
    expect(text).toContain('いま着手できるもの 1 件')
    expect(text).toContain('先に読む')
    expect(text).not.toContain('詳細')
    expect(text).toContain('blocked')
  })
})

describe('セッション一覧', () => {
  it('空なら「まだありません」', () => {
    render(<Sidebar panels={[]} activeId={null} onSelect={() => {}} onClose={() => {}} onNew={() => {}} />)
    expect(screen.getByText('まだありません')).toBeTruthy()
  })

  it('リポジトリで束ね、承認待ち・実行中・終了・待機を言葉で出す', () => {
    const panels = [
      panel({ id: 'a', label: 'A', pending: { id: 'p', toolName: 'Bash', input: {} } }),
      panel({ id: 'b', label: 'B', cwd: '/Users/x/.izuna/worktrees/izuna/feat', branch: 'feat' }, { running: true }),
      panel({ id: 'c', label: 'C', cwd: '/Users/x/work/other', ended: true }),
      panel({ id: 'd', label: 'D', cwd: '/Users/x/work/other' })
    ]
    const { container } = render(<Sidebar panels={panels} activeId="a" onSelect={() => {}} onClose={() => {}} onNew={() => {}} />)
    const text = container.textContent ?? ''
    for (const w of ['承認待ち', 'feat · 実行中', '終了', '待機', 'izuna', 'other']) expect(text).toContain(w)
    // 束は名前順。izuna が other より先
    expect(text.indexOf('izuna')).toBeLessThan(text.indexOf('other'))
  })

  it('選ぶ・閉じる・新しく作る', () => {
    const selected: string[] = []
    const closed: string[] = []
    let created = 0
    render(<Sidebar panels={[panel({ id: 'a', label: 'A' })]} activeId={null}
      onSelect={(id) => selected.push(id)} onClose={(id) => closed.push(id)} onNew={() => { created++ }} />)
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByTitle('このセッションを閉じる'))
    fireEvent.click(screen.getByText('新しいセッション'))
    expect(selected).toEqual(['a'])
    expect(closed).toEqual(['a']) // 閉じるは選ぶに伝播しない
    expect(created).toBe(1)
  })
})

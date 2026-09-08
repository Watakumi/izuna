import { describe, expect, it } from 'vitest'
import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { TEAMMATE_HOOKS, logEntryOf, teammateEventOf, teammateNotice } from '../src/shared/teammate'
import { formatLogEntry, parseLog } from '../src/shared/team'

/**
 * 実行役の節目（§12「反省ループの起点は hook」）。
 * hook の入力を、画面の一言と `log.md` の 1 行に変える純粋関数。
 */
const base = { session_id: 's', transcript_path: '/t', cwd: '/w' }
const at = '2026-09-09T10:00:00.000Z'

describe('hook の入力を節目に読む', () => {
  it('SubagentStart / SubagentStop は実行役の id と種類を持つ。最後の発話は 1 行に畳む', () => {
    const start = teammateEventOf(
      {
        ...base,
        hook_event_name: 'SubagentStart',
        agent_id: 'a9d98cdcaa1a7c6e6',
        agent_type: 'general-purpose'
      } as HookInput,
      at
    )
    expect(start).toEqual({
      kind: 'start',
      agent: 'a9d98cdcaa1a7c6e6',
      target: 'general-purpose',
      note: '',
      at
    })
    const stop = teammateEventOf(
      {
        ...base,
        hook_event_name: 'SubagentStop',
        stop_hook_active: false,
        agent_id: 'a9d9',
        agent_type: 'general-purpose',
        agent_transcript_path: '/x',
        last_assistant_message: 'Done.\n\nCreated   file.'
      } as HookInput,
      at
    )
    expect(stop?.kind).toBe('stop')
    expect(stop?.note).toBe('Done. Created file.')
  })

  it('TeammateIdle は名前だけ。作業単位と worktree は対象を持つ', () => {
    expect(
      teammateEventOf(
        {
          ...base,
          hook_event_name: 'TeammateIdle',
          teammate_name: 'exec-a',
          team_name: 't'
        } as HookInput,
        at
      )
    ).toMatchObject({ kind: 'idle', agent: 'exec-a' })
    expect(
      teammateEventOf(
        {
          ...base,
          hook_event_name: 'TaskCreated',
          task_id: '3',
          task_subject: 'scoring'
        } as HookInput,
        at
      )
    ).toMatchObject({ kind: 'taskCreated', agent: '-', target: '3 scoring' })
    expect(
      teammateEventOf(
        {
          ...base,
          hook_event_name: 'TaskCompleted',
          task_id: '3',
          task_subject: 'scoring',
          teammate_name: 'exec-a'
        } as HookInput,
        at
      )
    ).toMatchObject({ kind: 'taskCompleted', agent: 'exec-a' })
  })

  it('関係の無い hook は null（張っていないものが来ても落ちない）', () => {
    expect(
      teammateEventOf(
        { ...base, hook_event_name: 'Stop', stop_hook_active: false } as HookInput,
        at
      )
    ).toBeNull()
  })

  it('**WorktreeCreate / WorktreeRemove は張らない**（張ると Agent の起動が失敗する。2026-09-09 実測）', () => {
    expect(TEAMMATE_HOOKS).not.toContain('WorktreeCreate')
    expect(TEAMMATE_HOOKS).not.toContain('WorktreeRemove')
    expect(
      teammateEventOf(
        { ...base, hook_event_name: 'WorktreeCreate', name: 'scoring' } as HookInput,
        at
      )
    ).toBeNull()
  })

  it('張る hook の一覧は、読める hook と一致する（片方だけ増やせない）', () => {
    const inputs: HookInput[] = [
      { ...base, hook_event_name: 'SubagentStart', agent_id: 'a', agent_type: 't' },
      {
        ...base,
        hook_event_name: 'SubagentStop',
        stop_hook_active: false,
        agent_id: 'a',
        agent_type: 't',
        agent_transcript_path: '/x'
      },
      { ...base, hook_event_name: 'TeammateIdle', teammate_name: 'n', team_name: 't' },
      { ...base, hook_event_name: 'TaskCreated', task_id: '1', task_subject: 's' },
      { ...base, hook_event_name: 'TaskCompleted', task_id: '1', task_subject: 's' }
    ] as HookInput[]
    expect(inputs.map((i) => i.hook_event_name).sort()).toEqual([...TEAMMATE_HOOKS].sort())
    for (const i of inputs) expect(teammateEventOf(i, at)).not.toBeNull()
  })
})

describe('log.md の 1 行', () => {
  it('実行役の節目は executor → brain、盤面の事実は izuna → board。読み戻せる', () => {
    const stop = logEntryOf({
      kind: 'stop',
      agent: 'a9d98cdcaa1a7c6e6',
      target: 'general-purpose',
      note: 'Done.',
      at
    })
    expect(stop).toEqual({
      at,
      from: 'executor:a9d98cdc',
      to: 'brain',
      kind: 'stop',
      target: 'general-purpose',
      note: 'Done.'
    })
    const task = logEntryOf({ kind: 'taskCreated', agent: '-', target: '3 scoring', note: '', at })
    expect(task).toMatchObject({
      from: 'izuna',
      to: 'board',
      kind: 'taskCreated',
      target: '3 scoring'
    })
    expect(parseLog(formatLogEntry(stop) + '\n' + formatLogEntry(task))).toEqual([stop, task])
  })

  it('対象が無ければ実行役の名前を対象にする（空の列を作らない）', () => {
    expect(logEntryOf({ kind: 'idle', agent: 'exec-a', target: '', note: '', at }).target).toBe(
      'executor:exec-a'
    )
  })
})

describe('会話に挟む一言', () => {
  it('比喩を使わず、何が起きたかを書く', () => {
    expect(
      teammateNotice({
        kind: 'start',
        agent: 'a9d98cdcaa1a7c6e6',
        target: 'general-purpose',
        note: '',
        at
      })
    ).toBe('実行役 a9d98cdc を開きました（general-purpose）')
    expect(
      teammateNotice({ kind: 'stop', agent: 'a9d98cdc', target: 't', note: 'Done.', at })
    ).toBe('実行役 a9d98cdc が手を止めました: Done.')
    expect(teammateNotice({ kind: 'stop', agent: 'a9d98cdc', target: 't', note: '', at })).toBe(
      '実行役 a9d98cdc が手を止めました'
    )
    expect(teammateNotice({ kind: 'idle', agent: 'x', target: '', note: '', at })).toContain(
      'ブレインが読む番'
    )
    expect(teammateNotice({ kind: 'taskCreated', agent: '-', target: '1 s', note: '', at })).toBe(
      '作業単位を作りました: 1 s'
    )
    expect(teammateNotice({ kind: 'taskCompleted', agent: '-', target: '1 s', note: '', at })).toBe(
      '作業単位が終わりました: 1 s'
    )
  })
})

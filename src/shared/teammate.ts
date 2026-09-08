import type { HookCallbackMatcher, HookEvent, HookInput } from '@anthropic-ai/claude-agent-sdk'
import type { LogEntry } from './team'

/**
 * 実行役（サブエージェント）の節目（§12「反省ループの起点は hook」）。
 *
 * GOAL.md 柱 1 の「実行役が手を止めたら、ブレインが結果を見て次を指示する」と
 * 「承認待ちのセッションが埋もれない」を、hook で拾って画面と `log.md` に出す。
 * 純粋関数。hook を張るのは `main/hub.ts`、描くのは `useSessions`。
 *
 * **どの hook が実際に鳴るかは実測で決める**（`scripts/probe-team.ts`）。
 * 鳴らないものを画面に約束しない。
 */
export type TeammateKind = 'start' | 'stop' | 'idle' | 'taskCreated' | 'taskCompleted'

export interface TeammateEvent {
  kind: TeammateKind
  /** 実行役の id か名前。無ければ '-' */
  agent: string
  /** 何が起きたか。id・題・パスなど */
  target: string
  /** 実行役が最後に言ったこと（stop のとき）。無ければ '' */
  note: string
  at: string
}

/** `query()` に渡す hook の表 */
export type TeammateHooks = Partial<{ [K in HookEvent]: HookCallbackMatcher[] }>

/**
 * 張る hook。**`hooks` の鍵はこれから導く**（手で並べない。§27 と同じ理屈）。
 *
 * **`WorktreeCreate` / `WorktreeRemove` は張らない**（2026-09-09 に `scripts/probe-team.ts` で踏んだ）。
 * あれは観察の口ではなく**作成を委ねる口**で、張ると CLI は hook が返す `worktreePath` を待つ。
 * 返さなければ「hook succeeded but returned no worktree path」で **Agent の起動ごと失敗する**。
 * Izuna は worktree を作らない（§12）ので、見るだけなら `git worktree list` で足りる。
 */
export const TEAMMATE_HOOKS: readonly HookEvent[] = [
  'SubagentStart',
  'SubagentStop',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted'
]

const oneLine = (s: string | undefined, max = 160): string =>
  (s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** hook の入力を節目に変える。関係の無い hook なら null */
export function teammateEventOf(
  input: HookInput,
  at = new Date().toISOString()
): TeammateEvent | null {
  switch (input.hook_event_name) {
    case 'SubagentStart':
      return { kind: 'start', agent: input.agent_id, target: input.agent_type, note: '', at }
    case 'SubagentStop':
      return {
        kind: 'stop',
        agent: input.agent_id,
        target: input.agent_type,
        note: oneLine(input.last_assistant_message),
        at
      }
    case 'TeammateIdle':
      return { kind: 'idle', agent: input.teammate_name, target: '', note: '', at }
    case 'TaskCreated':
      return {
        kind: 'taskCreated',
        agent: input.teammate_name ?? '-',
        target: `${input.task_id} ${input.task_subject}`.trim(),
        note: '',
        at
      }
    case 'TaskCompleted':
      return {
        kind: 'taskCompleted',
        agent: input.teammate_name ?? '-',
        target: `${input.task_id} ${input.task_subject}`.trim(),
        note: '',
        at
      }
    default:
      return null
  }
}

/** `log.md` の 1 行。書くのは Izuna（§12「1 ファイル 1 書き手」） */
export function logEntryOf(e: TeammateEvent): LogEntry {
  const executor = e.agent === '-' ? 'executor' : `executor:${e.agent.slice(0, 8)}`
  // 起こす・止まる・手を止めるは実行役 → ブレインへの節目。作業単位と worktree は Izuna が見た事実
  const toBrain = e.kind === 'start' || e.kind === 'stop' || e.kind === 'idle'
  return {
    at: e.at,
    from: toBrain ? executor : 'izuna',
    to: toBrain ? 'brain' : 'board',
    kind: e.kind,
    target: e.target || executor,
    note: e.note
  }
}

/** 会話に挟む一言。比喩を使わない（§17.4） */
export function teammateNotice(e: TeammateEvent): string {
  const who = e.agent === '-' ? '実行役' : `実行役 ${e.agent.slice(0, 8)}`
  switch (e.kind) {
    case 'start':
      return `${who} を開きました（${e.target}）`
    case 'stop':
      return `${who} が手を止めました${e.note ? `: ${e.note}` : ''}`
    case 'idle':
      return `${who} が手を止めました（ブレインが読む番）`
    case 'taskCreated':
      return `作業単位を作りました: ${e.target}`
    case 'taskCompleted':
      return `作業単位が終わりました: ${e.target}`
  }
}

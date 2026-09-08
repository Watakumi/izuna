import { useState } from 'react'
import type { Block, TaskRun } from '../../../shared/transcript'
import { F, C, MONO, ellipsis } from '../theme'
import { ToolBlock } from './ToolBlock'
import { Markdown } from './Markdown'

/**
 * Agentの一覧（段4）。
 *
 * ブレインの会話とは別に出す。**誰が言ったのかが分からなくなるのが
 * 並列で一番効く事故**なので、混ぜて表示しない。
 *
 * 承認はここには出さない。Agentの要求でも人間に上げる（GOAL.md 完成の定義5）。
 *
 * **実行役の文も本文と同じ markdown で描く。** 生の文字列で出していたので、
 * `` `code` `` や `**強調**` がそのまま見えていた（2026-09-09 に指摘された）。
 */
const STATUS: Record<TaskRun['status'], { label: string; color: string }> = {
  running: { label: '実行中', color: C.teal },
  completed: { label: '完了', color: C.teal },
  failed: { label: '失敗', color: C.red },
  stopped: { label: '停止', color: C.faint }
}

function One({ task }: { task: TaskRun }): React.JSX.Element {
  const [open, setOpen] = useState(task.status === 'running')
  const s = STATUS[task.status]
  const texts = task.blocks.filter((b): b is Extract<Block, { kind: 'text' }> => b.kind === 'text')
  const tools = task.blocks.filter((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool')

  return (
    <div style={{ border: `1px solid ${C.line2}`, borderRadius: 7, background: C.surface, overflow: 'hidden' }}>
      <div onClick={() => setOpen((v) => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px', cursor: 'pointer' }}>
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint, width: 9 }}>{open ? '▾' : '▸'}</span>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: task.status === 'running' ? C.teal : 'transparent',
          border: task.status === 'running' ? 'none' : `1.5px solid ${s.color}`
        }} />
        <span style={{ fontSize: F.body, fontWeight: 500, flexShrink: 0 }}>
          {task.subagentType ?? 'Agent'}
        </span>
        <span style={{ fontSize: F.body, color: C.dim2, flexGrow: 1, ...ellipsis }}>
          {task.description}
        </span>
        {task.lastTool && task.status === 'running' && (
          <span style={{ font: `${F.small}px ${MONO}`, color: C.dim2, flexShrink: 0 }}>{task.lastTool}</span>
        )}
        {task.usage && (
          <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint, flexShrink: 0 }}>
            {(task.usage.totalTokens / 1000).toFixed(1)}k
          </span>
        )}
        <span style={{ fontSize: F.small, color: s.color, flexShrink: 0 }}>{s.label}</span>
      </div>

      {open && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {task.prompt && (
            <div style={{ borderLeft: `2px solid ${C.line2}`, paddingLeft: 12, fontSize: F.body,
              color: C.dim2, lineHeight: 1.65 }}><Markdown text={task.prompt} /></div>
          )}
          {tools.map((b, i) => <ToolBlock key={i} block={b} />)}
          {texts.map((b, i) => (
            <div key={i} style={{ color: C.ink2, fontSize: F.body, lineHeight: 1.75 }}>
              <Markdown text={b.text} />
            </div>
          ))}
          {/* 要約は最後の発話と同じ文で来ることが多い。同じなら二重に出さない */}
          {task.summary && task.status !== 'running' && task.summary.trim() !== texts.at(-1)?.text.trim() && (
            <div style={{ background: C.code, borderRadius: 7, padding: '12px 12px',
              fontSize: F.body, color: C.dim, lineHeight: 1.7 }}>
              <Markdown text={task.summary} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function TaskPanel({ tasks }: { tasks: TaskRun[] }): React.JSX.Element | null {
  if (tasks.length === 0) return null
  const running = tasks.filter((t) => t.status === 'running').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 24px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: F.small, letterSpacing: '0.08em', color: C.dim2, fontWeight: 600 }}>Agent</span>
        <span style={{ font: `${F.small}px ${MONO}`, color: C.faint }}>
          {tasks.length} 人{running > 0 && ` · ${running} 実行中`}
        </span>
      </div>
      {tasks.map((t) => <One key={t.taskId} task={t} />)}
    </div>
  )
}

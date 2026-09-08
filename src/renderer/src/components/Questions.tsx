import { useState } from 'react'
import { answered, type Question } from '../../../shared/question'
import { C, F, MONO, R, S } from '../theme'
import { Button, Check, Input } from './ui'

/**
 * エージェントの問いに人が答える（`shared/question.ts`）。
 *
 * 選択肢は釦。**「その他」の自由記述を必ず出す** —— 選択肢に無い答えが
 * 正しいことはよくあり、無いと人は近いものを選んで嘘をつくことになる。
 * 全部に答えるまで送れない。途中で送ると、答えの無い問いが「拒否」に見える。
 */
export function Questions({ questions, onAnswer, onDeny }: {
  questions: Question[]
  onAnswer: (answers: Record<string, string[]>) => void
  onDeny: () => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [other, setOther] = useState<Record<string, string>>({})

  const answers = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {}
    for (const q of questions) {
      const chosen = picked[q.question] ?? []
      const free = (other[q.question] ?? '').trim()
      out[q.question] = free ? [...chosen, free] : chosen
    }
    return out
  }
  const ready = answered(questions, answers())

  const toggle = (q: Question, label: string): void => {
    setPicked((prev) => {
      const cur = prev[q.question] ?? []
      if (!q.multiSelect) return { ...prev, [q.question]: cur[0] === label ? [] : [label] }
      return { ...prev, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: S.lg }}>
      {questions.map((q) => {
        const cur = picked[q.question] ?? []
        return (
          <div key={q.question} style={{ display: 'flex', flexDirection: 'column', gap: S.sm }}>
            {q.header && <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2 }}>{q.header}</span>}
            <span style={{ fontSize: F.base, color: C.ink, lineHeight: 1.6 }}>{q.question}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: S.xs }}>
              {q.options.map((o) => (
                q.multiSelect
                  ? (
                    <Check key={o.label} checked={cur.includes(o.label)} onChange={() => toggle(q, o.label)}>
                      <span>{o.label}</span>
                      {o.description && <span style={{ color: C.dim2, marginLeft: S.sm }}>{o.description}</span>}
                    </Check>
                  )
                  : (
                    <button key={o.label} onClick={() => toggle(q, o.label)} style={{
                      textAlign: 'left', padding: `${S.sm}px ${S.md}px`, borderRadius: R.md, cursor: 'pointer',
                      border: `1px solid ${cur.includes(o.label) ? C.amber : C.line2}`,
                      background: cur.includes(o.label) ? C.raised : 'transparent', color: C.ink2, fontSize: F.body
                    }}>
                      <span style={{ color: C.ink }}>{o.label}</span>
                      {o.description && <span style={{ color: C.dim2, marginLeft: S.sm }}>{o.description}</span>}
                    </button>
                  )
              ))}
              <Input placeholder="その他（自由に書く）" value={other[q.question] ?? ''}
                onChange={(e) => setOther((prev) => ({ ...prev, [q.question]: e.target.value }))} />
            </div>
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: S.sm, justifyContent: 'flex-end' }}>
        <Button onClick={onDeny}>答えない</Button>
        <Button kind="primary" disabled={!ready} onClick={() => onAnswer(answers())}>答える</Button>
      </div>
    </div>
  )
}

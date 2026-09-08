import type { PermissionRequest } from '../../../main/claude/session'
import { describeToolInput, diffFromToolInput } from '../../../shared/diff'
import { F, C, MONO, ellipsis } from '../theme'
import { Button } from './ui'
import { DiffView } from './DiffView'
import { Questions } from './Questions'
import { questionsOf } from '../../../shared/question'

/**
 * 承認は**人間が持つ**（docs/GOAL.md 完成の定義 5）。
 * ブレインにも自動にも渡さない。並列で一番壊れる箇所を無人にしないため。
 */
export function PermissionBar({
  request,
  onAllow,
  onAnswer,
  onDeny
}: {
  request: PermissionRequest
  onAllow: (alwaysThisSession: boolean) => void
  /** `AskUserQuestion` への答え。問い → 選んだ札（自由記述を含む） */
  onAnswer: (answers: Record<string, string[]>) => void
  onDeny: () => void
}): React.JSX.Element {
  // **問いは問いとして描く。** 許可の釦で答えさせると、人は選択肢に答えられない
  const questions = questionsOf(request.toolName, request.input)
  if (questions) {
    return (
      <div style={{ border: `1px solid ${C.amberLine}`, background: C.amberBg, borderRadius: 11, padding: 16 }}>
        <Questions questions={questions} onAnswer={onAnswer} onDeny={onDeny} />
      </div>
    )
  }

  const diff = diffFromToolInput(request.toolName, request.input)
  // CLI が「常に許可」の中身を提案してくる。ボタンの意味を自前で決めない
  const suggestion = request.suggestions?.[0]

  return (
    <div style={{ border: `1px solid ${C.amberLine}`, background: C.amberBg, borderRadius: 11,
      display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <b style={{ fontSize: F.base }}>{request.toolName}</b>
            {request.agentId && (
              // 実行役の要求でも人間に上げる。誰の要求かは見せる
              <span style={{ font: `${F.micro}px ${MONO}`, color: C.dim2, padding: '2px 8px',
                border: `1px solid ${C.amberLine}`, borderRadius: 4 }}>
                実行役 {request.agentId.slice(0, 6)}
              </span>
            )}
            <span style={{ font: `${F.small}px ${MONO}`, color: C.ink2, ...ellipsis }}>
              {describeToolInput(request.toolName, request.input)}
            </span>
          </div>
          {request.description && (
            <span style={{ fontSize: F.body, color: C.dim, lineHeight: 1.6 }}>{request.description}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Button kind="primary" onClick={() => onAllow(false)}>許可</Button>
          <Button onClick={onDeny} >拒否</Button>
        </div>
      </div>

      {diff && <DiffView diff={diff} max={200} />}

      {suggestion && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: F.small, color: C.dim2 }}>
          <span>CLI の提案:</span>
          <Button size="sm" onClick={() => onAllow(true)}>
            このセッション中は許可
          </Button>
          <span style={{ font: `${F.micro}px ${MONO}`, color: C.faint }}>
            {'type' in suggestion ? String(suggestion.type) : ''}
            {'mode' in suggestion ? ` · ${String(suggestion.mode)}` : ''}
            {'destination' in suggestion ? ` · ${String(suggestion.destination)}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}


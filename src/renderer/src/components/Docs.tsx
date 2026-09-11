import { useState } from 'react'
import { docRequest, docSkills } from '../../../shared/docs'
import type { Panel } from '../useSessions'
import { C, ellipsis, F, MONO, S } from '../theme'
import { Button, Card, Faint, Input } from './ui'

/**
 * 右パネルの「資料」タブ。資料を作る skill を説明つきで並べ、「頼む」で会話に送る。
 *
 * Izuna が資料を作るのではない。skill（`.claude/skills/doc-*`）を claude が実行し、
 * 出来た資料は `docs/plans/` に置かれて、いつもどおり承認と差分と PR を通る。
 * ここは**入口を見えるようにするだけ**（shared/docs.ts）。
 */
export function Docs({
  panel,
  onAsk
}: {
  panel: Panel
  /** 会話に送る（App が `send` に繋ぐ） */
  onAsk: (text: string) => void
}): React.JSX.Element {
  const skills = docSkills(panel.commands)
  const [args, setArgs] = useState<Record<string, string>>({})

  if (skills.length === 0) {
    return (
      <div style={{ padding: S.lg, display: 'flex', flexDirection: 'column', gap: S.md }}>
        <Faint>このリポジトリに資料の skill がありません</Faint>
        <Faint>
          `.claude/skills/` に `doc-` で始まる skill を置くと、ここに出ます（docs/FRAMEWORKS.md）
        </Faint>
      </div>
    )
  }

  return (
    <div style={{ padding: S.lg, display: 'flex', flexDirection: 'column', gap: S.md }}>
      {skills.map((s) => (
        <Card key={s.name}>
          <span style={{ fontSize: F.body, color: C.ink }}>{s.title}</span>
          {s.detail && <Faint>{s.detail}</Faint>}
          {/*
            skill の名前は長い（`izuna-docs:doc-…`）。**行を分ける** —— 欄と同じ行に置くと、
            名前が幅を取って欄が潰れ、釦の字が縦に折れる（2026-09-11 に利用者が見つけた）
          */}
          <span
            style={{ font: `${F.micro}px ${MONO}`, color: C.faint, ...ellipsis }}
            title={`/${s.name}`}
          >
            /{s.name}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: S.md }}>
            {s.argumentHint && (
              <Input
                value={args[s.name] ?? ''}
                placeholder={s.argumentHint}
                onChange={(e) => setArgs({ ...args, [s.name]: e.target.value })}
                style={{ flexGrow: 1, minWidth: 0 }}
              />
            )}
            {!s.argumentHint && <div style={{ flexGrow: 1 }} />}
            <Button
              size="sm"
              kind="primary"
              disabled={panel.ended}
              style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              onClick={() => onAsk(docRequest(s, args[s.name] ?? ''))}
            >
              頼む
            </Button>
          </div>
        </Card>
      ))}
    </div>
  )
}

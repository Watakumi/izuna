/**
 * `AskUserQuestion` の受け皿（docs/NIMBALYST.md §3 の 2）。
 *
 * エージェントが人に問うとき、SDK ではこれも `canUseTool` に来る。
 * 受け皿が無いと `PermissionBar` に「ツールの許可」として出て、人は選択肢に答えられない
 * （2026-09-08 まで Izuna はそうだった。Nimbalyst は `INTERACTIVE_PROMPTS.md` で部品にしている）。
 *
 * ここは純粋関数。入力の形を読み、答えを `updatedInput` の形に組む。
 * **答えの鍵の形（`answers[question] = label`）は CLI の実装から読んだもので、未検証。**
 * 違っていたら、エージェントが「答えが無い」と言うので分かる。
 */

export interface QuestionOption {
  label: string
  description: string | null
}

export interface Question {
  question: string
  /** 短い見出し。無ければ null */
  header: string | null
  options: QuestionOption[]
  multiSelect: boolean
}

export const QUESTION_TOOL = 'AskUserQuestion'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** 問いの一覧。形が違えば null（＝ふつうの許可として扱う） */
export function questionsOf(toolName: string, input: unknown): Question[] | null {
  if (toolName !== QUESTION_TOOL) return null
  const raw = (input as { questions?: unknown } | null)?.questions
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: Question[] = []
  for (const q of raw) {
    const o = q as { question?: unknown; header?: unknown; options?: unknown; multiSelect?: unknown }
    const question = str(o?.question)
    if (!question) return null
    const options = Array.isArray(o.options)
      ? o.options.flatMap((x) => {
          const label = str((x as { label?: unknown })?.label)
          return label ? [{ label, description: str((x as { description?: unknown }).description) }] : []
        })
      : []
    out.push({ question, header: str(o.header), options, multiSelect: o.multiSelect === true })
  }
  return out
}

/** 全部の問いに答えがあるか。空の答えは答えではない */
export function answered(questions: Question[], answers: Record<string, string[]>): boolean {
  return questions.every((q) => (answers[q.question] ?? []).some((a) => a.trim() !== ''))
}

/**
 * CLI に返す形。元の入力に `answers` を足す。複数選択は `, ` で繋ぐ
 * （CLI が複数の答えをそう受けている前提。未検証）。
 */
export function answerInput(input: unknown, answers: Record<string, string[]>): Record<string, unknown> {
  const base = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const joined: Record<string, string> = {}
  for (const [q, a] of Object.entries(answers)) {
    const clean = a.map((s) => s.trim()).filter(Boolean)
    if (clean.length > 0) joined[q] = clean.join(', ')
  }
  return { ...base, answers: joined }
}

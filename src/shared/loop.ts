/**
 * 自律ループ（Ralph）。**文脈は毎回捨て、状態はファイルに残す。**
 *
 * §12 の共有フォルダはこのために作ってあった（`brief.md` / `tasks/` /
 * `summaries/`）が、**回す仕掛けが無かった**。ここがそれである。
 *
 * ここはプロセスもファイルも知らない（§4 の原則）。
 * 進捗を読んで「次に何を渡すか」「もう終わりか」を決めるだけ。
 *
 * **Nimbalyst の実装は参考にしたが、そのままにはしていない**
 * （2026-09-08 に読んだ。あちらは v0.77.0 の時点で受け手が繋がっておらず、
 * さらにプロンプトが「冒頭のスナップショットを見よ」と言いながら
 * モデルにはそれが渡らない、という矛盾を抱えていた）。
 * **こちらは進捗をプロンプト本文に入れる。**
 */

export type Phase = 'planning' | 'building'
export type LoopStatus = 'running' | 'completed' | 'blocked'

export interface Learning {
  iteration: number
  summary: string
  filesChanged: string[]
}

/** 反復を跨いで残るもの。**これが全部**。ほかは毎回捨てる */
export interface Progress {
  currentIteration: number
  phase: Phase
  status: LoopStatus
  /** 「全部終わった」とエージェントが宣言したか */
  completionSignal: boolean
  learnings: Learning[]
  blockers: string[]
  /** 詰まったループを人が押し戻すときの一言 */
  userFeedback?: string
}

export const EMPTY_PROGRESS: Progress = {
  currentIteration: 0,
  phase: 'planning',
  status: 'running',
  completionSignal: false,
  learnings: [],
  blockers: []
}

export type StopReason = 'completed' | 'blocked' | 'maxIterations' | 'stopped' | 'failed'

export interface Stop {
  reason: StopReason
  detail: string
}

/**
 * 壊れた進捗で止まらない。**読めないところは既定に倒す。**
 *
 * ファイルは毎回エージェントが書き換えるので、途中で切れることがある。
 * ここで throw すると、直せるはずのループが 1 回の書き損じで死ぬ。
 */
export function parseProgress(text: string): Progress {
  let raw: Record<string, unknown>
  try {
    const v: unknown = JSON.parse(text)
    raw = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
  } catch {
    return { ...EMPTY_PROGRESS }
  }
  const phase = raw.phase === 'building' ? 'building' : 'planning'
  const status: LoopStatus =
    raw.status === 'completed' ? 'completed' : raw.status === 'blocked' ? 'blocked' : 'running'
  return {
    currentIteration: typeof raw.currentIteration === 'number' ? raw.currentIteration : 0,
    phase,
    status,
    completionSignal: raw.completionSignal === true,
    learnings: Array.isArray(raw.learnings) ? raw.learnings.filter(isLearning) : [],
    blockers: Array.isArray(raw.blockers)
      ? raw.blockers.filter((b): b is string => typeof b === 'string')
      : [],
    ...(typeof raw.userFeedback === 'string' ? { userFeedback: raw.userFeedback } : {})
  }
}

const isLearning = (v: unknown): v is Learning =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Learning).summary === 'string' &&
  typeof (v as Learning).iteration === 'number'

/**
 * 続けるか、やめるか。
 *
 * **順番に意味がある。** 「終わった」を「上限に達した」より先に見る ——
 * 最後の反復で終わったのに「上限で打ち切り」と記録されると、
 * あとから見て成否が分からなくなる。
 */
export function decide(progress: Progress, maxIterations: number): Stop | null {
  if (progress.completionSignal) {
    return { reason: 'completed', detail: 'エージェントが完了を宣言しました' }
  }
  if (progress.status === 'blocked') {
    return {
      reason: 'blocked',
      detail:
        progress.blockers.length > 0 ? progress.blockers.join(' / ') : '理由は書かれていません'
    }
  }
  if (progress.currentIteration >= maxIterations) {
    return { reason: 'maxIterations', detail: `${maxIterations} 回で打ち切りました` }
  }
  return null
}

/** 覚えておく件数の上限。増え続けるとプロンプトが膨らんで文脈を食う */
export const MAX_LEARNINGS = 20

export function trimLearnings(learnings: Learning[]): Learning[] {
  return learnings.slice(-MAX_LEARNINGS)
}

/**
 * 次の反復に渡す本文。
 *
 * **進捗をここに入れる。** 別の場所に置いてモデルに読めと言っても届かない
 * （Nimbalyst がそうなっていた）。毎回文脈を捨てるので、
 * **前の反復から引き継ぐものは、この文字列に入っているものだけ**である。
 */
export function iterationPrompt(input: {
  progress: Progress
  /** 共有フォルダの絶対パス（§12） */
  teamDir: string
  iteration: number
}): string {
  const { progress, teamDir, iteration } = input
  const learnings = trimLearnings(progress.learnings)

  const carried =
    learnings.length === 0
      ? '（まだありません。これが最初の反復です）'
      : learnings
          .map(
            (l) =>
              `- 反復 ${l.iteration}: ${l.summary}` +
              (l.filesChanged.length > 0 ? `\n  触ったファイル: ${l.filesChanged.join(', ')}` : '')
          )
          .join('\n')

  const feedback = progress.userFeedback ? `\n## 人からの指示\n\n${progress.userFeedback}\n` : ''

  const work =
    progress.phase === 'planning'
      ? [
          '## いまやること: 計画',
          '',
          `1. \`${teamDir}/brief.md\` を読んで、狙いと制約と受け入れ条件を把握する。`,
          '2. コードを読んで、すでにあるものと突き合わせる。**無いと決めつけず、必ず探してから判断する。**',
          `3. \`${teamDir}/tasks/\` に、優先順に並べた作業単位を書く（1 ファイル 1 件）。`,
          '',
          '**実装はしない。** この反復は計画だけである。'
        ].join('\n')
      : [
          '## いまやること: 実装',
          '',
          `1. \`${teamDir}/tasks/\` を読み、**いちばん優先度の高い未着手の 1 件だけ**に取り組む。`,
          '2. 変更したら、その範囲の検査を走らせる。',
          '3. 通ったら `tasks/` の状態を更新し、コミットする。',
          '',
          '**1 反復 1 件。** まとめて片付けようとしない。',
          '**置き石を残さない。** 後で書き直す前提の仮実装は、二度手間になるだけである。'
        ].join('\n')

  return [
    `# 反復 ${iteration}`,
    '',
    '前の反復の記憶は残っていない。**引き継いだのは以下だけ**である。',
    '',
    '## これまでに分かったこと',
    '',
    carried,
    feedback,
    work,
    '',
    '## 終わる前に必ずやること',
    '',
    '`izuna_progress` を**最後に呼ぶ**。これが次の反復への唯一の引き継ぎである。',
    '',
    '- `learnings` には**これまでの分に、今回の分を足して**渡す（上書きしない）',
    `- 計画が終わったら \`phase\` を \`building\` にする`,
    '- **`tasks/` が全部片付き、`brief.md` の受け入れ条件を満たしたときだけ** `completionSignal` を `true` にする',
    '- 進めないときは `status` を `blocked` にし、`blockers` に理由を書く。**黙って諦めない**'
  ].join('\n')
}

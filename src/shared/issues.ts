import type { GitHubIssue } from '../main/forge/github'
import type { ForgejoIssue } from '../main/forge/client'

/**
 * Issue の出どころを揃える（2026-09-11）。
 *
 * それまで Issue は `gh`（GitHub）からしか読んでいなかった。GitHub を使わず Forgejo だけで
 * 回している人には「最初の依頼」に何も出ない —— 対象は「自分の Forgejo を持つ人」なのに、
 * 入口が GitHub 前提だった。GitHub と Forgejo の両方を読み、出どころの札を付けて並べる。
 * どちらか読めなければ片方だけ。両方読めなければ null（「繋がっていない」）。
 */
export type IssueSource = 'github' | 'forgejo'

export interface SourcedIssue {
  source: IssueSource
  number: number
  title: string
  url: string
}

/** GitHub を先に。並びは出どころが返した順のまま（`gh` も Forgejo も新しいものを先に返す） */
export function mergeIssues(
  github: GitHubIssue[] | null,
  forgejo: ForgejoIssue[] | null
): SourcedIssue[] | null {
  if (github === null && forgejo === null) return null
  return [
    ...(github ?? []).map((i) => ({ source: 'github' as const, ...pick(i) })),
    ...(forgejo ?? []).map((i) => ({ source: 'forgejo' as const, ...pick(i) }))
  ]
}

/**
 * 読めなかったときの受け皿。**黙って null にしない** —— 何が読めなかったかを console に残す。
 * `test/ratchet.test.ts` は `.catch(() => null)` を握りつぶしとして数える。理由を残すものは数えない
 */
export const unavailable =
  (what: string) =>
  (e: unknown): null => {
    console.warn(`${what} を読めませんでした`, e)
    return null
  }

const pick = (i: { number: number; title: string; url: string }): Omit<SourcedIssue, 'source'> => ({
  number: i.number,
  title: i.title,
  url: i.url
})

/** 出どころの札に出す字。訳さない（画面の言葉は固有名のまま。§17.4） */
export const SOURCE_LABEL: Record<IssueSource, string> = { github: 'GitHub', forgejo: 'Forgejo' }

/** 最初の依頼の文。GitHub と同じ形で、出どころだけ違う */
export function issuePrompt(i: SourcedIssue): string {
  return `${SOURCE_LABEL[i.source]} の Issue #${i.number}「${i.title}」に取り組んでください。\n${i.url}`
}

/** 同じ Issue か。番号は出どころごとに独立なので、出どころも見る */
export const sameIssue = (a: SourcedIssue | null, b: SourcedIssue): boolean =>
  a !== null && a.source === b.source && a.number === b.number

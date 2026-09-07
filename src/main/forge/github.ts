import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loginShellEnv } from '../claude/locate'

const exec = promisify(execFile)

/**
 * GitHub 側（段5 の出口）。
 *
 * **`gh` に任せる。API クライアントは書かない。** 認証済みで、スコープも足りていて、
 * 保守も向こうがやる。Forgejo は `gh` を向けられないので自作したが、
 * こちらは違う（docs/GOAL.md 柱2）。
 *
 * 共通インタフェースは作らない。役割が違うものを無理に揃えると両方が歪む。
 */

export interface GitHubIssue {
  number: number
  title: string
  url: string
  state: string
  labels: string[]
  updatedAt: string
}

export interface GitHubPull {
  number: number
  title: string
  url: string
  state: string
  headRefName: string
  isDraft: boolean
}

async function gh(cwd: string, args: string[]): Promise<string> {
  const env = await loginShellEnv()
  try {
    const { stdout } = await exec('gh', args, { cwd, env, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    // gh の言い分をそのまま見せる。握りつぶすと原因が分からなくなる
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}

export async function listIssues(cwd: string, limit = 30): Promise<GitHubIssue[]> {
  const out = await gh(cwd, [
    'issue', 'list', '--state', 'open', '--limit', String(limit),
    '--json', 'number,title,url,state,labels,updatedAt'
  ])
  type RawIssue = Omit<GitHubIssue, 'labels'> & { labels: Array<{ name: string }> }
  const raw = JSON.parse(out) as RawIssue[]
  return raw.map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }))
}

export async function listPulls(cwd: string, limit = 30): Promise<GitHubPull[]> {
  const out = await gh(cwd, [
    'pr', 'list', '--state', 'open', '--limit', String(limit),
    '--json', 'number,title,url,state,headRefName,isDraft'
  ])
  return JSON.parse(out) as GitHubPull[]
}

export interface CreatePrInput {
  title: string
  body: string
  head: string
  base?: string
  draft?: boolean
}

/**
 * 出口の PR を作る。**ここが GitHub に出る唯一の入口**（GOAL.md 測り方）。
 * 作業ブランチも一段目の PR も、ここを通らずに GitHub へ行ってはいけない。
 */
export async function createPull(cwd: string, input: CreatePrInput): Promise<string> {
  const args = [
    'pr', 'create',
    '--title', input.title,
    '--body', input.body,
    '--head', input.head
  ]
  if (input.base) args.push('--base', input.base)
  if (input.draft) args.push('--draft')
  return (await gh(cwd, args)).trim()
}

/** 認証と対象リポジトリの確認 */
export async function ghStatus(cwd: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const out = await gh(cwd, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
    return { ok: true, detail: out.trim() }
  } catch (e) {
    return { ok: false, detail: String(e).replace(/^Error:\s*/, '').split('\n')[0] }
  }
}

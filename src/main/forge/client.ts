import { loadToken } from './store'
import { tokenMayTravel, transportRefusal } from '../../shared/forge'

/**
 * Forgejo の API クライアント（段5）。
 *
 * `gh` は Forgejo に向けられないので、ここだけは自作する（docs/GOAL.md 柱2）。
 * 逆に GitHub 側は `gh` に任せるので、共通インタフェースは作らない ——
 * 役割が違うものを無理に揃えると両方が歪む。
 */

export interface ForgejoRepo {
  fullName: string
  owner: string
  name: string
  private: boolean
  defaultBranch: string
  htmlUrl: string
  empty: boolean
}

export interface ForgejoPull {
  number: number
  title: string
  state: 'open' | 'closed'
  head: string
  base: string
  htmlUrl: string
  draft: boolean
  merged: boolean
  createdAt: string
}

export class ForgeError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

async function call<T>(rootUrl: string, path: string, init?: RequestInit): Promise<T> {
  const res = await request(rootUrl, path, init)
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** 本文を文字列で返す口。PR の `.diff` はJSON ではない */
async function callText(rootUrl: string, path: string): Promise<string> {
  return (await request(rootUrl, path)).text()
}

async function request(rootUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const token = await loadToken()
  if (!token)
    throw new ForgeError('Forgejo のトークンが未設定です。「Forgejo」画面から発行してください', 0)
  // 平文で LAN を通る経路には載せない（§26）
  if (!tokenMayTravel(rootUrl)) throw new ForgeError(transportRefusal(rootUrl), 0)

  const res = await fetch(new URL(`api/v1/${path}`, rootUrl), {
    ...init,
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    },
    signal: AbortSignal.timeout(15_000)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // 403 tokenRequiresScopes は実際に踏んだ。原因が読める文言にする
    // 403 tokenRequiresScopes は実際に踏んだ。**足りない権限を名指しする** ——
    // 「スコープが足りません」だけでは、何をどう直すのか分からない
    const missing = /required scope\(s\): \[([^\]]+)\]/.exec(body)?.[1]
    const hint =
      res.status === 403 && /scope/i.test(body)
        ? `トークンに ${missing ?? '必要な権限'} がありません。` +
          '「Forgejo」画面の「トークンを発行」で作り直してください（古いものは差し替わります）'
        : body.slice(0, 300) || res.statusText
    throw new ForgeError(`Forgejo が ${res.status} を返しました: ${hint}`, res.status)
  }
  return res
}

type RawRepo = {
  full_name: string
  owner: { login: string }
  name: string
  private: boolean
  default_branch: string
  html_url: string
  empty: boolean
}

export async function listRepos(rootUrl: string): Promise<ForgejoRepo[]> {
  // 自分が見えるものだけ。search は公開分しか返さないので使わない
  const raw = await call<RawRepo[]>(rootUrl, 'user/repos?limit=100')
  return raw.map((r) => ({
    fullName: r.full_name,
    owner: r.owner.login,
    name: r.name,
    private: r.private,
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
    empty: r.empty
  }))
}

type RawPull = {
  number: number
  title: string
  state: string
  head: { ref: string }
  base: { ref: string }
  html_url: string
  draft: boolean
  merged: boolean
  created_at: string
}

const toPull = (p: RawPull): ForgejoPull => ({
  number: p.number,
  title: p.title,
  state: p.state === 'closed' ? 'closed' : 'open',
  head: p.head.ref,
  base: p.base.ref,
  htmlUrl: p.html_url,
  draft: p.draft,
  merged: p.merged,
  createdAt: p.created_at
})

/**
 * open な PR の一覧。
 *
 * **中身の無いリポジトリは 404 を返す**（2026-09-08 実測。リポジトリ自体は 200、
 * `/branches` も 200 なのに `/pulls` だけ 404）。作った直後の sandbox が
 * まさにその状態なので、画面を開くたびに例外が飛んでいた。
 *
 * **コミットが 1 つも無ければ PR は存在しえない。** 404 は異常ではなく
 * 「まだ無い」なので、空で返す。**それ以外の失敗は握りつぶさない。**
 */
export async function listPulls(
  rootUrl: string,
  owner: string,
  repo: string
): Promise<ForgejoPull[]> {
  try {
    return (await call<RawPull[]>(rootUrl, `repos/${owner}/${repo}/pulls?state=open&limit=50`)).map(
      toPull
    )
  } catch (e) {
    if (e instanceof ForgeError && e.status === 404) return []
    throw e
  }
}

export async function createPull(
  rootUrl: string,
  owner: string,
  repo: string,
  input: { title: string; head: string; base: string; body?: string }
): Promise<ForgejoPull> {
  return toPull(
    await call<RawPull>(rootUrl, `repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  )
}

/** 接続確認。トークンが誰のものかを返す */
export async function whoami(rootUrl: string): Promise<string> {
  const me = await call<{ login: string }>(rootUrl, 'user')
  return me.login
}

/** リポジトリが無ければ作る。作業場は壊れたら作り直す前提なので冪等にする */
export async function ensureRepo(rootUrl: string, name: string): Promise<ForgejoRepo> {
  const owner = await whoami(rootUrl)
  const existing = await listRepos(rootUrl)
  const found = existing.find((r) => r.name === name && r.owner === owner)
  if (found) return found

  const raw = await call<RawRepo>(rootUrl, 'user/repos', {
    method: 'POST',
    body: JSON.stringify({
      name,
      private: true,
      auto_init: false,
      description: 'Izuna の作業場（壊れたら作り直してよい）'
    })
  })
  return {
    fullName: raw.full_name,
    owner: raw.owner.login,
    name: raw.name,
    private: raw.private,
    defaultBranch: raw.default_branch,
    htmlUrl: raw.html_url,
    empty: raw.empty
  }
}

export interface ForgejoToken {
  id: number
  name: string
  /** 実際に与えられている権限。**記録ではなくサーバが持つ事実** */
  scopes: string[]
  /** 末尾 8 文字。手元のトークンと突き合わせて「いまのもの」を見分ける */
  last8: string
  createdAt: string
}

/**
 * トークンの一覧。
 *
 * **削除はここからできない。** `DELETE /users/{u}/tokens/{id}` は
 * `auth method not allowed` を返す（パスワード認証が要る。実測 2026-09-08）。
 * だから Izuna は**見せるところまで**をやり、消すのは Forgejo の画面に任せる。
 */
export async function listTokens(rootUrl: string, user: string): Promise<ForgejoToken[]> {
  const raw = await call<
    Array<{
      id: number
      name: string
      scopes: string[] | null
      token_last_eight: string
      created_at: string
    }>
  >(rootUrl, `users/${encodeURIComponent(user)}/tokens`)
  return raw.map((t) => ({
    id: t.id,
    name: t.name,
    scopes: t.scopes ?? [],
    last8: t.token_last_eight,
    createdAt: t.created_at
  }))
}

/**
 * PR の差分（unified diff の文字列）。読むのは `shared/patch.ts`。
 * `GET /repos/{owner}/{repo}/pulls/{index}.diff`（2026-09-09 に `pnpm e2e` で実機確認。§30）
 */
export async function pullDiff(
  rootUrl: string,
  owner: string,
  repo: string,
  index: number
): Promise<string> {
  return callText(
    rootUrl,
    `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${index}.diff`
  )
}

/** Actions の 1 回の実行。形は `shared/ci.ts` が読む */
export interface ForgejoRun {
  id: number
  title: string
  /** Forgejo がそのまま返す語（success / failure / running / waiting / cancelled …） */
  status: string
  event: string
  /** `refs/heads/feat/x` の形で来る。ブランチと突き合わせるのは `shared/ci.ts` */
  ref: string
  sha: string
  htmlUrl: string
  workflow: string
  startedAt: string | null
  stoppedAt: string | null
}

type RawRun = {
  id: number
  title: string
  status: string
  event: string
  prettyref?: string
  head_branch?: string
  commit_sha: string
  html_url: string
  workflow_id: string
  started: string | null
  stopped: string | null
}

/**
 * Actions の実行一覧（GOAL.md 測り方「Izuna がその状態を読める」）。
 *
 * `GET /repos/{owner}/{repo}/actions/runs`（Forgejo 16.0.3 の swagger にある。
 * 応答は配列か `{ workflow_runs }` のどちらか —— Gitea は後者で、Forgejo の
 * 文書は形を書いていないので両方読む）。`ref` を渡せばそのブランチだけ。
 *
 * **Actions が無効なら 404 が返る。** 「回していない」は異常ではないので空で返す。
 * それ以外の失敗は握りつぶさない（`listPulls` と同じ）。
 */
export async function listRuns(
  rootUrl: string,
  owner: string,
  repo: string,
  ref?: string
): Promise<ForgejoRun[]> {
  const q = new URLSearchParams({ limit: '20' })
  if (ref) q.set('ref', ref.startsWith('refs/') ? ref : `refs/heads/${ref}`)
  try {
    const raw = await call<RawRun[] | { workflow_runs?: RawRun[] }>(
      rootUrl,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs?${q}`
    )
    const list = Array.isArray(raw) ? raw : (raw.workflow_runs ?? [])
    return list.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      event: r.event,
      ref: r.prettyref ?? (r.head_branch ? `refs/heads/${r.head_branch}` : ''),
      sha: r.commit_sha,
      htmlUrl: r.html_url,
      workflow: r.workflow_id,
      startedAt: r.started || null,
      stoppedAt: r.stopped || null
    }))
  } catch (e) {
    if (e instanceof ForgeError && e.status === 404) return []
    throw e
  }
}

/**
 * git remote の解釈（段5）。
 *
 * 純粋関数。二段の PR（docs/GOAL.md 柱2）を成り立たせる要で、
 * **どの remote が sandbox でどれが upstream か**をここで決める。
 *
 * ```
 * forgejo  http://localhost:4649/watakumi/gh-radar.git   sandbox
 * origin   git@github.com:Watakumi/gh-radar.git          upstream
 * ```
 */

/**
 * remote の役割。
 *
 * `sandbox`  Forgejo。エージェントが荒らす場。壊れたら作り直す
 * `upstream` GitHub。仕上がったものを送る先。既存の資産がある
 */
export type RemoteRole = 'sandbox' | 'upstream' | 'other'

export interface RemoteRef {
  name: string
  url: string
  host: string | null
  owner: string | null
  repo: string | null
  role: RemoteRole
}

/**
 * `git remote -v` の 1 行を読む。
 * ssh 形式（`git@host:owner/repo.git`）と http(s) 形式の両方。
 */
export function parseRemoteUrl(url: string): { host: string; owner: string; repo: string } | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  // git@host:owner/repo.git / ssh://git@host[:port]/owner/repo.git
  const ssh = /^(?:ssh:\/\/)?(?:[^@/]+@)?([^:/]+)(?::\d+)?[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(trimmed)
  if (ssh && !/^https?:/.test(trimmed)) {
    return { host: ssh[1], owner: ssh[2], repo: ssh[3] }
  }

  try {
    const u = new URL(trimmed)
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/').filter(Boolean)
    if (parts.length < 2) return null
    // owner/repo は末尾 2 つ。Forgejo は sub path に置けるため
    return { host: u.host, owner: parts.at(-2)!, repo: parts.at(-1)! }
  } catch {
    return null
  }
}

const GITHUB_HOSTS = ['github.com', 'www.github.com']

/**
 * 役割を決める。
 *
 * **ホスト名で決める。remote の名前では決めない** —— `origin` が
 * どちらを指しているかは人によって違い、名前を信じると取り違える。
 */
export function roleOf(host: string | null, forgeHost: string | null): RemoteRole {
  if (!host) return 'other'
  if (GITHUB_HOSTS.includes(host.toLowerCase())) return 'upstream'
  if (forgeHost && host.toLowerCase() === forgeHost.toLowerCase()) return 'sandbox'
  return 'other'
}

/** `git remote -v` の出力をまとめて読む。fetch/push の重複は畳む */
export function parseRemotes(output: string, forgeRootUrl: string | null): RemoteRef[] {
  const forgeHost = hostOf(forgeRootUrl)
  const seen = new Map<string, RemoteRef>()

  for (const line of output.split('\n')) {
    const m = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/.exec(line.trim())
    if (!m) continue
    const [, name, url] = m
    if (seen.has(name)) continue
    const parsed = parseRemoteUrl(url)
    seen.set(name, {
      name,
      url,
      host: parsed?.host ?? null,
      owner: parsed?.owner ?? null,
      repo: parsed?.repo ?? null,
      role: roleOf(parsed?.host ?? null, forgeHost)
    })
  }
  return [...seen.values()]
}

export function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/** sandbox と upstream を取り出す。無ければ null */
export function rolesIn(remotes: RemoteRef[]): { sandbox: RemoteRef | null; upstream: RemoteRef | null } {
  return {
    sandbox: remotes.find((r) => r.role === 'sandbox') ?? null,
    upstream: remotes.find((r) => r.role === 'upstream') ?? null
  }
}

/** sandbox の remote をこれから足すときの URL */
export function sandboxRemoteUrl(forgeRootUrl: string, owner: string, repo: string): string {
  return `${forgeRootUrl.replace(/\/$/, '')}/${owner}/${repo}.git`
}

/**
 * 二段の PR のどの段にいるか。画面の出し分けに使う。
 *
 * - `needsSandbox`  sandbox の remote が無い。まず用意する
 * - `needsPush`     sandbox に push していない
 * - `readyForUpstream` sandbox では見た。GitHub に出せる
 */
export function stageOf(input: {
  remotes: RemoteRef[]
  pushedToSandbox: boolean
}): 'needsSandbox' | 'needsPush' | 'readyForUpstream' {
  const { sandbox } = rolesIn(input.remotes)
  if (!sandbox) return 'needsSandbox'
  if (!input.pushedToSandbox) return 'needsPush'
  return 'readyForUpstream'
}

/**
 * GitHub に漏れた作業ブランチ（GOAL.md 測り方「GitHub に出るのは 6 の二段目だけ」）。
 *
 * sandbox にあるブランチが upstream にもあれば、それは作業ブランチが外に出ている。
 * 例外は upstream の既定ブランチと、**いま出そうとしているブランチ**（二段目の PR は
 * そのブランチを upstream に push しなければ作れない）。
 *
 * 純粋関数。ブランチの一覧は `main/git/remote.ts` の `remoteHeads` が取る。
 */
export function upstreamLeaks(input: {
  upstreamHeads: string[]
  sandboxHeads: string[]
  /** 出てよいもの。既定ブランチと、いま出すブランチ */
  allowed: Array<string | null>
}): string[] {
  const ok = new Set(input.allowed.filter((b): b is string => !!b))
  const sandbox = new Set(input.sandboxHeads)
  return input.upstreamHeads.filter((b) => sandbox.has(b) && !ok.has(b)).sort()
}

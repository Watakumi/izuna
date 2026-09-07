import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseRemotes, sandboxRemoteUrl, type RemoteRef } from '../../shared/remote'
import { loginShellEnv } from '../claude/locate'
import { resolved } from '../config'

const exec = promisify(execFile)

/** remote の操作（段5）。解釈は `shared/remote.ts` が持つ */

async function git(cwd: string, args: string[]): Promise<string> {
  const env = await loginShellEnv()
  try {
    const { stdout } = await exec('git', args, { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}

export async function listRemotes(cwd: string, forgeRootUrl: string | null): Promise<RemoteRef[]> {
  return parseRemotes(await git(cwd, ['remote', '-v']), forgeRootUrl)
}

/** sandbox の remote を用意する。既にあれば URL を合わせるだけ */
export async function ensureSandboxRemote(
  cwd: string,
  forgeRootUrl: string,
  owner: string,
  repo: string,
  name?: string
): Promise<string> {
  name ??= (await resolved()).sandboxRemote
  const url = sandboxRemoteUrl(forgeRootUrl, owner, repo)
  const existing = await listRemotes(cwd, forgeRootUrl)
  if (existing.some((r) => r.name === name)) {
    await git(cwd, ['remote', 'set-url', name, url])
    return `${name} の URL を ${url} に合わせました`
  }
  await git(cwd, ['remote', 'add', name, url])
  return `${name} を ${url} として足しました`
}

/**
 * その remote の既定ブランチ。
 *
 * **`main` と決め打たない。** `master` や `develop` のリポジトリで
 * PR が作れなくなる。remote の HEAD を見て、無ければ聞きに行く。
 */
export async function defaultBranch(cwd: string, remoteName: string): Promise<string | null> {
  // 手元に記録があればそれ。ネットワークに出ない
  try {
    const ref = (await git(cwd, ['symbolic-ref', '--short', `refs/remotes/${remoteName}/HEAD`])).trim()
    const branch = ref.replace(new RegExp(`^${remoteName}/`), '')
    if (branch) return branch
  } catch {
    // HEAD が張られていないことがある。下で聞く
  }
  try {
    const out = await git(cwd, ['remote', 'show', remoteName])
    return /HEAD branch:\s*(\S+)/.exec(out)?.[1] ?? null
  } catch {
    return null
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const out = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return out === 'HEAD' ? null : out
}

/** 指定の remote に push する。上流も張る */
export async function push(cwd: string, remote: string, branch: string): Promise<string> {
  await git(cwd, ['push', '--set-upstream', remote, branch])
  return `${remote} に ${branch} を push しました`
}

/** その remote に、そのブランチが既にあるか */
export async function isPushed(cwd: string, remote: string, branch: string): Promise<boolean> {
  try {
    const out = await git(cwd, ['ls-remote', '--heads', remote, branch])
    return out.trim() !== ''
  } catch {
    return false
  }
}

/** PR の本文の材料。base から先のコミットを並べる */
export async function commitsSince(cwd: string, base: string, limit = 30): Promise<string[]> {
  try {
    const out = await git(cwd, ['log', `${base}..HEAD`, `--max-count=${limit}`, '--pretty=%s'])
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

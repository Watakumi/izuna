import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseRemotes, sandboxRemoteUrl, type RemoteRef } from '../../shared/remote'
import type { CommitContext } from '../../shared/commit'
import { loginShellEnv } from '../claude/locate'
import { resolved } from '../config'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadToken } from '../forge/store'
import { whoami } from '../forge/client'
import { tokenMayTravel, transportRefusal } from '../../shared/forge'

const exec = promisify(execFile)

/** remote の操作（段5）。解釈は `shared/remote.ts` が持つ */

async function git(cwd: string, args: string[], extra: NodeJS.ProcessEnv = {}): Promise<string> {
  const env = { ...(await loginShellEnv()), ...extra }
  try {
    const { stdout } = await exec('git', args, { cwd, env, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    throw new Error((e.stderr || e.message || String(err)).trim())
  }
}

/**
 * sandbox（Forgejo）へ渡す資格情報。
 *
 * **作るリポジトリは private なので、匿名では push できない。**
 * それを git は `Repository not found` と言う（401 を 404 に言い換える）ので、
 * 「リポジトリが無い」と読めてしまい、原因に辿り着けない。
 *
 * **トークンを remote の URL や `.git/config` に埋めない。** 埋めると平文で残り、
 * `git remote -v` にも出て、そのまま他人に見せる画面に載る。
 * `GIT_ASKPASS` に小さな仲介を置き、**環境変数で渡してその場で捨てる**。
 * 引数に置かないのは、`ps` で他のプロセスから見えるからである。
 */
interface Askpass {
  env: NodeJS.ProcessEnv
  /** 使い終わったら消す。**必ず呼ぶ** */
  dispose: () => Promise<void>
}

/**
 * **仲介は呼ぶたびに作り、使い終わったら消す。**
 *
 * 固定のパスに `mode: 0o700` で書いていたが、`mode` は新規作成のときしか
 * 効かない。同じユーザのプロセス（押している最中のエージェントを含む）が
 * 先に置き換えていれば、その中身が `$IZUNA_GIT_TOKEN` を受け取る（§26）。
 * `mkdtemp` で毎回別の場所に、`wx`（既にあれば失敗）で書く。
 */
async function askpassEnv(root: string): Promise<Askpass | null> {
  const [token, user] = await Promise.all([
    loadToken(),
    whoami(root).catch(() => null)
  ])
  if (!token || !user) return null

  const dir = await mkdtemp(join(tmpdir(), 'izuna-askpass-'))
  const path = join(dir, 'askpass.sh')
  await writeFile(path, [
    '#!/bin/sh',
    '# Izuna が git に資格情報を渡すための仲介。値は環境変数から取る',
    'case "$1" in',
    '  *[Uu]sername*) printf %s "$IZUNA_GIT_USER" ;;',
    '  *) printf %s "$IZUNA_GIT_TOKEN" ;;',
    'esac'
  ].join('\n') + '\n', { mode: 0o700, flag: 'wx' })

  return {
    env: {
      GIT_ASKPASS: path,
      IZUNA_GIT_USER: user,
      IZUNA_GIT_TOKEN: token,
      // 端末が無いので、聞かれたら黙って失敗させる（待たせない）
      GIT_TERMINAL_PROMPT: '0'
    },
    dispose: () => rm(dir, { recursive: true, force: true })
  }
}

/**
 * sandbox 相手のときだけ資格情報を付ける。
 * **GitHub は ssh なので要らない**（付けると余計な失敗を増やす）。
 */
async function credentials(
  cwd: string, remote: string, forgeRootUrl: string | null
): Promise<{ env: NodeJS.ProcessEnv; args: string[]; dispose: () => Promise<void> }> {
  const none = { env: {}, args: [], dispose: async (): Promise<void> => {} }
  if (!forgeRootUrl) return none
  try {
    const url = (await git(cwd, ['remote', 'get-url', remote])).trim()
    if (!url.startsWith(new URL(forgeRootUrl).origin)) return none
  } catch {
    return none
  }
  // sandbox 相手と分かった。平文で LAN を通る経路には載せない（§26）
  if (!tokenMayTravel(forgeRootUrl)) throw new Error(transportRefusal(forgeRootUrl))
  const askpass = await askpassEnv(forgeRootUrl)
  if (!askpass) return none

  /**
   * **credential helper を止める。**
   *
   * これを止めないと `GIT_ASKPASS` は呼ばれない。git は helper を先に試し、
   * 返ってきた値をそのまま使う。この環境では `/opt/homebrew/etc/gitconfig` に
   * `osxkeychain` が入っていて、**別の（古い）資格情報を返していた**。
   *
   * その結果 Forgejo は「認証は通ったが、その private リポジトリを見る権限が
   * 無い利用者」と判断し、**401 ではなく 404** を返す。git はそれを
   * `Repository not found` と表示するので、**認証の問題だと分からない**。
   * 匿名なら 401 が返るのに、中途半端に認証されるほうが原因を隠す。
   */
  return { env: askpass.env, args: ['-c', 'credential.helper='], dispose: askpass.dispose }
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
export async function push(
  cwd: string, remote: string, branch: string, forgeRootUrl: string | null = null
): Promise<string> {
  const cred = await credentials(cwd, remote, forgeRootUrl)
  try {
    await git(cwd, [...cred.args, 'push', '--set-upstream', remote, branch], cred.env)
  } finally {
    await cred.dispose()
  }
  return `${remote} に ${branch} を push しました`
}

/** その remote に、そのブランチが既にあるか */
export async function isPushed(
  cwd: string, remote: string, branch: string, forgeRootUrl: string | null = null
): Promise<boolean> {
  let cred: Awaited<ReturnType<typeof credentials>> | null = null
  try {
    cred = await credentials(cwd, remote, forgeRootUrl)
    const out = await git(cwd, [...cred.args, 'ls-remote', '--heads', remote, branch], cred.env)
    return out.trim() !== ''
  } catch {
    return false
  } finally {
    await cred?.dispose()
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

/**
 * コミット文の下書きに渡す材料を集める。
 *
 * **差分の中身は取らない**（`shared/commit.ts` の註）。
 * 何百 KB もの差分より、触ったファイルと会話のほうが効く。
 */
export async function commitContext(cwd: string): Promise<CommitContext> {
  const [status, branch, recent] = await Promise.all([
    git(cwd, ['status', '--porcelain']).catch(() => ''),
    currentBranch(cwd).catch(() => null),
    git(cwd, ['log', '-5', '--format=%s']).catch(() => '')
  ])
  return {
    changed: status.split('\n').map((l) => l.trim()).filter(Boolean),
    branch,
    recent: recent.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}

#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 型の無い .mjs。検査は JSDoc ではなく test/scripts-gates.test.ts で見る */
/**
 * push の門（docs/NIMBALYST.md §3 の 5）。`.githooks/pre-push` から呼ばれる。
 *
 * 1. **届けるコミットが無ければ飛ばす。** タグだけの push や、既に届いている
 *    ブランチの再 push で verify を回さない（Nimbalyst は release でこれを二重に払っていた）
 * 2. **検査用の作者のコミットを拒む。** 検査は本物の git リポジトリを作る
 *    （`test/main-git.test.ts` は `t@example.com`）。逃げ出したコミットは実の仕事ではない
 * 3. **manifest が変わったときだけ lockfile の同期を見る。** CI の `--frozen-lockfile` が
 *    落とすものを、押す前に手元で落とす
 * 4. `pnpm verify`
 *
 * `IZUNA_SKIP_VERIFY=1 git push` で 4 だけ飛ばせる。1–3 は飛ばせない。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ZERO = /^0+$/

/** git が stdin にくれる「<localRef> <localSha> <remoteRef> <remoteSha>」から、届ける sha を取る */
export function localShas(stdin) {
  return stdin.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\s+/)[1]).filter((sha) => sha && !ZERO.test(sha))
}

const FORBIDDEN_NAMES = new Set(['t', 'Test', 'Test User', 'Your Name'])
const FORBIDDEN_EMAIL = /(^test@|^t@|^fixture[-@]|@example\.(com|net|org)$|\.(test|invalid|example)$)/i

/** `git log --format=%H%x09%an%x09%ae` の出力から、検査用の作者のものを返す */
export function forbiddenAuthors(logOutput) {
  return logOutput.split('\n').filter(Boolean).map((l) => {
    const [sha, name, email] = l.split('\t')
    return { sha, name: name ?? '', email: email ?? '' }
  }).filter(({ name, email }) => FORBIDDEN_NAMES.has(name) || FORBIDDEN_EMAIL.test(email))
}

/**
 * 秘密の走査に渡す引数。**届けるコミットだけ**を gitleaks に見せる（履歴全体は CI が見る）。
 * `git log` の範囲指定をそのまま渡す。
 */
export function secretScanArgs(shas, remote) {
  const range = shas.length > 0 ? `${shas.join(' ')} --not --remotes=${remote}` : `HEAD --not --remotes=${remote}`
  return ['git', '--no-banner', '--redact', '--exit-code', '1', `--log-opts=${range}`, '.']
}

export function manifestChanged(files) {
  return files.some((f) => /(^|\/)package\.json$|^pnpm-lock\.yaml$|^pnpm-workspace\.yaml$/.test(f))
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

function main() {
  const remote = process.argv[2] ?? 'origin'
  const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8')
  const shas = localShas(stdin)
  if (stdin.trim() !== '' && shas.length === 0) {
    console.log('[pre-push] 削除だけの push。門は無い')
    return 0
  }
  const range = shas.length > 0 ? [...shas, '--not', `--remotes=${remote}`] : ['HEAD', '--not', `--remotes=${remote}`]
  const count = Number.parseInt(git('rev-list', '--count', ...range).trim(), 10)
  if (count === 0) {
    console.log(`[pre-push] ${remote} に届ける新しいコミットが無い。門を飛ばす`)
    return 0
  }

  const bad = forbiddenAuthors(git('log', '--format=%H%x09%an%x09%ae', ...range))
  if (bad.length > 0) {
    console.error('[pre-push] 検査用の作者のコミットが混じっている。逃げ出した fixture である:')
    for (const b of bad) console.error(`  ${b.sha.slice(0, 10)}  ${b.name} <${b.email}>`)
    return 1
  }

  const changed = git('diff', '--name-only', ...range).split('\n').filter(Boolean)
  if (manifestChanged(changed)) {
    console.log('[pre-push] manifest が変わっている。lockfile の同期を見る')
    const r = spawnSync('pnpm', ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'], { stdio: 'inherit' })
    if (r.status !== 0) {
      console.error('[pre-push] pnpm-lock.yaml が package.json と合っていない。pnpm install して lockfile をコミットすること')
      return 1
    }
  }

  // 秘密の走査。public に出す前提なので、届けるコミットに鍵が混じっていれば止める。
  // gitleaks が無ければ止める —— 無いことを緑で通すと門にならない（brew install gitleaks）
  const leaks = spawnSync('gitleaks', secretScanArgs(shas, remote), { stdio: 'inherit' })
  if (leaks.error) {
    console.error('[pre-push] gitleaks が無い。brew install gitleaks で入れること（秘密の走査は門である）')
    return 1
  }
  if (leaks.status !== 0) {
    console.error('[pre-push] 届けるコミットに秘密らしきものがある。上の指摘を見て取り除くこと')
    return 1
  }

  if (process.env.IZUNA_SKIP_VERIFY === '1') {
    console.log('[pre-push] IZUNA_SKIP_VERIFY=1。verify は飛ばす（作者と lockfile は見た）')
    return 0
  }
  console.log('[pre-push] pnpm verify')
  const v = spawnSync('pnpm', ['verify'], { stdio: 'inherit' })
  return v.status === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}

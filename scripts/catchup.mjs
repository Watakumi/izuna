/* eslint-disable @typescript-eslint/explicit-function-return-type -- 型の無い .mjs。検査は test/scripts-gates.test.ts */
/**
 * claude が上がったあと、Izuna をそれに揃える。
 *   pnpm run catchup            揃える（SDK が熟成の線を越えていなければ止まる）
 *   pnpm run catchup --check    何が要るかを言うだけ。何も変えない
 *
 * 手順は testing.md §10 の「順番を守る」そのもの:
 *   1. 手元の claude の版を読む
 *   2. 同じパッチ番号の SDK が §27 の熟成の線（minimumReleaseAge）を越えているか npm に聞く
 *   3. 越えていれば SDK を上げ、platform バイナリの除外も同じ番号に
 *   4. fixture を録り直す（実 API。一時ディレクトリ、更新を止めて、家のパスは伏せる）
 *   5. MEASURED_CLI_VERSION と文書の版を上げる
 *   6. pnpm verify
 *
 * **定数だけ先に上げない。** 番号が合っても録っていなければ、測っていない。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = '@anthropic-ai/claude-agent-sdk'

/** `2.1.266 (Claude Code)` → `2.1.266` */
export function cliVersionOf(text) {
  return /(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null
}

/** CLI `2.1.N` に連動する SDK は `0.3.N`（DECISIONS §3） */
export function sdkVersionFor(cli) {
  const patch = cli.split('.')[2]
  return patch ? `0.3.${patch}` : null
}

/** 公開から `minMinutes` 経ったか（§27 の熟成の線）。時刻が読めなければ false */
export function agedEnough(publishedAt, minMinutes, now = Date.now()) {
  const t = Date.parse(publishedAt ?? '')
  if (Number.isNaN(t)) return false
  return now - t >= minMinutes * 60_000
}

/** pnpm-workspace.yaml の `minimumReleaseAge` と、除外に書かれた SDK の版 */
export function readReleagePolicy(yaml) {
  const min = Number(/^minimumReleaseAge:\s*(\d+)/m.exec(yaml)?.[1] ?? '0')
  const pinned = /claude-agent-sdk-[a-z0-9-]+@(\d+\.\d+\.\d+)/.exec(yaml)?.[1] ?? null
  return { minMinutes: min, pinned }
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts
  }).trim()
}

function replaceIn(file, from, to) {
  const path = join(ROOT, file)
  const text = readFileSync(path, 'utf8')
  if (!text.includes(from)) throw new Error(`${file} に ${from} が無い`)
  writeFileSync(path, text.split(from).join(to))
}

function main() {
  const check = process.argv.includes('--check')
  const cli = cliVersionOf(run('claude', ['--version']))
  if (!cli) throw new Error('claude --version が読めない')
  const measured = /MEASURED_CLI_VERSION = '([^']+)'/.exec(
    readFileSync(join(ROOT, 'scripts/protocol.ts'), 'utf8')
  )?.[1]
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const sdkNow = String(pkg.dependencies[SDK]).replace(/^[\^~]/, '')
  const sdkWant = sdkVersionFor(cli)
  console.log(`claude ${cli} / 実測 ${measured} / SDK ${sdkNow} → 要る SDK ${sdkWant}`)

  if (cli === measured && sdkNow === sdkWant) {
    console.log('揃っている。何もしない')
    return 0
  }

  const policy = readReleagePolicy(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'))
  let publishedAt = null
  try {
    publishedAt = run('npm', ['view', `${SDK}@${sdkWant}`, 'time.modified'])
  } catch {
    // 無い版
  }
  if (!publishedAt) {
    console.error(`SDK ${sdkWant} はまだ npm に無い。CLI が先に出ている。出るまで待つ`)
    return 1
  }
  if (!agedEnough(publishedAt, policy.minMinutes)) {
    const okAt = new Date(Date.parse(publishedAt) + policy.minMinutes * 60_000)
    console.error(
      `SDK ${sdkWant} は ${publishedAt} 公開。熟成の線（${policy.minMinutes} 分）を越えるのは ${okAt.toISOString()}。それまで待つ（§27）`
    )
    return 1
  }
  if (check) {
    console.log(
      `揃えられる。pnpm run catchup で SDK を ${sdkWant} に上げ、fixture を録り直し、版を ${cli} にする`
    )
    return 0
  }

  console.log(`[1/4] SDK を ${sdkWant} に`)
  if (policy.pinned && policy.pinned !== sdkWant)
    replaceIn('pnpm-workspace.yaml', `@${policy.pinned}`, `@${sdkWant}`)
  run('pnpm', ['add', `${SDK}@${sdkWant}`], { stdio: 'inherit' })

  console.log('[2/4] fixture を録り直す（実 API）')
  run('npx', ['tsx', 'scripts/record-fixture.ts', 'safe'], { stdio: 'inherit' })

  console.log(`[3/4] 版を ${cli} に`)
  replaceIn(
    'scripts/protocol.ts',
    `MEASURED_CLI_VERSION = '${measured}'`,
    `MEASURED_CLI_VERSION = '${cli}'`
  )
  const today = new Date().toISOString().slice(0, 10)
  const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8')
  const line = /- 最終更新の根拠となった CLI: `claude [^`]+`[^\n]*/.exec(claudeMd)?.[0]
  if (line)
    replaceIn(
      'CLAUDE.md',
      line,
      `- 最終更新の根拠となった CLI: \`claude ${cli}\`（${today} に pnpm run catchup で揃えた）/ macOS 26.4.1 / Node 24.15 / pnpm 11.22`
    )

  console.log('[4/4] pnpm verify')
  run('pnpm', ['verify'], { stdio: 'inherit' })
  console.log(`揃えた。claude ${cli} / SDK ${sdkWant}。差分を読んでコミットすること`)
  return 0
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    process.exit(main())
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exit(1)
  }
}

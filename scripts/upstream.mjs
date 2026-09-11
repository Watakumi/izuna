/* eslint-disable @typescript-eslint/explicit-function-return-type -- 型の無い .mjs。検査は test/scripts-upstream.test.ts */
/**
 * 追っているものの最新と手元を比べ、何が変わったかを読める形で出す。
 *   pnpm run upstream            claude と Forgejo。差があれば CHANGELOG の該当節も出す
 *   pnpm run upstream --json     機械向け
 *
 * 道具の性質上、claude と Forgejo の最新は追う（2026-09-11、利用者の判断）。ただし**上げるのは人**で、
 * ここは読むだけ。claude を揃えるのは `pnpm run catchup`、Forgejo は brew か Docker で人が上げる。
 * 週 1 回 CI でも回す（.github/workflows/upstream.yml）。
 *
 * 読む先:
 *   - claude の最新: npm の SDK（CLI 2.1.N と SDK 0.3.N は連動。DECISIONS §3）。公開時刻から熟成の線（§27）を越える日も出す
 *   - claude の変更: anthropics/claude-code の CHANGELOG.md（測った版の次から最新まで）
 *   - Forgejo の最新: Codeberg の releases API（prerelease は除く。手元と同じ系列の最新と、全体の最新）
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agedEnough, cliVersionOf, readReleagePolicy } from './catchup.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SDK = '@anthropic-ai/claude-agent-sdk'
const CHANGELOG = 'https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md'
const FORGEJO_RELEASES = 'https://codeberg.org/api/v1/repos/forgejo/forgejo/releases?limit=30'

/** `1.2.3` を比べる。a > b なら正 */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

/** CHANGELOG の `## X.Y.Z` の節のうち、from より新しく to 以下のものを新しい順で */
export function changelogBetween(markdown, from, to) {
  const out = []
  const re = /^## (\d+\.\d+\.\d+)\s*$/gm
  const heads = [...markdown.matchAll(re)]
  heads.forEach((m, i) => {
    const v = m[1]
    if (compareVersions(v, from) <= 0 || compareVersions(v, to) > 0) return
    const start = m.index + m[0].length
    const end = i + 1 < heads.length ? heads[i + 1].index : markdown.length
    out.push({ version: v, body: markdown.slice(start, end).trim() })
  })
  return out
}

/** Codeberg の releases から、prerelease を除いた最新。`major` を渡せばその系列の最新 */
export function latestRelease(releases, major) {
  const tags = releases
    .filter((r) => !r.prerelease && !r.draft)
    .map((r) => String(r.tag_name).replace(/^v/, ''))
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .filter((v) => major === undefined || v.split('.')[0] === String(major))
  return tags.sort(compareVersions).at(-1) ?? null
}

/** SDK 0.3.N の一覧から、最新の CLI の版と公開時刻 */
export function latestCli(versions, times) {
  const v = versions
    .filter((x) => /^0\.3\.\d+$/.test(x))
    .sort(compareVersions)
    .at(-1)
  if (!v) return null
  return { sdk: v, cli: `2.1.${v.split('.')[2]}`, publishedAt: times?.[v] ?? null }
}

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.text()
}

async function main() {
  const json = process.argv.includes('--json')
  const measured = /MEASURED_CLI_VERSION = '([^']+)'/.exec(
    readFileSync(join(ROOT, 'scripts', 'protocol.ts'), 'utf8')
  )?.[1]
  const policy = readReleagePolicy(readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8'))

  // claude
  const npmVersions = JSON.parse(sh('npm', ['view', SDK, 'versions', '--json']) ?? '[]')
  const npmTimes = JSON.parse(sh('npm', ['view', SDK, 'time', '--json']) ?? '{}')
  const latest = latestCli(npmVersions, npmTimes)
  const local = cliVersionOf(sh('claude', ['--version']) ?? '')
  let changes = []
  if (latest && measured && compareVersions(latest.cli, measured) > 0) {
    try {
      changes = changelogBetween(await fetchText(CHANGELOG), measured, latest.cli)
    } catch (e) {
      changes = [{ version: '?', body: `CHANGELOG を読めませんでした: ${String(e)}` }]
    }
  }
  const agedAt = latest?.publishedAt
    ? new Date(Date.parse(latest.publishedAt) + policy.minMinutes * 60_000)
    : null
  const claude = {
    measured,
    local,
    latest: latest?.cli ?? null,
    sdk: latest?.sdk ?? null,
    sdkPublishedAt: latest?.publishedAt ?? null,
    sdkAged: latest?.publishedAt ? agedEnough(latest.publishedAt, policy.minMinutes) : null,
    sdkAgedAt: agedAt?.toISOString() ?? null,
    changes
  }

  // Forgejo
  let releases = []
  try {
    releases = JSON.parse(await fetchText(FORGEJO_RELEASES))
  } catch (e) {
    releases = []
    console.error(`Forgejo の releases を読めませんでした: ${String(e)}`)
  }
  const installed = cliVersionOf(sh('forgejo', ['--version']) ?? '')
  const forgejo = {
    installed,
    latestInLine: installed ? latestRelease(releases, installed.split('.')[0]) : null,
    latest: latestRelease(releases)
  }

  if (json) {
    console.log(JSON.stringify({ claude, forgejo }, null, 2))
    return
  }
  console.log('## claude')
  console.log(
    `  測った版  ${claude.measured}   手元 ${claude.local ?? '無し'}   最新 ${claude.latest ?? '?'}`
  )
  if (claude.latest && measured && compareVersions(claude.latest, measured) > 0) {
    console.log(
      `  SDK ${claude.sdk} は ${claude.sdkPublishedAt?.slice(0, 16) ?? '?'} 公開。熟成の線（${policy.minMinutes} 分）を` +
        (claude.sdkAged
          ? '越えている → pnpm run catchup で揃えられる'
          : `越えるのは ${claude.sdkAgedAt?.slice(0, 16)}`)
    )
    for (const c of changes) {
      console.log(`\n### ${c.version}\n${c.body}`)
    }
  } else {
    console.log('  最新に揃っている')
  }
  console.log('\n## Forgejo')
  console.log(
    `  手元 ${forgejo.installed ?? '無し（Homebrew の形ではない）'}   同じ系列の最新 ${forgejo.latestInLine ?? '?'}   全体の最新 ${forgejo.latest ?? '?'}`
  )
  if (
    forgejo.installed &&
    forgejo.latestInLine &&
    compareVersions(forgejo.latestInLine, forgejo.installed) > 0
  ) {
    console.log(
      `  → ${forgejo.latestInLine} がある。brew upgrade forgejo && brew services restart forgejo`
    )
    console.log(
      `    変更: https://codeberg.org/forgejo/forgejo/releases/tag/v${forgejo.latestInLine}`
    )
  }
}

main().catch((e) => {
  console.error(String(e))
  process.exit(1)
})

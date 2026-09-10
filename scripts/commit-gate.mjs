#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type -- 型の無い .mjs。検査は JSDoc ではなく test/scripts-gates.test.ts で見る */
/**
 * エージェントがコミットする直前に `pnpm verify` を回す（docs/NIMBALYST.md §3 の 7）。
 * `.claude/settings.json` の `PreToolUse`（matcher: Bash）から呼ばれる。
 *
 * stdin に呼び出しの JSON が来る。コミットの命令を含まなければ何もしない。
 * 落ちたら exit 2 —— Claude Code はこれを「止めた」と読み、stderr を見せる。
 *
 * **これは Izuna 自身が hook を持つということである。** §26 の関所は Izuna で
 * Izuna を開くときにこれを数えるので、`~/.izuna/config.json` の `trustedRepos` に
 * このリポジトリを足す。関所が自分にも効いている証拠であって、例外ではない。
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** コミットの命令を含むか。`;` `&&` `|` の後ろも見る。`--dry-run` は見ない */
export function needsGate(command) {
  if (typeof command !== 'string') return false
  if (/--dry-run/.test(command)) return false
  return /(^|[;&|(]\s*)(sudo\s+)?git\s+(-C\s+\S+\s+)?commit\b/.test(command)
}

function main() {
  let input = {}
  try {
    input = JSON.parse(readFileSync(0, 'utf8') || '{}')
  } catch {
    return 0 // 読めない入力で止めない。門はコミットにだけ効く
  }
  if (input.tool_name !== 'Bash' || !needsGate(input.tool_input?.command)) return 0
  if (process.env.IZUNA_SKIP_VERIFY === '1') return 0

  const r = spawnSync('pnpm', ['verify'], { encoding: 'utf8' })
  if (r.status === 0) return 0
  const tail = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
    .split('\n')
    .filter(Boolean)
    .slice(-40)
    .join('\n')
  console.error(`pnpm verify が落ちている。直してからコミットすること。\n${tail}`)
  return 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}

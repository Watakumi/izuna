import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { forbiddenAuthors, localShas, manifestChanged, secretScanArgs } from '../scripts/prepush.mjs'
import { needsGate } from '../scripts/commit-gate.mjs'

/** push とコミットの門（docs/NIMBALYST.md §3 の 5 と 7）。門そのものを検査する */
const ROOT = join(__dirname, '..')

describe('pre-push', () => {
  it('git の stdin から届ける sha を取る。削除（0 埋め）は数えない', () => {
    const stdin = [
      'refs/heads/a 1111111 refs/heads/a 0000000',
      'refs/heads/b 0000000 refs/heads/b 2222222',
      ''
    ].join('\n')
    expect(localShas(stdin)).toEqual(['1111111'])
  })

  it('**検査用の作者を拒む**（逃げ出した fixture は実の仕事ではない）', () => {
    const log = [
      'aaa\t渡\tme@real.dev',
      'bbb\tt\tt@example.com',
      'ccc\tTest User\tsomeone@corp.example',
      'ddd\tbot\tizuna@localhost.invalid'
    ].join('\n')
    expect(forbiddenAuthors(log).map((b) => b.sha)).toEqual(['bbb', 'ccc', 'ddd'])
  })

  it('manifest の変更だけが lockfile の同期を要求する', () => {
    expect(manifestChanged(['src/a.ts'])).toBe(false)
    expect(manifestChanged(['package.json'])).toBe(true)
    expect(manifestChanged(['pnpm-lock.yaml'])).toBe(true)
  })

  it('hook は実行ビットがあり、sh として読める（無いと git は黙って飛ばす）', () => {
    const hook = join(ROOT, '.githooks', 'pre-push')
    expect(statSync(hook).mode & 0o111).not.toBe(0)
    expect(spawnSync('/bin/sh', ['-n', hook]).status).toBe(0)
    expect(readFileSync(hook, 'utf8')).toContain('scripts/prepush.mjs')
  })

  it('prepare が hooksPath を設定する', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts.prepare).toContain('core.hooksPath .githooks')
  })
})

describe('秘密の走査（gitleaks）', () => {
  it('届けるコミットだけを見せ、見つかれば 1 で落ちる引数を組む', () => {
    const args = secretScanArgs(['abc', 'def'], 'upstream')
    expect(args).toContain('--exit-code')
    expect(args[args.indexOf('--exit-code') + 1]).toBe('1')
    expect(args).toContain('--log-opts=abc def --not --remotes=upstream')
    expect(secretScanArgs([], 'origin')).toContain('--log-opts=HEAD --not --remotes=origin')
  })

  it('pre-push の本文が gitleaks を呼び、無ければ止める', () => {
    const src = readFileSync(join(__dirname, '..', 'scripts', 'prepush.mjs'), 'utf8')
    expect(src).toMatch(/spawnSync\('gitleaks'/)
    expect(src).toContain('brew install gitleaks')
  })
})

describe('コミットの門', () => {
  it('コミットの命令を含む Bash だけを止める', () => {
    expect(needsGate('git commit -m "x"')).toBe(true)
    expect(needsGate('pnpm verify && git commit -q -m x')).toBe(true)
    expect(needsGate('git -C ~/w commit -m x')).toBe(true)
    expect(needsGate('git status')).toBe(false)
    expect(needsGate('echo "git commit"')).toBe(false)
    expect(needsGate('git commit --dry-run')).toBe(false)
    expect(needsGate(undefined)).toBe(false)
  })

  it('コミット以外の呼び出しでは何もせず 0 で返る', () => {
    const r = spawnSync('node', [join(ROOT, 'scripts', 'commit-gate.mjs')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
      encoding: 'utf8'
    })
    expect(r.status).toBe(0)
  })

  /**
   * `.claude/settings.json` は自動では作らない（hook の設定はエージェントの手で
   * 置くものではない）。人が置いたら、この検査が指し先を見る。
   */
  const settings = join(ROOT, '.claude', 'settings.json')
  it.skipIf(!existsSync(settings))('settings.json が Bash の PreToolUse でこれを呼ぶ', () => {
    const s = JSON.parse(readFileSync(settings, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ matcher: string; hooks: Array<{ command: string }> }> }
    }
    const pre = s.hooks?.PreToolUse?.find((h) => h.matcher === 'Bash')
    expect(pre?.hooks[0].command).toBe('node scripts/commit-gate.mjs')
  })
})

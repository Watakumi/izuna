import type { Check } from './forge'

/**
 * Claude Code の関所（docs/SETUP.md）。Izuna は手元の `claude` を子プロセスで動かすので、
 * 無ければ何も始まらない。**入っているか・ログイン済みか**を準備の画面の先頭に出す。
 * 純粋関数。集めるのは `main/claude/status.ts`。
 */
export interface ClaudeFacts {
  /** 実体の場所。無ければ null */
  path: string | null
  version: string | null
  /** `claude auth status` の結果。聞けなければ null */
  loggedIn: boolean | null
  authMethod: string | null
  /** claude.ai のプランなど。無ければ null */
  subscription: string | null
}

const INSTALL = 'curl -fsSL https://claude.ai/install.sh | bash'

export function diagnoseClaude(facts: ClaudeFacts): Check[] {
  const checks: Check[] = []
  checks.push(
    facts.path
      ? {
          id: 'claude',
          label: 'Claude Code',
          level: 'ok',
          detail: `${facts.version ?? '版不明'} · ${facts.path}`,
          fix: null
        }
      : {
          id: 'claude',
          label: 'Claude Code',
          level: 'ng',
          detail: `見つかりません。ターミナルで ${INSTALL} を実行するか、~/.izuna/config.json の claudePath で場所を指す`,
          fix: null
        }
  )
  if (!facts.path) return checks

  checks.push(
    facts.loggedIn === true
      ? {
          id: 'claudeLogin',
          label: 'ログイン',
          level: 'ok',
          detail: [facts.authMethod, facts.subscription].filter(Boolean).join(' · ') || '済み',
          fix: null
        }
      : facts.loggedIn === false
        ? {
            id: 'claudeLogin',
            label: 'ログイン',
            level: 'ng',
            detail:
              'していません。ターミナルで claude auth login を実行する（Izuna は API キーを使わない。CLAUDE.md §14）',
            fix: null
          }
        : {
            id: 'claudeLogin',
            label: 'ログイン',
            level: 'unknown',
            detail: '確かめられませんでした（claude auth status が返りません）',
            fix: null
          }
  )
  return checks
}

/** Claude Code が使える状態か。両方 ok のときだけ */
export function readyForClaude(checks: Check[]): boolean {
  return checks
    .filter((c) => c.id === 'claude' || c.id === 'claudeLogin')
    .every((c) => c.level === 'ok')
}

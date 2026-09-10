/**
 * 課金の経路を黙って変えない。
 *
 * Izuna は利用者の Pro プラン（claude.ai の OAuth）で動く前提である（§14）。
 * ログインシェルの環境をそのまま claude に渡すと、無関係の作業のために
 * `.zshrc` や `.env` に置いてある `ANTHROPIC_API_KEY` を拾い、**従量課金に
 * 切り替わる**。Nimbalyst は同じ形で利用者の個人口座に 100 ドル超を請求した
 * （`docs/NIMBALYST.md` §3）。`test/auth.test.ts` は録画を見るだけで、
 * 実行時には守っていなかった。
 *
 * ここは純粋関数。渡す直前に `main/claude/session.ts` が通す。
 */
export const BILLING_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const

export function withoutBillingKeys(env: NodeJS.ProcessEnv): {
  env: NodeJS.ProcessEnv
  removed: string[]
} {
  const out: NodeJS.ProcessEnv = {}
  const removed: string[] = []
  for (const [k, v] of Object.entries(env)) {
    if ((BILLING_KEYS as readonly string[]).includes(k)) {
      if (v !== undefined && v !== '') removed.push(k)
      continue
    }
    out[k] = v
  }
  return { env: out, removed }
}

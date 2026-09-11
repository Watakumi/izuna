/**
 * 文面から鍵を伏せる（docs/ORCA.md §7 の 8）。
 *
 * §27「stderr を捨てない」は、逆に stderr が鍵を含んだとき**そのまま画面に載る**。`gh` や `git` の
 * 失敗の文面には URL の userinfo やトークンが混ざることがある。Orca の `observability/redactor.ts` は
 * 誤り追跡に送る前に 3 段で消す。Izuna は送る相手がいないので、人に見せる文面の 1 段だけ。
 *
 * 純粋関数。**見つけた形だけを伏せる** —— 全部を伏せると原因が読めなくなり、§27 の趣旨に反する。
 */
const PATTERNS: Array<[RegExp, string]> = [
  // Anthropic / GitHub のトークン
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***'],
  [/gh[pousr]_[A-Za-z0-9]{16,}/g, 'gh*_***'],
  [/github_pat_[A-Za-z0-9_]{16,}/g, 'github_pat_***'],
  // Authorization の値（Forgejo の `token <40 hex>` も含む）
  [/\b(Bearer|token)\s+[A-Za-z0-9._-]{16,}/g, '$1 ***'],
  // JWT
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'eyJ***'],
  // 秘密鍵の PEM
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    '-----PRIVATE KEY ***-----'
  ],
  // URL の userinfo（git が remote を文面に出すとき）
  [/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@'],
  // .env の行
  [/^(\s*[A-Za-z_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Za-z_]*)=\S+/gm, '$1=***']
]

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, to]) => t.replace(re, to), text)
}

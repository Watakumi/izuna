import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'

/**
 * リポジトリが持ち込む hook を見つける。
 *
 * **開いただけで走るものがある。** `.claude/settings.json` の `hooks` は
 * `SessionStart` や `PreToolUse` で任意のコマンドを実行する。ターミナルの
 * Claude Code は初回に「このフォルダを信頼するか」を聞くが、SDK 経由には
 * その関所が無い（2026-09-08 に確認）。clone してきた他人のリポジトリを
 * Izuna で開くと、その人のコマンドがログインシェルの環境変数つきで走る。
 *
 * ここは読んで数えるだけ（§4 の原則）。読むのは `main/claude/trust.ts`。
 */

/** 設定の出どころごとに、リポジトリの中で読まれるファイル */
export const HOOK_FILES: Readonly<Record<SettingSource, string | null>> = {
  user: null, // ~/.claude/settings.json。リポジトリの外なので持ち込まれない
  project: '.claude/settings.json',
  local: '.claude/settings.local.json'
}

/** その出どころで読まれる、リポジトリ相対のファイル名 */
export function hookFilesFor(sources: readonly SettingSource[]): string[] {
  return sources.map((s) => HOOK_FILES[s]).filter((f): f is string => f !== null)
}

/**
 * hook が張られているイベント名。無ければ空。
 *
 * **壊れた JSON は「hook 無し」にしない。** 読めないものを安全と扱うと、
 * わざと壊して通り抜けられる。読めなければ `(読めません)` として数える。
 */
export function hookEventsIn(text: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return ['(読めません)']
  }
  if (raw === null || typeof raw !== 'object') return []
  const hooks = (raw as { hooks?: unknown }).hooks
  if (hooks === null || typeof hooks !== 'object') return []
  return Object.entries(hooks as Record<string, unknown>)
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v)))
    .map(([k]) => k)
}

/**
 * プロジェクトの `.mcp.json`。SDK は `strictMcpConfig` を付けない限りこれを読み、
 * `command` に書かれたプログラムを起動する（sdk.d.ts の註で確認。2026-09-08）。
 * hook と同じく「開いただけで走る」ので、同じ関所を通す。
 */
export const MCP_FILE = '.mcp.json'

/** 起動されるサーバ名。`command` の無い（http / sse の）ものは数えない */
export function mcpCommandsIn(text: string): string[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return ['(読めません)']
  }
  const servers = (raw as { mcpServers?: unknown } | null)?.mcpServers
  if (servers === null || typeof servers !== 'object') return []
  return Object.entries(servers as Record<string, unknown>)
    .filter(
      ([, v]) =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as { command?: unknown }).command === 'string'
    )
    .map(([k]) => `mcp:${k}`)
}

export interface FoundHooks {
  /** リポジトリ相対 */
  file: string
  events: string[]
}

/**
 * 信頼している場所か。**前方一致で、区切りを見る。**
 * `~/work/a` を信頼しても `~/work/ab` は信頼しない。
 */
export function isTrusted(cwd: string, trusted: readonly string[]): boolean {
  const norm = (p: string): string => p.replace(/\/+$/, '')
  const at = norm(cwd)
  return trusted.some((t) => {
    const root = norm(t)
    return root !== '' && (at === root || at.startsWith(root + '/'))
  })
}

/** 止めるときに人へ見せる文。何が・どこに・どうすれば通るか */
export function hooksRefusal(
  cwd: string,
  found: readonly FoundHooks[],
  configPath: string
): string {
  const what = found.map((f) => `${f.file}（${f.events.join(', ')}）`).join('、')
  return (
    `${cwd} に hook があります: ${what}。開くと、そのコマンドが実行されます。` +
    `信頼するなら ${configPath} の trustedRepos にこのパスを足してください`
  )
}

/**
 * Forgejo の環境診断（段5 の入口）。
 *
 * 純粋関数。**集めた事実から判定するだけ**で、コマンドも HTTP も叩かない。
 * 実際に調べるのは `main/forge/setup.ts` の役目。この分け方のおかげで、
 * 「Forgejo が無い環境」「壊れている環境」の判定を、実物なしで検査できる。
 *
 * 方針: **検出は自動、変更は明示のクリック。**
 * 利用者の Forgejo 設定を黙って書き換えない。
 */

export type CheckId =
  | 'installed' | 'configured' | 'transport' | 'running' | 'token'
  | 'actions' | 'reachableFromRunner' | 'runner'
export type Level = 'ok' | 'warn' | 'ng' | 'unknown'

export interface Check {
  id: CheckId
  label: string
  level: Level
  detail: string
  /** 押せば直せるもの。null なら手でやるしかない */
  fix: { label: string; warning: string | null } | null
}

/** main が集めてくる事実。ここでは判定だけする */
export interface ForgeFacts {
  /** forgejo コマンドの場所。無ければ null */
  binary: string | null
  version: string | null
  /** app.ini の中身（見つからなければ null） */
  config: ForgeConfig | null
  /** ROOT_URL が応答したか */
  reachable: boolean
  /** 保管しているトークンのスコープ。未設定なら null */
  tokenScopes: string[] | null
  /** トークンで /api/v1/user が通ったか */
  tokenWorks: boolean | null
  /** 登録済み runner の数。Actions が無効なら null */
  runners: number | null
}

export interface ForgeConfig {
  path: string
  rootUrl: string | null
  httpPort: number | null
  /** listen アドレス。127.0.0.1 だと Docker の runner から届かない */
  httpAddr: string | null
  installLocked: boolean
  actionsEnabled: boolean
}

/**
 * Docker のコンテナから届くアドレスか。
 *
 * macOS では runner を Docker で回すしかない（リリースに darwin の
 * バイナリが無く linux-amd64 / linux-arm64 だけ）。コンテナはホストの
 * 127.0.0.1 に届かないので、ここが loopback だと Actions は必ず失敗する。
 */
export function reachableFromContainer(addr: string | null): boolean {
  if (!addr) return true // 未設定なら Forgejo の既定（0.0.0.0）
  return !['127.0.0.1', 'localhost', '::1'].includes(addr.trim())
}

/**
 * Izuna が要るスコープ。**ここが唯一の定義**（2026-09-08 に一本化）。
 *
 * 同じ名前の定数を `main/forge/setup.ts` にも作ってしまい、
 * **判定はその 2 つのハードコードを比べているだけ**になっていた。
 * トークンを作り直しても「スコープが足りません」が消えず、
 * 実際のトークンは一度も見ていなかった。
 *
 * 中身は実測（CLAUDE.md §7）。`POST /user/repos` は
 * `write:user` と `write:repository` の**両方**を要求する。
 * `write:user` は `read:user` を含むので、後者は書かない。
 */
export const REQUIRED_SCOPES = ['write:user', 'write:repository'] as const
/** PR にコメントを付けるなら要る。無くても段5 は動く */
export const OPTIONAL_SCOPES = ['write:issue'] as const

/** 発行時に付けるもの（要るもの＋任意） */
export const GRANTED_SCOPES = [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES] as const

/** `HTTP_PORT = 4649` の形を読む。節は見ない（キーが一意なので足りる） */
export function parseAppIni(text: string): Omit<ForgeConfig, 'path'> {
  const value = (key: string): string | null => {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, 'mi').exec(text)
    return m ? m[1] : null
  }
  const port = value('HTTP_PORT')
  const addr = value('HTTP_ADDR')
  // [actions] の ENABLED だけを見る。ほかの節にも ENABLED はある
  const actions = /^\s*\[actions\][^[]*?^\s*ENABLED\s*=\s*(\w+)/ms.exec(text)
  return {
    rootUrl: value('ROOT_URL'),
    httpPort: port && /^\d+$/.test(port) ? Number(port) : null,
    httpAddr: addr,
    installLocked: (value('INSTALL_LOCK') ?? '').toLowerCase() === 'true',
    // 節が無ければ既定で有効。明示的に false のときだけ無効
    actionsEnabled: actions ? actions[1].toLowerCase() !== 'false' : true
  }
}

/**
 * トークンを載せてよい経路か。**ループバックか、https のときだけ。**
 *
 * `openAddr` で 0.0.0.0 に開いたあと ROOT_URL を LAN のアドレスにすると、
 * `fetch` も `git push` もトークンを平文で LAN に流す（§26）。
 * Izuna はその経路にトークンを送らない。
 */
export function tokenMayTravel(rootUrl: string | null): boolean {
  if (!rootUrl) return false
  let u: URL
  try {
    u = new URL(rootUrl)
  } catch {
    return false
  }
  if (u.protocol === 'https:') return true
  if (u.protocol !== 'http:') return false
  const host = u.hostname.replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)
}

/** 送らない理由。止めるときは経路を名指しする */
export function transportRefusal(rootUrl: string): string {
  return `${rootUrl} にはトークンを送りません（平文で LAN を通ります）。ROOT_URL をループバックか https にしてください`
}

/** ボットの名前。人（管理者）の鍵は持たない */
export const BOT_USER = 'izuna'

export function missingScopes(have: string[] | null): string[] {
  if (!have) return [...REQUIRED_SCOPES]
  return REQUIRED_SCOPES.filter((s) => !have.includes(s))
}

/** 事実 → 画面に出す診断。上から順に潰す想定で並べる */
export function diagnose(facts: ForgeFacts): Check[] {
  const checks: Check[] = []

  checks.push(facts.binary
    ? { id: 'installed', label: 'インストール', level: 'ok',
        detail: `${facts.version ?? '版不明'} · ${facts.binary}`, fix: null }
    : { id: 'installed', label: 'インストール', level: 'ng',
        detail: '見つかりません',
        fix: { label: 'Homebrew で入れる', warning: 'brew install forgejo を実行します' } })

  if (!facts.binary) return checks

  const cfg = facts.config
  checks.push(!cfg
    ? { id: 'configured', label: '初期設定', level: 'ng',
        detail: 'app.ini が見つかりません', fix: null }
    : cfg.installLocked
      ? { id: 'configured', label: '初期設定', level: 'ok',
          detail: `${cfg.rootUrl ?? '(ROOT_URL 未設定)'} · ${cfg.path}`, fix: null }
      : { id: 'configured', label: '初期設定', level: 'warn',
          detail: 'INSTALL_LOCK が false。ブラウザで初期設定を終えてください', fix: null })

  // 経路が危なければ、その先（起動・トークン）を試す前に止める
  if (cfg?.rootUrl && !tokenMayTravel(cfg.rootUrl)) {
    checks.push({ id: 'transport', label: '経路', level: 'ng',
      detail: transportRefusal(cfg.rootUrl), fix: null })
  }

  checks.push(facts.reachable
    ? { id: 'running', label: '起動', level: 'ok',
        detail: `${cfg?.rootUrl ?? ''} が応答しました`, fix: null }
    : { id: 'running', label: '起動', level: 'ng',
        detail: '応答がありません',
        fix: { label: '起動する', warning: 'brew services start forgejo を実行します' } })

  const lacking = missingScopes(facts.tokenScopes)
  checks.push(
    facts.tokenScopes === null
      ? { id: 'token', label: 'トークン', level: 'ng',
          detail: '未設定です',
          fix: { label: 'トークンを発行する',
            warning: `Forgejo に ${BOT_USER} というボットの利用者を作り（無ければ）、そのトークンを発行します` } }
      : facts.tokenScopes.length === 0
        ? { id: 'token', label: 'トークン', level: 'warn',
            // **分からないことを「足りない」と言わない。** 古い版で発行した
            // トークンは権限の記録を持たないので、判定のしようがない
            detail: '古い版で発行されたため、権限が分かりません',
            fix: { label: '発行し直す', warning: '確実に必要な権限を付けて作り直します' } }
      : lacking.length > 0
        ? { id: 'token', label: 'トークン', level: 'ng',
            detail: `スコープが足りません: ${lacking.join(', ')}`,
            fix: { label: '発行し直す', warning: '足りないスコープを付けて作り直します' } }
        : facts.tokenWorks === false
          ? { id: 'token', label: 'トークン', level: 'ng',
              detail: 'トークンが拒否されました。作り直してください',
              fix: { label: '発行し直す', warning: '古いトークンは無効になります' } }
          : { id: 'token', label: 'トークン', level: 'ok',
              detail: (facts.tokenScopes ?? []).join(', '), fix: null }
  )

  // Actions は v1 の必須ではない。無くても PR は作れる
  checks.push(cfg?.actionsEnabled
    ? { id: 'actions', label: 'Actions（任意）', level: 'ok', detail: '有効です', fix: null }
    : { id: 'actions', label: 'Actions（任意）', level: 'warn',
        detail: '無効です。CI を自分で実行しないなら、このままで構いません',
        fix: { label: '有効にする', warning: 'app.ini を書き換えて Forgejo を再起動します' } })

  if (cfg?.actionsEnabled) {
    // macOS では runner を Docker で回すしかないので、loopback だと必ず失敗する。
    // Actions を有効にした人にだけ見せる（無効なら関係ない）
    checks.push(reachableFromContainer(cfg.httpAddr)
      ? { id: 'reachableFromRunner', label: 'runner から Forgejo に届く（任意）', level: 'ok',
          detail: `HTTP_ADDR = ${cfg.httpAddr ?? '(既定)'}`, fix: null }
      : { id: 'reachableFromRunner', label: 'runner から Forgejo に届く（任意）', level: 'warn',
          detail: `HTTP_ADDR = ${cfg.httpAddr} は Docker のコンテナから届きません。` +
            'macOS では runner を Docker で回すため、Actions を使うなら開く必要があります',
          fix: { label: '0.0.0.0 で待ち受ける',
            warning: 'app.ini を書き換えて再起動します。**同じネットワークの他の端末からも見えるようになります**' } })

    checks.push((facts.runners ?? 0) > 0
      ? { id: 'runner', label: 'runner が登録されている（任意）', level: 'ok',
          detail: `${facts.runners} 台`, fix: null }
      : { id: 'runner', label: 'runner が登録されている（任意）', level: 'warn',
          detail: 'ありません。Actions は動きますが、実行するものがいません',
          fix: { label: '登録用トークンを出す', warning: 'runner のバイナリは別途必要です' } })
  }

  return checks
}

/** 段5 に進めるか。任意の項目は数えない */
export function readyForForge(checks: Check[]): boolean {
  return checks
    .filter((c) => c.id === 'installed' || c.id === 'configured' || c.id === 'transport' ||
      c.id === 'running' || c.id === 'token')
    .every((c) => c.level === 'ok')
}

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
  | 'installed'
  | 'configured'
  | 'transport'
  | 'running'
  | 'token'
  | 'actions'
  | 'lanOpen'
  | 'runner'
  /** Claude Code の関所（`shared/prereq.ts`） */
  | 'claude'
  | 'claudeLogin'
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
  /**
   * 通らなかったときの**実際の理由**。
   *
   * ここが無かったせいで、拒否されたトークンを「古い版で発行された」と
   * 表示していた。発行し直しても拒否の原因は変わらないので、
   * **押すたびにトークンが 1 本増えるだけ**だった（Forgejo は API でも CLI でも
   * 消せないので、溜まる一方になる）。
   */
  tokenRejection: { status: number | null; detail: string } | null
  /** 保管はあるのに復号できない（鍵が変わった）。「未設定」とは別の状態 */
  tokenUnreadable: boolean
  /** 登録済み runner の数。Actions が無効なら null */
  runners: number | null
  /**
   * 手元に `forgejo` が無く、設定の `forgejoUrl` だけで見ている（Docker や別マシンの Forgejo）。
   * この形では CLI を使う修正（ボットの作成・トークンの発行・app.ini の書き換え）ができない。
   * トークンは人が Forgejo で作って貼る（`adoptToken`）
   */
  remote: boolean
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
 * 同じネットワークの他の端末から届く待ち受けか。
 *
 * **runner のために開く必要は無い**（2026-09-10 実測）。以前は「Docker のコンテナはホストの
 * 127.0.0.1 に届かない」と書いて 0.0.0.0 に開かせていたが、それは Linux の Docker の話で、
 * macOS の Docker Desktop / OrbStack は `host.docker.internal` をホスト側のプロセスが中継するので、
 * 127.0.0.1 に束ねた Forgejo にも届く（runner のコンテナからも、ジョブの node:24 からも 200）。
 * 未設定は Forgejo の既定（0.0.0.0）なので「開いている」と読む。
 */
export function openToLan(addr: string | null): boolean {
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
 * HTTP_ADDR を 0.0.0.0 に開いたうえで ROOT_URL を LAN のアドレスにすると、
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
/**
 * **発行し直しても増えるだけ**という状態があるので、順番が意味を持つ。
 *
 * Forgejo のトークンは Izuna から消せない（API は `auth method not allowed`、
 * CLI に削除の口が無い。2026-09-08 / 09 に実測）。だから
 * **「発行し直す」を出してよいのは、発行し直せば直るときだけ**である。
 *
 * 以前は「通らなかった」を `scopes: []` で表していて、その枝が
 * 「通ったか」の枝より前にあった。結果、拒否されたトークンが
 * 「古い版で発行されたため、権限が分かりません」と出て、
 * 押しても直らず、押すたびに 1 本増えた。
 */
function tokenCheck(facts: ForgeFacts, lacking: string[]): Check {
  const id = 'token'
  const label = 'トークン'

  if (facts.tokenUnreadable) {
    return {
      id,
      label,
      level: 'ng',
      // **「未設定」と言わない。** 設定した人は「したのに」としか思えない
      detail:
        '保管したトークンを復号できません。暗号化に使った鍵と違う鍵で動いています（別の keychain、または --use-mock-keychain）',
      fix: facts.remote ? null : { label: '発行し直す', warning: REISSUE }
    }
  }

  // **通らなかったことを最初に見る。** 権限の話はその後でしか意味を持たない
  if (facts.tokenWorks === false) {
    const r = facts.tokenRejection
    // 繋がらないのはトークンのせいではない。**押しても増えるだけ**なので釦を出さない
    const reissuable = r?.status === 401 || r?.status === 403
    return {
      id,
      label,
      level: 'ng',
      detail: r ? `通りませんでした: ${r.detail}` : '通りませんでした',
      fix: reissuable && !facts.remote ? { label: '発行し直す', warning: REISSUE } : null
    }
  }

  if (facts.tokenScopes === null) {
    // 手元に CLI が無ければ発行できない。人が Forgejo で作って貼る（画面に貼る欄が出る）
    if (facts.remote) {
      return {
        id,
        label,
        level: 'ng',
        detail: `未設定です。Forgejo で ${BOT_USER} という利用者を作り、そのトークン（${REQUIRED_SCOPES.join(', ')}）を下に貼ってください`,
        fix: null
      }
    }
    return {
      id,
      label,
      level: 'ng',
      detail: '未設定です',
      fix: {
        label: 'トークンを発行する',
        warning: `Forgejo に ${BOT_USER} というボットの利用者を作り（無ければ）、そのトークンを発行します`
      }
    }
  }

  if (facts.tokenScopes.length === 0) {
    // **分からないことを「足りない」と言わない**
    return {
      id,
      label,
      level: 'warn',
      detail: '権限が分かりません（古い版で発行されたか、サーバが返しませんでした）',
      fix: facts.remote ? null : { label: '発行し直す', warning: REISSUE }
    }
  }

  if (lacking.length > 0) {
    return {
      id,
      label,
      level: 'ng',
      detail: `スコープが足りません: ${lacking.join(', ')}`,
      fix: facts.remote ? null : { label: '発行し直す', warning: REISSUE }
    }
  }

  return { id, label, level: 'ok', detail: facts.tokenScopes.join(', '), fix: null }
}

/**
 * 発行の警告。**増えることを隠さない。**
 * Izuna は古いトークンを消せないので、押すたびに Forgejo に 1 本残る。
 */
const REISSUE =
  '新しいトークンを作ります。**古いトークンは Izuna からは消せない**ので、' +
  'Forgejo 側に残ります（設定 → アプリケーション で消せます）'

export function diagnose(facts: ForgeFacts): Check[] {
  const checks: Check[] = []

  checks.push(
    facts.binary
      ? {
          id: 'installed',
          label: 'インストール',
          level: 'ok',
          detail: `${facts.version ?? '版不明'} · ${facts.binary}`,
          fix: null
        }
      : facts.remote
        ? {
            id: 'installed',
            label: 'インストール',
            level: 'ok',
            detail: `手元には無い。設定の forgejoUrl（${facts.config?.rootUrl ?? ''}）を使う`,
            fix: null
          }
        : {
            id: 'installed',
            label: 'インストール',
            level: 'ng',
            detail:
              '見つかりません。Homebrew で入れるか、Docker や別マシンの Forgejo を ~/.izuna/config.json の forgejoUrl に書く（docs/SETUP.md）',
            fix: { label: 'Homebrew で入れる', warning: 'brew install forgejo を実行します' }
          }
  )

  if (!facts.binary && !facts.remote) return checks

  const cfg = facts.config
  checks.push(
    !cfg
      ? {
          id: 'configured',
          label: '初期設定',
          level: 'ng',
          detail: 'app.ini が見つかりません',
          fix: null
        }
      : cfg.installLocked
        ? {
            id: 'configured',
            label: '初期設定',
            level: 'ok',
            detail: `${cfg.rootUrl ?? '(ROOT_URL 未設定)'} · ${cfg.path}`,
            fix: null
          }
        : {
            id: 'configured',
            label: '初期設定',
            level: 'warn',
            detail: 'INSTALL_LOCK が false。ブラウザで初期設定を終えてください',
            fix: null
          }
  )

  // 経路が危なければ、その先（起動・トークン）を試す前に止める
  if (cfg?.rootUrl && !tokenMayTravel(cfg.rootUrl)) {
    checks.push({
      id: 'transport',
      label: '経路',
      level: 'ng',
      detail: transportRefusal(cfg.rootUrl),
      fix: null
    })
  }

  checks.push(
    facts.reachable
      ? {
          id: 'running',
          label: '起動',
          level: 'ok',
          detail: `${cfg?.rootUrl ?? ''} が応答しました`,
          fix: null
        }
      : {
          id: 'running',
          label: '起動',
          level: 'ng',
          detail: '応答がありません',
          fix: { label: '起動する', warning: 'brew services start forgejo を実行します' }
        }
  )

  const lacking = missingScopes(facts.tokenScopes)
  checks.push(tokenCheck(facts, lacking))

  // Actions は v1 の必須ではない。無くても PR は作れる
  checks.push(
    cfg?.actionsEnabled
      ? { id: 'actions', label: 'Actions（任意）', level: 'ok', detail: '有効です', fix: null }
      : {
          id: 'actions',
          label: 'Actions（任意）',
          level: 'warn',
          detail: '無効です。CI を自分で実行しないなら、このままで構いません',
          fix: { label: '有効にする', warning: 'app.ini を書き換えて Forgejo を再起動します' }
        }
  )

  // 待ち受けが LAN に開いていないか。runner のために開く必要は無い（`openToLan` の註）ので、
  // 開いていれば理由を問わず言う。直すのは人（app.ini の HTTP_ADDR を 127.0.0.1 に戻して再起動）。
  // app.ini が読めない構成（remote）では待ち受けも分からないので出さない
  if (cfg)
    checks.push(
      openToLan(cfg.httpAddr)
        ? {
            id: 'lanOpen',
            label: '待ち受け（任意）',
            level: 'warn',
            detail:
              `HTTP_ADDR = ${cfg.httpAddr ?? '(既定 = 0.0.0.0)'}。同じネットワークの他の端末から届きます。` +
              'runner のためなら要りません —— 127.0.0.1 のままでも host.docker.internal で届きます',
            fix: null
          }
        : {
            id: 'lanOpen',
            label: '待ち受け（任意）',
            level: 'ok',
            detail: `HTTP_ADDR = ${cfg.httpAddr}。この Mac の中だけ。runner は host.docker.internal で届く`,
            fix: null
          }
    )

  if (cfg?.actionsEnabled) {
    checks.push(
      (facts.runners ?? 0) > 0
        ? {
            id: 'runner',
            label: 'runner が登録されている（任意）',
            level: 'ok',
            detail: `${facts.runners} 台`,
            fix: null
          }
        : {
            id: 'runner',
            label: 'runner が登録されている（任意）',
            level: 'warn',
            detail: 'ありません。Actions は動きますが、実行するものがいません',
            fix: { label: '登録用トークンを出す', warning: 'runner のバイナリは別途必要です' }
          }
    )
  }

  return checks
}

/** 段5 に進めるか。任意の項目は数えない */
export function readyForForge(checks: Check[]): boolean {
  return checks
    .filter(
      (c) =>
        c.id === 'installed' ||
        c.id === 'configured' ||
        c.id === 'transport' ||
        c.id === 'running' ||
        c.id === 'token'
    )
    .every((c) => c.level === 'ok')
}

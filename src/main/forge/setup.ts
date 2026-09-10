import { readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { run as exec0 } from '../exec'
import { join } from 'node:path'
import {
  BOT_USER,
  GRANTED_SCOPES,
  parseAppIni,
  tokenMayTravel,
  type ForgeConfig,
  type ForgeFacts
} from '../../shared/forge'
import { loginShellEnv } from '../claude/locate'
import { loadScopes, loadToken, saveToken, tokenStatus } from './store'
import { listTokens } from './client'
import { resolved } from '../config'

/**
 * Forgejo の環境を調べ、押されたら直す（段5 の入口）。
 *
 * 判定は `shared/forge.ts`（純粋関数）が持つ。ここは調べて走らせるだけ。
 *
 * **検出は自動、変更は明示のクリック。** 利用者の Forgejo 設定を黙って
 * 書き換えたり brew install を勝手に走らせたりしない。
 */

/** forgejo / brew の出力は末尾の改行を落として使う */
async function run(cmd: string, args: string[]): Promise<string> {
  return (await exec0(cmd, args, { timeoutMs: 60_000, maxBuffer: 4 * 1024 * 1024 })).trim()
}

async function which(cmd: string): Promise<string | null> {
  try {
    return (await run('command', ['-v', cmd])) || null
  } catch {
    // command はシェル組み込みなので execFile では動かない。ログインシェル経由で聞く
    try {
      const shell = (await loginShellEnv()).SHELL ?? '/bin/zsh'
      return (await exec0(shell, ['-ilc', `command -v ${cmd}`], { timeoutMs: 8000 })).trim() || null
    } catch {
      return null
    }
  }
}

async function findConfig(): Promise<ForgeConfig | null> {
  const cfg = await resolved()
  for (const base of cfg.forgejoWorkPaths) {
    const path = join(base, 'custom', 'conf', 'app.ini')
    try {
      return { path, ...parseAppIni(await readFile(path, 'utf8')) }
    } catch {
      continue
    }
  }
  // app.ini が読めない環境（Docker で建てている等）。URL だけ設定から使う
  const cfg2 = await resolved()
  if (cfg2.forgejoUrl) {
    return {
      path: '(設定から)',
      rootUrl: cfg2.forgejoUrl,
      httpPort: null,
      httpAddr: null,
      installLocked: true,
      actionsEnabled: true
    }
  }
  return null
}

async function probe(rootUrl: string | null): Promise<boolean> {
  if (!rootUrl) return false
  try {
    const res = await fetch(new URL('api/v1/version', rootUrl), {
      signal: AbortSignal.timeout(3000)
    })
    return res.ok
  } catch {
    return false
  }
}

type TokenFacts = {
  scopes: string[] | null
  works: boolean | null
  rejection: { status: number | null; detail: string } | null
}

/**
 * トークンが通るか、どのスコープを持つかを本人に聞く。
 *
 * **「通らなかった」を `scopes: []` で表さない。** 以前そうしていたせいで、
 * 診断が拒否を「古い版で発行された」と表示し、発行し直しても直らないのに
 * 釦だけが出続けた。Forgejo のトークンは Izuna から消せないので、
 * **押すたびに 1 本増えていた**。理由は理由として返す。
 */
async function inspectToken(rootUrl: string | null, token: string | null): Promise<TokenFacts> {
  if (!token) return { scopes: null, works: null, rejection: null }
  if (!rootUrl) return { scopes: null, works: null, rejection: null }
  // 経路が危なければ聞きに行かない。分からないまま返す（診断が経路の行を出す）
  if (!tokenMayTravel(rootUrl)) return { scopes: null, works: null, rejection: null }
  const url = new URL('api/v1/user', rootUrl)
  try {
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}` },
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) {
      return {
        scopes: null,
        works: false,
        rejection: {
          status: res.status,
          detail:
            res.status === 401
              ? `${url.href} が 401 を返しました（トークンが無効か、失効しています）`
              : res.status === 403
                ? `${url.href} が 403 を返しました（権限が足りません）`
                : `${url.href} が ${res.status} ${res.statusText} を返しました`
        }
      }
    }
    /**
     * **サーバが持っている権限を見る。**
     *
     * 最初は「発行したときに要求した一覧」を返していた。それは記録であって
     * 事実ではないので、作り直しても判定が変わらなかった。
     * `GET /users/{u}/tokens` は token 認証で通り、`scopes` を返す（実測）。
     * 末尾 8 文字で、手元のトークンがどれかを突き合わせる。
     */
    const me = (await res.json()) as { login?: string }
    if (!me.login) return { scopes: await loadScopes(), works: true, rejection: null }
    try {
      const tokens = await listTokens(rootUrl, me.login)
      const mine = tokens.find((t) => token.endsWith(t.last8))
      return { scopes: mine?.scopes ?? (await loadScopes()), works: true, rejection: null }
    } catch {
      // 一覧が引けない版もありうる。そのときは記録に落とす
      return { scopes: await loadScopes(), works: true, rejection: null }
    }
  } catch (e) {
    // **繋がらないのはトークンのせいではない。** status を付けないことで、
    // 診断は「発行し直す」を出さない（出しても増えるだけだから）
    return {
      scopes: null,
      works: false,
      rejection: {
        status: null,
        detail: `${url.href} に繋がりません（${String(e).replace(/^\w*Error:\s*/, '')}）`
      }
    }
  }
}

export async function gatherFacts(): Promise<ForgeFacts> {
  const binary = await which('forgejo')
  const [version, config, token] = await Promise.all([
    binary
      ? run(binary, ['--version'])
          .then((v) => /version (\S+)/.exec(v)?.[1] ?? null)
          .catch(() => null)
      : null,
    findConfig(),
    loadToken()
  ])
  // 手元に無く、設定にも無ければ、そこで止める（先を出しても混乱するだけ）
  if (!binary && !config) {
    return {
      binary: null,
      version: null,
      config: null,
      reachable: false,
      tokenScopes: null,
      tokenWorks: null,
      tokenRejection: null,
      tokenUnreadable: false,
      runners: null,
      remote: false
    }
  }
  const reachable = await probe(config?.rootUrl ?? null)
  const { scopes, works, rejection } = await inspectToken(config?.rootUrl ?? null, token)
  const tokenUnreadable = (await tokenStatus()) === 'unreadable'
  return {
    binary,
    version,
    config,
    reachable,
    tokenScopes: scopes,
    tokenWorks: works,
    tokenRejection: rejection,
    tokenUnreadable,
    runners: null,
    remote: !binary
  }
}

/**
 * 人が Forgejo で作ったトークンを受け取って保管する（Docker や別マシンの Forgejo 向け。docs/SETUP.md）。
 *
 * **通るか・誰のものか・何ができるかを本人に聞いてから保管する。** 通らないものを保管すると、
 * 診断が「通りません」と言い続けるだけで、貼った人は直せない。
 * 人（管理者）のトークンは受け取らない —— ボット `izuna` のものだけ（§26）。
 */
export async function adoptToken(rootUrl: string, token: string): Promise<string> {
  const t = token.trim()
  if (!t) throw new Error('トークンが空です')
  if (!tokenMayTravel(rootUrl))
    throw new Error(`${rootUrl} にはトークンを送りません（平文で LAN を通ります）`)
  const res = await fetch(new URL('api/v1/user', rootUrl), {
    headers: { Authorization: `token ${t}` },
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok)
    throw new Error(`Forgejo が ${res.status} を返しました。トークンが違うか、失効しています`)
  const me = (await res.json()) as { login?: string }
  if (me.login !== BOT_USER) {
    throw new Error(
      `これは ${me.login ?? '不明'} のトークンです。Izuna が持つのはボット ${BOT_USER} のものだけです（人の鍵はアプリに置かない）`
    )
  }
  const tokens = await listTokens(rootUrl, BOT_USER).catch(
    () => [] as Awaited<ReturnType<typeof listTokens>>
  )
  const mine = tokens.find((x) => t.endsWith(x.last8))
  await saveToken(t, mine?.scopes ?? undefined)
  return `${BOT_USER} のトークンを保管しました${mine ? `（${mine.scopes.join(', ')}）` : ''}`
}

/**
 * ボットの利用者を用意する。**人（管理者）のトークンは作らない。**
 *
 * 最初は最初に見つかった管理者でトークンを発行していた。それは Izuna が
 * 人の鍵を持つということで、CLI から失効できない（§7）以上、消す手段が
 * 人のクリックしか無い鍵がアプリの中に残る。gh-radar と同じく、
 * 作業場を触るのはボット、承認するのは人、に分ける（§26）。
 *
 * パスワードは使わないので乱数にして捨てる。
 */
async function ensureBotUser(binary: string, workPath: string): Promise<string> {
  const out = await run(binary, ['admin', 'user', 'list', '--work-path', workPath])
  // 1 行目は見出し。ID<TAB>Username<TAB>... の形
  const names = out
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/)[1])
    .filter(Boolean)
  if (names.includes(BOT_USER)) return BOT_USER
  await run(binary, [
    'admin',
    'user',
    'create',
    '--username',
    BOT_USER,
    '--email',
    `${BOT_USER}@localhost.invalid`,
    '--random-password',
    '--must-change-password=false',
    '--work-path',
    workPath
  ])
  return BOT_USER
}

function workPathOf(config: ForgeConfig): string {
  return config.path.replace(/\/custom\/conf\/app\.ini$/, '')
}

export type FixId = 'install' | 'start' | 'token' | 'actions' | 'runnerToken'

/** 押されたときだけ走る。戻り値は人に見せる結果 */
export async function applyFix(id: FixId): Promise<string> {
  const facts = await gatherFacts()

  switch (id) {
    case 'install':
      await run('brew', ['install', 'forgejo'])
      return 'brew install forgejo が終わりました'

    case 'start':
      await run('brew', ['services', 'start', 'forgejo'])
      return 'brew services start forgejo を実行しました。数秒で応答が返るはずです'

    case 'token': {
      if (!facts.binary || !facts.config) throw new Error('Forgejo が見つかりません')
      const workPath = workPathOf(facts.config)
      const user = await ensureBotUser(facts.binary, workPath)
      // 同名トークンがあると失敗するので、名前に時刻を混ぜる
      const name = `izuna-${Date.now().toString(36)}`
      const token = await run(facts.binary, [
        'admin',
        'user',
        'generate-access-token',
        '--username',
        user,
        '--token-name',
        name,
        '--raw',
        // **`write:user` が要る。** `POST /user/repos` は `write:repository`
        // だけでは 403 になる（2026-09-08 に実測。片方ずつ試して確かめた）。
        // 「ユーザーの下に作る」ので、どちらの権限も要求される。
        '--scopes',
        GRANTED_SCOPES.join(','),
        '--work-path',
        workPath
      ])
      const value = token.split('\n').pop()?.trim()
      if (!value) throw new Error('トークンを受け取れませんでした')
      await saveToken(value, GRANTED_SCOPES)
      return `${user} のトークン「${name}」を作り、暗号化して保管しました`
    }

    case 'actions': {
      if (!facts.config) throw new Error('app.ini が見つかりません')
      const text = await readFile(facts.config.path, 'utf8')
      const next = /^\s*\[actions\]/m.test(text)
        ? text.replace(/(^\s*\[actions\][^[]*?^\s*ENABLED\s*=\s*)\w+/ms, '$1true')
        : `${text.trimEnd()}\n\n[actions]\nENABLED = true\n`
      // 書き換える前に控えを残す。設定を壊して戻せなくなるのが一番困る
      await writeFile(`${facts.config.path}.izuna-backup`, text, 'utf8')
      await writeFile(facts.config.path, next, 'utf8')
      await run('brew', ['services', 'restart', 'forgejo'])
      return 'Actions を有効にして再起動しました（元の app.ini は .izuna-backup に残してあります）'
    }

    case 'runnerToken': {
      if (!facts.binary || !facts.config) throw new Error('Forgejo が見つかりません')
      const out = await run(facts.binary, [
        'forgejo-cli',
        'actions',
        'generate-runner-token',
        '--work-path',
        workPathOf(facts.config)
      ])
      return `runner の登録トークン: ${out.split('\n').pop()?.trim() ?? out}`
    }
  }
}

/**
 * 手元に `forgejo` の CLI が無い構成（Docker・別マシン）で、ボットとそのトークンを作る。
 *
 * CLI の代わりに Forgejo の API を**管理者の名前とパスワード**で呼ぶ（Basic 認証）。
 * `POST /admin/users` でボット `izuna` を作り（既にあれば飛ばす）、
 * `POST /users/izuna/tokens` でトークンを発行する（Gitea 系は管理者なら他人のトークンを作れる。
 * `reqSelfOrAdmin`。**この Forgejo で実際に通るかは未検証**）。受け取ったトークンは `adoptToken` と
 * 同じ関所（通るか・ボットのものか）を通して保管する。
 *
 * **パスワードは持たない。** この関数の中で 2 回の要求に載せて捨てる。ディスクに書かず、
 * ログにも失敗の文面にも出さない。§26 の「人の鍵をアプリに置かない」は、置かないことであって、
 * 人が打ったその場で使うことまでは禁じない —— Homebrew の形で CLI が管理者として動くのと同じ権限。
 * 送るのは `adoptToken` と同じくループバックか https だけ。
 */
export async function provisionBot(
  rootUrl: string,
  admin: { user: string; password: string }
): Promise<string> {
  const user = admin.user.trim()
  if (!user || !admin.password) throw new Error('管理者の名前とパスワードが要ります')
  if (!tokenMayTravel(rootUrl))
    throw new Error(`${rootUrl} にはパスワードを送りません（平文で LAN を通ります）`)
  const basic = `Basic ${Buffer.from(`${user}:${admin.password}`).toString('base64')}`
  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(`api/v1/${path}`, rootUrl), {
      method: 'POST',
      headers: { Authorization: basic, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    })
  const reason = async (res: Response): Promise<string> => {
    const text = await res.text().catch(() => '')
    let detail = ''
    try {
      detail = String((JSON.parse(text) as { message?: string }).message ?? '')
    } catch {
      detail = text
    }
    // パスワードは絶対に文面へ出さない（Forgejo が返すことは無いが、念のため落とす）
    return detail.replaceAll(admin.password, '***').slice(0, 200)
  }

  // 1. ボットの利用者。既にあれば 422（user already exists）で、それは続けてよい
  const created = await post('admin/users', {
    username: BOT_USER,
    email: `${BOT_USER}@localhost.invalid`,
    password: randomBytes(24).toString('base64url'),
    must_change_password: false,
    send_notify: false
  })
  let made = false
  if (created.status === 201) made = true
  else if (created.status === 401)
    throw new Error('Forgejo が 401 を返しました。管理者の名前かパスワードが違います')
  else if (created.status === 403)
    throw new Error(
      `Forgejo が 403 を返しました。管理者ではないか、二要素認証が要ります: ${await reason(created)}`
    )
  else if (created.status === 422 && /already exists/i.test(await created.clone().text()))
    made = false
  else if (!created.ok)
    throw new Error(`Forgejo が ${created.status} を返しました: ${await reason(created)}`)

  // 2. ボットのトークン。同名は作れないので名前に時刻を混ぜる（CLI の形と同じ）
  const issued = await post(`users/${encodeURIComponent(BOT_USER)}/tokens`, {
    name: `izuna-${Date.now().toString(36)}`,
    scopes: [...GRANTED_SCOPES]
  })
  if (!issued.ok)
    throw new Error(
      `${BOT_USER} のトークンを作れませんでした（${issued.status}）: ${await reason(issued)}`
    )
  const token = ((await issued.json()) as { sha1?: string }).sha1
  if (!token) throw new Error('Forgejo がトークンの本体（sha1）を返しませんでした')

  // 3. 貼られたときと同じ関所を通して保管する
  const saved = await adoptToken(rootUrl, token)
  return `${made ? `ボット ${BOT_USER} を作り、` : `ボット ${BOT_USER} は既にあったので、`}${saved}`
}

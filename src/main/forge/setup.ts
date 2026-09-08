import { readFile, writeFile } from 'node:fs/promises'
import { run as exec0 } from '../exec'
import { join } from 'node:path'
import { BOT_USER, GRANTED_SCOPES, parseAppIni, tokenMayTravel, type ForgeConfig, type ForgeFacts } from '../../shared/forge'
import { loginShellEnv } from '../claude/locate'
import { loadScopes, loadToken, saveToken } from './store'
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
    return { path: '(設定から)', rootUrl: cfg2.forgejoUrl, httpPort: null,
      httpAddr: null, installLocked: true, actionsEnabled: true }
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

/** トークンが通るか、どのスコープを持つかを本人に聞く */
async function inspectToken(
  rootUrl: string | null,
  token: string | null
): Promise<{ scopes: string[] | null; works: boolean | null }> {
  if (!token) return { scopes: null, works: null }
  if (!rootUrl) return { scopes: null, works: null }
  // 経路が危なければ聞きに行かない。分からないまま返す（診断が経路の行を出す）
  if (!tokenMayTravel(rootUrl)) return { scopes: null, works: null }
  try {
    const res = await fetch(new URL('api/v1/user', rootUrl), {
      headers: { Authorization: `token ${token}` },
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) return { scopes: [], works: false }
    /**
     * **サーバが持っている権限を見る。**
     *
     * 最初は「発行したときに要求した一覧」を返していた。それは記録であって
     * 事実ではないので、作り直しても判定が変わらなかった。
     * `GET /users/{u}/tokens` は token 認証で通り、`scopes` を返す（実測）。
     * 末尾 8 文字で、手元のトークンがどれかを突き合わせる。
     */
    const me = (await res.json()) as { login?: string }
    if (!me.login) return { scopes: await loadScopes(), works: true }
    try {
      const tokens = await listTokens(rootUrl, me.login)
      const mine = tokens.find((t) => token.endsWith(t.last8))
      return { scopes: mine?.scopes ?? (await loadScopes()), works: true }
    } catch {
      // 一覧が引けない版もありうる。そのときは記録に落とす
      return { scopes: await loadScopes(), works: true }
    }
  } catch {
    return { scopes: [], works: false }
  }
}

export async function gatherFacts(): Promise<ForgeFacts> {
  const binary = await which('forgejo')
  if (!binary) {
    return { binary: null, version: null, config: null, reachable: false,
      tokenScopes: null, tokenWorks: null, runners: null }
  }
  const [version, config, token] = await Promise.all([
    run(binary, ['--version']).then((v) => /version (\S+)/.exec(v)?.[1] ?? null).catch(() => null),
    findConfig(),
    loadToken()
  ])
  const reachable = await probe(config?.rootUrl ?? null)
  const { scopes, works } = await inspectToken(config?.rootUrl ?? null, token)
  return { binary, version, config, reachable, tokenScopes: scopes, tokenWorks: works, runners: null }
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
  const names = out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)
  if (names.includes(BOT_USER)) return BOT_USER
  await run(binary, [
    'admin', 'user', 'create',
    '--username', BOT_USER,
    '--email', `${BOT_USER}@localhost.invalid`,
    '--random-password', '--must-change-password=false',
    '--work-path', workPath
  ])
  return BOT_USER
}

function workPathOf(config: ForgeConfig): string {
  return config.path.replace(/\/custom\/conf\/app\.ini$/, '')
}

export type FixId = 'install' | 'start' | 'token' | 'actions' | 'openAddr' | 'runnerToken'

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
        'admin', 'user', 'generate-access-token',
        '--username', user, '--token-name', name, '--raw',
        // **`write:user` が要る。** `POST /user/repos` は `write:repository`
        // だけでは 403 になる（2026-09-08 に実測。片方ずつ試して確かめた）。
        // 「ユーザーの下に作る」ので、どちらの権限も要求される。
        '--scopes', GRANTED_SCOPES.join(','),
        '--work-path', workPath
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

    case 'openAddr': {
      if (!facts.config) throw new Error('app.ini が見つかりません')
      const text = await readFile(facts.config.path, 'utf8')
      if (!/^\s*HTTP_ADDR\s*=/m.test(text)) {
        throw new Error('HTTP_ADDR の行が見つかりません。手で [server] に HTTP_ADDR = 0.0.0.0 を足してください')
      }
      await writeFile(`${facts.config.path}.izuna-backup`, text, 'utf8')
      await writeFile(facts.config.path, text.replace(/^(\s*HTTP_ADDR\s*=\s*).*$/m, '$10.0.0.0'), 'utf8')
      await run('brew', ['services', 'restart', 'forgejo'])
      return '0.0.0.0 で待ち受けるようにして再起動しました。同じネットワークの他の端末からも見えます（元の app.ini は .izuna-backup に残してあります）'
    }

    case 'runnerToken': {
      if (!facts.binary || !facts.config) throw new Error('Forgejo が見つかりません')
      const out = await run(facts.binary, [
        'forgejo-cli', 'actions', 'generate-runner-token',
        '--work-path', workPathOf(facts.config)
      ])
      return `runner の登録トークン: ${out.split('\n').pop()?.trim() ?? out}`
    }
  }
}

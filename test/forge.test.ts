import { describe, expect, it } from 'vitest'
import {
  diagnose,
  missingScopes,
  parseAppIni,
  readyForForge,
  openToLan,
  tokenMayTravel,
  transportRefusal,
  type ForgeFacts
} from '../src/shared/forge'

/**
 * Forgejo の環境診断に対する門（段5 の入口）。
 *
 * 純粋関数なので、**Forgejo が無い環境でも壊れている環境でも**検査できる。
 * 判定を間違えると「動いているのに動いていないと言う」道具になる。
 */

// 手元の app.ini の実物（/opt/homebrew/var/forgejo/custom/conf/app.ini）
const REAL_INI = `
APP_NAME = Forgejo
RUN_USER = someone
RUN_MODE = prod

[server]
DOMAIN = localhost
HTTP_ADDR = 127.0.0.1
HTTP_PORT = 4649
ROOT_URL = http://localhost:4649/

[database]
DB_TYPE = sqlite3

[security]
INSTALL_LOCK = true

[actions]
ENABLED = false

[log]
MODE = file
`

const facts = (over: Partial<ForgeFacts>): ForgeFacts => ({
  binary: '/opt/homebrew/bin/forgejo',
  version: '16.0.3',
  config: {
    path: '/x/app.ini',
    rootUrl: 'http://localhost:4649/',
    httpPort: 4649,
    httpAddr: '127.0.0.1',
    installLocked: true,
    actionsEnabled: false
  },
  reachable: true,
  tokenScopes: ['write:user', 'write:repository'],
  tokenWorks: true,
  tokenUnreadable: false,
  remote: false,
  tokenRejection: null,
  runners: null,
  ...over
})

const find = (f: ForgeFacts, id: string): ReturnType<typeof diagnose>[number] =>
  diagnose(f).find((c) => c.id === id)!

describe('app.ini を読む', () => {
  const c = parseAppIni(REAL_INI)

  it('実物から要る値を拾う', () => {
    expect(c.httpPort).toBe(4649)
    expect(c.httpAddr).toBe('127.0.0.1')
    expect(c.rootUrl).toBe('http://localhost:4649/')
    expect(c.installLocked).toBe(true)
  })

  it('[actions] の ENABLED だけを見る', () => {
    // ほかの節にも ENABLED はあるので、節を跨いで拾ってはいけない
    expect(c.actionsEnabled).toBe(false)
    expect(parseAppIni('[actions]\nENABLED = true\n').actionsEnabled).toBe(true)
  })

  it('[actions] 節が無ければ有効とみなす（Forgejo の既定）', () => {
    expect(parseAppIni('[server]\nHTTP_PORT = 3000\n').actionsEnabled).toBe(true)
  })

  it('無い値は null。0 や空文字に倒さない', () => {
    const empty = parseAppIni('')
    expect(empty.httpPort).toBeNull()
    expect(empty.rootUrl).toBeNull()
    expect(empty.installLocked).toBe(false)
  })
})

describe('待ち受けが LAN に開いているか', () => {
  it('loopback は閉じている', () => {
    for (const a of ['127.0.0.1', 'localhost', '::1', ' 127.0.0.1 ']) {
      expect(openToLan(a), a).toBe(false)
    }
  })

  it('0.0.0.0 と LAN のアドレスは開いている。未設定は Forgejo の既定（0.0.0.0）', () => {
    expect(openToLan('0.0.0.0')).toBe(true)
    expect(openToLan('192.168.1.10')).toBe(true)
    expect(openToLan(null)).toBe(true)
  })

  it('開いていれば Actions の有無によらず警告する。押して直す釦は無い（人が app.ini を戻す）', () => {
    const open = { ...facts({}).config!, httpAddr: '0.0.0.0' }
    const c = diagnose(facts({ config: open })).find((x) => x.id === 'lanOpen')
    expect(c?.level).toBe('warn')
    expect(c?.detail).toContain('他の端末')
    // runner のために開く必要は無いことを、その場で言う（2026-09-10 実測）
    expect(c?.detail).toContain('host.docker.internal')
    expect(c?.fix).toBeNull()
  })

  it('loopback なら ok で、runner が届く理由を添える', () => {
    const c = diagnose(facts({})).find((x) => x.id === 'lanOpen')
    expect(c?.level).toBe('ok')
    expect(c?.detail).toContain('host.docker.internal')
  })
})

describe('スコープ', () => {
  it('足りないものを名指しする', () => {
    // 実測: `POST /user/repos` は write:user と write:repository の両方を要求する
    expect(missingScopes(['write:repository'])).toEqual(['write:user'])
    expect(missingScopes(['write:user', 'write:repository', 'write:issue'])).toEqual([])
  })

  it('権限が分からないものを「足りない」と言わない', () => {
    // 古い版で発行したトークンは記録を持たない。**分からないことは分からないと言う**
    const c = find(facts({ tokenScopes: [] }), 'token')
    expect(c.level).toBe('warn')
    expect(c.detail).toContain('分かりません')
    expect(c.fix).not.toBeNull()
  })

  it('未設定は全部足りない', () => {
    expect(missingScopes(null)).toEqual(['write:user', 'write:repository'])
  })
})

describe('診断', () => {
  it('揃っていれば段5 に進める', () => {
    expect(readyForForge(diagnose(facts({})))).toBe(true)
  })

  it('入っていなければ、そこで止めて先を出さない', () => {
    // 無いものの上に「動いていません」を重ねても混乱するだけ
    const checks = diagnose(facts({ binary: null }))
    expect(checks).toHaveLength(1)
    expect(checks[0].level).toBe('ng')
    expect(checks[0].fix?.label).toContain('Homebrew')
  })

  it('応答が無ければ起動を促す', () => {
    expect(find(facts({ reachable: false }), 'running')).toMatchObject({ level: 'ng' })
  })

  it('スコープ不足は理由を名指しする', () => {
    // 実際に 403 tokenRequiresScopes を踏んだので、原因が読めることを門にする
    const c = find(facts({ tokenScopes: ['write:repository'] }), 'token')
    expect(c.level).toBe('ng')
    expect(c.detail).toContain('write:user')
  })

  it('トークンが拒否されたら作り直しを促す', () => {
    expect(find(facts({ tokenWorks: false }), 'token').level).toBe('ng')
  })

  it('Actions と runner は任意。無効でも段5 には進める', () => {
    const checks = diagnose(facts({ config: { ...facts({}).config!, actionsEnabled: false } }))
    expect(checks.find((c) => c.id === 'actions')?.level).toBe('warn')
    expect(readyForForge(checks)).toBe(true)
  })

  it('Actions が有効なら runner も見る', () => {
    const on = { ...facts({}).config!, actionsEnabled: true }
    expect(diagnose(facts({ config: on, runners: 0 })).find((c) => c.id === 'runner')?.level).toBe(
      'warn'
    )
    expect(diagnose(facts({ config: on, runners: 1 })).find((c) => c.id === 'runner')?.level).toBe(
      'ok'
    )
  })

  it('INSTALL_LOCK が false なら手でやってもらう（自動で押し切らない）', () => {
    const c = find(facts({ config: { ...facts({}).config!, installLocked: false } }), 'configured')
    expect(c.level).toBe('warn')
    expect(c.fix).toBeNull()
  })
})

describe('トークンを載せてよい経路（§26）', () => {
  it('ループバックか https だけ', () => {
    expect(tokenMayTravel('http://localhost:4649/')).toBe(true)
    expect(tokenMayTravel('http://127.0.0.1:4649/')).toBe(true)
    expect(tokenMayTravel('http://[::1]:4649/')).toBe(true)
    expect(tokenMayTravel('https://forge.example/')).toBe(true)
  })

  it('**平文で LAN を通るものには載せない**', () => {
    expect(tokenMayTravel('http://192.168.1.10:4649/')).toBe(false)
    expect(tokenMayTravel('http://mac.local:4649/')).toBe(false)
    expect(tokenMayTravel('ftp://localhost/')).toBe(false)
    expect(tokenMayTravel(null)).toBe(false)
    expect(tokenMayTravel('::')).toBe(false)
  })

  it('診断に経路の行が出て、段5 に進めない', () => {
    const checks = diagnose(
      facts({
        config: {
          path: '/p/custom/conf/app.ini',
          rootUrl: 'http://192.168.1.10:4649/',
          httpPort: 4649,
          httpAddr: '0.0.0.0',
          installLocked: true,
          actionsEnabled: false
        }
      })
    )
    const c = checks.find((x) => x.id === 'transport')
    expect(c?.level).toBe('ng')
    expect(c?.detail).toBe(transportRefusal('http://192.168.1.10:4649/'))
    expect(readyForForge(checks)).toBe(false)
  })

  it('ループバックなら経路の行は出ない', () => {
    expect(diagnose(facts({})).find((x) => x.id === 'transport')).toBeUndefined()
  })
})

describe('保管はあるのに読めない（2026-09-09、E2E で見つけた）', () => {
  it('**「未設定」と言わない。** 鍵が変わったと言い、発行し直す釦を出す', () => {
    const c = find(facts({ tokenScopes: null, tokenWorks: null, tokenUnreadable: true }), 'token')
    expect(c.level).toBe('ng')
    expect(c.detail).toContain('復号できません')
    expect(c.detail).not.toContain('未設定')
    expect(c.fix?.label).toBe('発行し直す')
  })
})

/**
 * 押しても直らないのに釦を出すと、**トークンだけが増える**（2026-09-09）。
 *
 * Forgejo のトークンは Izuna から消せない —— `DELETE /users/{u}/tokens/{id}` は
 * `auth method not allowed` を返し、`forgejo admin user` に削除の口が無い。
 *
 * 以前は「通らなかった」を `tokenScopes: []` で表していて、その枝が
 * 「通ったか」の枝より**前**にあった。だから拒否されたトークンが
 * 「古い版で発行されたため、権限が分かりません」と出て、
 * 発行し直しても原因は変わらず、押すたびに 1 本ずつ溜まった。
 */
describe('発行し直して直るときだけ、発行し直すと言う', () => {
  const rejected = (status: number | null, detail = 'x'): ForgeFacts =>
    facts({ tokenScopes: null, tokenWorks: false, tokenRejection: { status, detail } })

  it('**通らなかったことを、権限の話より先に言う**', () => {
    const c = find(rejected(401, 'http://localhost:4649/api/v1/user が 401 を返しました'), 'token')
    expect(c.detail).toContain('通りませんでした')
    expect(c.detail).not.toContain('古い版')
    expect(c.detail).not.toContain('未設定')
  })

  it('401 は作り直せば直るので、釦を出す', () => {
    expect(find(rejected(401), 'token').fix?.label).toBe('発行し直す')
  })

  it('403 も作り直せば直る', () => {
    expect(find(rejected(403), 'token').fix?.label).toBe('発行し直す')
  })

  it('**繋がらないときは釦を出さない**（押しても増えるだけ）', () => {
    const c = find(rejected(null, 'localhost:4649 に繋がりません'), 'token')
    expect(c.fix).toBeNull()
    expect(c.detail).toContain('繋がりません')
  })

  it('500 も釦を出さない（サーバ側の話で、トークンのせいではない）', () => {
    expect(find(rejected(500), 'token').fix).toBeNull()
  })

  it('理由が無くても「通りませんでした」とは言う', () => {
    const c = find(facts({ tokenScopes: null, tokenWorks: false, tokenRejection: null }), 'token')
    expect(c.detail).toBe('通りませんでした')
    expect(c.fix).toBeNull()
  })

  it('**増えることを警告に書く**（消せないので）', () => {
    const w = find(facts({ tokenScopes: ['write:repository'] }), 'token').fix?.warning ?? ''
    expect(w).toContain('消せない')
    expect(w).toContain('残ります')
  })

  it('通っていれば、これまでどおり権限を見る', () => {
    expect(find(facts({ tokenScopes: ['write:repository'] }), 'token').detail).toContain(
      'write:user'
    )
    expect(find(facts({}), 'token').level).toBe('ok')
  })

  it('未設定は「発行する」であって「発行し直す」ではない', () => {
    const c = find(facts({ tokenScopes: null, tokenWorks: null }), 'token')
    expect(c.fix?.label).toBe('トークンを発行する')
  })

  it('権限が分からないときは「足りない」と言わない', () => {
    const c = find(facts({ tokenScopes: [] }), 'token')
    expect(c.level).toBe('warn')
    expect(c.detail).toContain('分かりません')
  })
})

describe('手元に forgejo が無い構成（Docker や別マシン。docs/SETUP.md）', () => {
  const remote = (over: Partial<ForgeFacts> = {}): ForgeFacts =>
    facts({ binary: null, version: null, remote: true, ...over })

  it('設定の forgejoUrl で見ているなら、インストールの行は ok で先へ進む', () => {
    const checks = diagnose(remote())
    expect(checks[0]).toMatchObject({ id: 'installed', level: 'ok' })
    expect(checks[0].detail).toContain('forgejoUrl')
    expect(checks.map((c) => c.id)).toContain('token')
    expect(readyForForge(checks)).toBe(true)
  })

  it('トークンが無ければ「管理者から作るか貼る」と言い、CLI の発行の釦は出さない', () => {
    const t = find(remote({ tokenScopes: null, tokenWorks: null }), 'token')
    expect(t.level).toBe('ng')
    expect(t.detail).toContain('貼って')
    expect(t.detail).toContain('管理者')
    expect(t.fix).toBeNull()
  })

  it('拒否されても「発行し直す」を出さない。増やせないものを増やすと言わない', () => {
    const t = find(
      remote({
        tokenWorks: false,
        tokenScopes: null,
        tokenRejection: { status: 401, detail: 'x' }
      }),
      'token'
    )
    expect(t.fix).toBeNull()
    const s = find(remote({ tokenScopes: ['read:user'] }), 'token')
    expect(s.level).toBe('ng')
    expect(s.fix).toBeNull()
  })

  it('手元にも設定にも無ければ、そこで止めて Docker と forgejoUrl の道を言う', () => {
    const checks = diagnose(facts({ binary: null, config: null, remote: false }))
    expect(checks).toHaveLength(1)
    expect(checks[0].detail).toContain('forgejoUrl')
  })
})

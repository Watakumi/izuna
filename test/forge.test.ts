import { describe, expect, it } from 'vitest'
import {
  diagnose,
  missingScopes,
  parseAppIni,
  readyForForge,
  reachableFromContainer,
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
RUN_USER = watakumi
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
  config: { path: '/x/app.ini', rootUrl: 'http://localhost:4649/', httpPort: 4649,
    httpAddr: '127.0.0.1', installLocked: true, actionsEnabled: false },
  reachable: true,
  tokenScopes: ['write:user', 'write:repository'],
  tokenWorks: true,
  tokenUnreadable: false,
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

describe('runner から届くか', () => {
  it('loopback は届かない', () => {
    // macOS では runner を Docker で回すしかない。コンテナはホストの
    // 127.0.0.1 に届かないので、ここが loopback だと Actions は必ず失敗する
    for (const a of ['127.0.0.1', 'localhost', '::1', ' 127.0.0.1 ']) {
      expect(reachableFromContainer(a), a).toBe(false)
    }
  })

  it('開いていれば届く', () => {
    expect(reachableFromContainer('0.0.0.0')).toBe(true)
    expect(reachableFromContainer('192.168.1.10')).toBe(true)
  })

  it('未設定は Forgejo の既定（0.0.0.0）とみなす', () => {
    expect(reachableFromContainer(null)).toBe(true)
  })

  it('Actions が無効なら、この検査は出さない（関係ないので）', () => {
    const off = diagnose(facts({}))
    expect(off.find((c) => c.id === 'reachableFromRunner')).toBeUndefined()
  })

  it('Actions が有効で loopback なら警告する', () => {
    const on = { ...facts({}).config!, actionsEnabled: true, httpAddr: '127.0.0.1' }
    const c = diagnose(facts({ config: on })).find((x) => x.id === 'reachableFromRunner')
    expect(c?.level).toBe('warn')
    // 押すと外から見えるようになることを、押す前に伝える
    expect(c?.fix?.warning).toContain('他の端末')
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
    expect(diagnose(facts({ config: on, runners: 0 })).find((c) => c.id === 'runner')?.level).toBe('warn')
    expect(diagnose(facts({ config: on, runners: 1 })).find((c) => c.id === 'runner')?.level).toBe('ok')
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
    const checks = diagnose(facts({ config: { path: '/p/custom/conf/app.ini', rootUrl: 'http://192.168.1.10:4649/',
      httpPort: 4649, httpAddr: '0.0.0.0', installLocked: true, actionsEnabled: false } }))
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

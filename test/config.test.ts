import { describe, expect, it } from 'vitest'
import { DEFAULTS, mergeConfig, parseConfig } from '../src/shared/config'

/**
 * 設定の読み込みに対する門。
 *
 * **壊れた設定でアプリを起動不能にしない。** 設定 1 行の誤りで起動しないのは
 * 割に合わない。落とした項目は名指しする —— 黙って既定に倒すと、
 * 直したのに効かない理由が分からなくなる。
 */

describe('既定に重ねる', () => {
  it('空なら既定のまま', () => {
    expect(mergeConfig({})).toEqual({ config: DEFAULTS, ignored: [] })
  })

  it('書いたものだけ上書きする', () => {
    const { config } = mergeConfig({ sandboxRemote: 'home' })
    expect(config.sandboxRemote).toBe('home')
    expect(config.repoRoots).toEqual(DEFAULTS.repoRoots)
  })

  it('Docker で建てている人は workPaths を空にして URL を書ける', () => {
    const { config, ignored } = mergeConfig({
      forgejoWorkPaths: [],
      forgejoUrl: 'http://forge.home.lan:3000/'
    })
    // 空配列は「候補なし」という意思表示。落とさない
    expect(config.forgejoWorkPaths).toEqual([])
    expect(config.forgejoUrl).toBe('http://forge.home.lan:3000/')
    expect(ignored).toEqual([])
  })
})

describe('壊れた値は落として既定を使う', () => {
  it('型が違えば名指しで落とす', () => {
    const { config, ignored } = mergeConfig({ repoRoots: 'not-an-array', repoDepth: 'deep' })
    expect(config.repoRoots).toEqual(DEFAULTS.repoRoots)
    expect(config.repoDepth).toBe(DEFAULTS.repoDepth)
    expect(ignored).toEqual(['repoRoots', 'repoDepth'])
  })

  it('深さは 1〜6 に収める（ホーム全体を舐めさせない）', () => {
    expect(mergeConfig({ repoDepth: 0 }).ignored).toEqual(['repoDepth'])
    expect(mergeConfig({ repoDepth: 99 }).ignored).toEqual(['repoDepth'])
    expect(mergeConfig({ repoDepth: 4 }).config.repoDepth).toBe(4)
  })

  it('remote 名に使えない文字は落とす', () => {
    expect(mergeConfig({ sandboxRemote: 'a b' }).ignored).toEqual(['sandboxRemote'])
    expect(mergeConfig({ sandboxRemote: 'my-forge' }).config.sandboxRemote).toBe('my-forge')
  })

  it('settingSources は既知の値だけ', () => {
    expect(mergeConfig({ settingSources: ['user', 'nope'] }).ignored).toEqual(['settingSources'])
    expect(
      mergeConfig({ settingSources: ['user', 'project', 'local'] }).config.settingSources
    ).toEqual(['user', 'project', 'local'])
  })

  it('空文字の混ざった配列は落とす', () => {
    expect(mergeConfig({ repoRoots: ['~/work', '  '] }).ignored).toEqual(['repoRoots'])
  })

  it('null は「消した」であって誤りではない', () => {
    const { config, ignored } = mergeConfig({ forgejoUrl: null, claudePath: null })
    expect(config.forgejoUrl).toBeNull()
    expect(ignored).toEqual([])
  })
})

describe('JSON として壊れていても落ちない', () => {
  it('読めなければ既定に倒し、理由を言う', () => {
    const { config, ignored } = parseConfig('{ これは JSON ではない')
    expect(config).toEqual(DEFAULTS)
    expect(ignored[0]).toContain('JSON')
  })

  it('配列やスカラーが来ても既定に倒す', () => {
    expect(mergeConfig([1, 2]).config).toEqual(DEFAULTS)
    expect(mergeConfig('x').ignored).toHaveLength(1)
  })

  it('空の設定ファイルは既定のまま', () => {
    expect(parseConfig('{}')).toEqual({ config: DEFAULTS, ignored: [] })
  })
})

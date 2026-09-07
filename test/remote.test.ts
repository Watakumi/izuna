import { describe, expect, it } from 'vitest'
import {
  hostOf,
  parseRemoteUrl,
  parseRemotes,
  roleOf,
  rolesIn,
  stageOf,
  workshopRemoteUrl
} from '../src/shared/remote'

/**
 * remote の解釈に対する門（段5）。
 *
 * 二段の PR の要。**どの remote が作業場でどれが出口か**を取り違えると、
 * 荒れた作業ブランチを GitHub に押し出すことになる。
 *
 * 材料は手元の gh-radar の実物。
 */

// git -C ~/work/personal/gh-radar remote -v の実出力
const REAL = `forgejo	http://localhost:4649/watakumi/gh-radar.git (fetch)
forgejo	http://localhost:4649/watakumi/gh-radar.git (push)
origin	git@github.com:Watakumi/gh-radar.git (fetch)
origin	git@github.com:Watakumi/gh-radar.git (push)`

const FORGE = 'http://localhost:4649/'

describe('URL を読む', () => {
  it('ssh 形式', () => {
    expect(parseRemoteUrl('git@github.com:Watakumi/gh-radar.git'))
      .toEqual({ host: 'github.com', owner: 'Watakumi', repo: 'gh-radar' })
  })

  it('http 形式', () => {
    expect(parseRemoteUrl('http://localhost:4649/watakumi/gh-radar.git'))
      .toEqual({ host: 'localhost:4649', owner: 'watakumi', repo: 'gh-radar' })
  })

  it('.git が無くても読む', () => {
    expect(parseRemoteUrl('https://github.com/a/b')?.repo).toBe('b')
  })

  it('ssh:// とポート付き', () => {
    expect(parseRemoteUrl('ssh://git@forge.home.lan:2222/watakumi/izuna.git'))
      .toEqual({ host: 'forge.home.lan', owner: 'watakumi', repo: 'izuna' })
  })

  it('読めないものは null（空文字や 0 に倒さない）', () => {
    expect(parseRemoteUrl('')).toBeNull()
    expect(parseRemoteUrl('not a url')).toBeNull()
    expect(parseRemoteUrl('https://github.com/onlyowner')).toBeNull()
  })
})

describe('役割はホストで決める', () => {
  it('GitHub は出口', () => {
    expect(roleOf('github.com', 'localhost:4649')).toBe('exit')
  })

  it('Forgejo のホストは作業場', () => {
    expect(roleOf('localhost:4649', 'localhost:4649')).toBe('workshop')
  })

  it('remote の名前では決めない', () => {
    // origin が Forgejo を指している人もいる。名前を信じると取り違える
    const flipped = parseRemotes(
      'origin\thttp://localhost:4649/w/r.git (fetch)\nupstream\tgit@github.com:W/r.git (fetch)',
      FORGE
    )
    expect(flipped.find((r) => r.name === 'origin')?.role).toBe('workshop')
    expect(flipped.find((r) => r.name === 'upstream')?.role).toBe('exit')
  })

  it('知らないホストは other', () => {
    expect(roleOf('gitlab.com', 'localhost:4649')).toBe('other')
    expect(roleOf(null, 'localhost:4649')).toBe('other')
  })
})

describe('gh-radar の実物', () => {
  const remotes = parseRemotes(REAL, FORGE)

  it('fetch と push の重複を畳む', () => {
    expect(remotes).toHaveLength(2)
  })

  it('作業場と出口が揃っている', () => {
    const { workshop, exit } = rolesIn(remotes)
    expect(workshop?.name).toBe('forgejo')
    expect(workshop?.owner).toBe('watakumi')
    expect(exit?.name).toBe('origin')
    expect(exit?.owner).toBe('Watakumi')
  })
})

describe('段の判定', () => {
  const remotes = parseRemotes(REAL, FORGE)

  it('作業場が無ければ、まず用意する', () => {
    const onlyGitHub = parseRemotes('origin\tgit@github.com:W/r.git (fetch)', FORGE)
    expect(stageOf({ remotes: onlyGitHub, pushedToWorkshop: false })).toBe('needsWorkshop')
  })

  it('push していなければ push', () => {
    expect(stageOf({ remotes, pushedToWorkshop: false })).toBe('needsPush')
  })

  it('作業場で見たら出口へ', () => {
    expect(stageOf({ remotes, pushedToWorkshop: true })).toBe('readyForExit')
  })
})

describe('作業場の URL を組む', () => {
  it('末尾のスラッシュを重ねない', () => {
    expect(workshopRemoteUrl('http://localhost:4649/', 'watakumi', 'izuna'))
      .toBe('http://localhost:4649/watakumi/izuna.git')
  })

  it('ホストだけ取り出す', () => {
    expect(hostOf('http://localhost:4649/')).toBe('localhost:4649')
    expect(hostOf(null)).toBeNull()
    expect(hostOf('bad')).toBeNull()
  })
})

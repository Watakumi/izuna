// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ForgeSetup } from '../../src/renderer/src/components/ForgeSetup'
import type { ForgeFacts } from '../../src/shared/forge'
import type { ClaudeFacts } from '../../src/shared/prereq'

afterEach(cleanup)

/** 全部そろった状態。検査ごとに一部を崩す */
const good = (over: Partial<ForgeFacts> = {}): ForgeFacts => ({
  binary: '/opt/homebrew/bin/forgejo',
  version: '16.0.3',
  config: {
    path: '/opt/homebrew/etc/forgejo/app.ini',
    rootUrl: 'http://localhost:4649/',
    httpPort: 4649,
    httpAddr: '127.0.0.1',
    installLocked: true,
    actionsEnabled: true
  },
  reachable: true,
  tokenScopes: ['write:user', 'write:repository'],
  tokenWorks: true,
  tokenRejection: null,
  tokenUnreadable: false,
  runners: 1,
  remote: false,
  ...over
})

const claudeOk: ClaudeFacts = {
  path: '/Users/someone/.local/bin/claude',
  version: '2.1.266',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscription: 'Pro'
}

let facts: ForgeFacts = good()
let claude: ClaudeFacts = claudeOk
let tokens: Array<{
  id: number
  name: string
  scopes: string[]
  last8: string
  createdAt: string
}> = []
let calls: string[] = []
let fixFails = false

beforeEach(() => {
  facts = good()
  claude = claudeOk
  tokens = []
  calls = []
  fixFails = false
  ;(window as unknown as { izuna: unknown }).izuna = {
    configInfo: async () => ({
      path: '/home/.izuna/config.json',
      ignored: ['repoDepth'],
      exists: true
    }),
    forgeFacts: async () => facts,
    claudeStatus: async () => claude,
    forgeFix: async (id: string) => {
      calls.push(`fix:${id}`)
      if (fixFails) throw new Error('brew services start forgejo が失敗しました')
      facts = good()
      return '起動しました'
    },
    forgeSetToken: async (token: string) => {
      calls.push(`token:${token}`)
      facts = good({ remote: true, binary: null })
      return '保管しました'
    },
    forgeTokens: async () => ({
      tokens,
      mineLast8: 'aaaaaaaa',
      settingsUrl: 'http://localhost:4649/user/settings/applications'
    })
  }
})

/** 準備の画面。**検出は自動、変更は明示のクリック**（§7 の Forgejo の罠） */
describe('ForgeSetup', () => {
  it('Claude Code と Forgejo の項目を並べ、全部そろえば「準備できています」', async () => {
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('準備できています')).toBeTruthy())
    // 見出しと行の 2 つ
    expect(screen.getAllByText('Claude Code').length).toBe(2)
    expect(screen.getByText('ログイン')).toBeTruthy()
    expect(screen.getByText('claude.ai · Pro')).toBeTruthy()
    expect(screen.getByText('インストール')).toBeTruthy()
    expect(screen.getByText('起動')).toBeTruthy()
    // 設定の場所と、読めずに倒した項目を名指しする（§15）
    expect(screen.getByText('/home/.izuna/config.json')).toBeTruthy()
    expect(screen.getByText('読めずに既定へ倒した項目: repoDepth')).toBeTruthy()
  })

  it('止まっていれば釦が出て、押すと id を渡し、結果と取り直した状態を出す', async () => {
    facts = good({ reachable: false })
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('起動する')).toBeTruthy())
    expect(screen.getByText('必須の項目が残っています（任意の項目は数えません）')).toBeTruthy()
    expect(screen.getByText('brew services start forgejo を実行します')).toBeTruthy()
    fireEvent.click(screen.getByText('起動する'))
    await waitFor(() => expect(screen.getByText('起動しました')).toBeTruthy())
    expect(calls).toEqual(['fix:start'])
    await waitFor(() => expect(screen.getByText('準備できています')).toBeTruthy())
  })

  it('直せなかったときはその言い分を赤で出す', async () => {
    facts = good({ reachable: false })
    fixFails = true
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('起動する')).toBeTruthy())
    fireEvent.click(screen.getByText('起動する'))
    await waitFor(() =>
      expect(screen.getByText('brew services start forgejo が失敗しました')).toBeTruthy()
    )
    expect(screen.getByText('起動する')).toBeTruthy()
  })

  it('手元に forgejo が無ければ、貼ったトークンを確かめてから保管する', async () => {
    facts = good({ remote: true, binary: null, tokenScopes: null, tokenWorks: null })
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByPlaceholderText('izuna のトークンを貼る')).toBeTruthy())
    const save = screen.getByText('保管する') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('izuna のトークンを貼る'), {
      target: { value: ' tok-1234 ' }
    })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText('保管しました')).toBeTruthy())
    expect(calls).toEqual(['token: tok-1234 '])
    // 保管できたら欄は消える
    await waitFor(() => expect(screen.queryByPlaceholderText('izuna のトークンを貼る')).toBeNull())
  })

  it('Claude Code が無ければ準備できていない。ログインの行は出ない', async () => {
    claude = { path: null, version: null, loggedIn: null, authMethod: null, subscription: null }
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('Claude Code').length).toBe(2))
    expect(screen.queryByText('ログイン')).toBeNull()
    expect(screen.getByText('必須の項目が残っています（任意の項目は数えません）')).toBeTruthy()
  })

  it('溜まったトークンを数え、開けば使用中の印と Forgejo への導線を出す。閉じるは onClose', async () => {
    tokens = [
      { id: 1, name: 'izuna-0908', scopes: ['write:user'], last8: 'aaaaaaaa', createdAt: '' },
      { id: 2, name: 'izuna-0907', scopes: ['write:user'], last8: 'bbbbbbbb', createdAt: '' }
    ]
    const closed: number[] = []
    render(<ForgeSetup onClose={() => closed.push(1)} />)
    await waitFor(() => expect(screen.getByText('トークン 2 件')).toBeTruthy())
    expect(screen.getByText('使っていないもの 1 件')).toBeTruthy()
    fireEvent.click(screen.getByText('トークン 2 件'))
    expect(screen.getByText('使用中')).toBeTruthy()
    expect((screen.getByText('Forgejo で消す') as HTMLAnchorElement).href).toBe(
      'http://localhost:4649/user/settings/applications'
    )
    fireEvent.click(screen.getByText('閉じる'))
    expect(closed).toEqual([1])
  })
})

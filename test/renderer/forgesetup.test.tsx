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
let repos: Array<Record<string, unknown>> = []

beforeEach(() => {
  facts = good()
  claude = claudeOk
  tokens = []
  calls = []
  fixFails = false
  repos = []
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
    forgeProvisionBot: async (admin: { user: string; password: string }) => {
      calls.push(`provision:${admin.user}:${admin.password}`)
      facts = good({ remote: true, binary: null })
      return 'ボット izuna を作り、izuna のトークンを保管しました'
    },
    forgeSetToken: async (token: string) => {
      calls.push(`token:${token}`)
      facts = good({ remote: true, binary: null })
      return '保管しました'
    },
    forgeRepos: async () => repos,
    forgeDeleteRepo: async (owner: string, name: string) => {
      calls.push(`delete:${owner}/${name}`)
      if (name === 'keep') throw new Error('izuna/keep はボット izuna のものではない')
      repos = repos.filter((r) => r.name !== name)
      return `${owner}/${name} を消しました`
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
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText('または、Forgejo で作った izuna のトークンを貼る')
      ).toBeTruthy()
    )
    const save = screen.getByText('保管する') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(
      screen.getByPlaceholderText('または、Forgejo で作った izuna のトークンを貼る'),
      {
        target: { value: ' tok-1234 ' }
      }
    )
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByText('保管しました')).toBeTruthy())
    expect(calls).toEqual(['token: tok-1234 '])
    // 保管できたら欄は消える
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText('または、Forgejo で作った izuna のトークンを貼る')
      ).toBeNull()
    )
  })

  it('管理者の名前とパスワードでボットとトークンを作れる。両方そろうまで押せず、済んだら欄を空にする', async () => {
    facts = good({ remote: true, binary: null, tokenScopes: null, tokenWorks: null })
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByPlaceholderText('Forgejo の管理者の名前')).toBeTruthy())
    const make = screen.getByText('ボットとトークンを作る') as HTMLButtonElement
    expect(make.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('Forgejo の管理者の名前'), {
      target: { value: 'admin' }
    })
    expect(make.disabled).toBe(true)
    fireEvent.change(screen.getByPlaceholderText('そのパスワード'), { target: { value: 'pw' } })
    expect(make.disabled).toBe(false)
    fireEvent.click(make)
    await waitFor(() =>
      expect(screen.getByText('ボット izuna を作り、izuna のトークンを保管しました')).toBeTruthy()
    )
    expect(calls).toEqual(['provision:admin:pw'])
    await waitFor(() => expect(screen.queryByPlaceholderText('そのパスワード')).toBeNull())
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

  it('Forgejo の頁を中で開ける。sandbox の一覧から頁と設定、トークンは設定の頁', async () => {
    repos = [
      {
        fullName: 'izuna/a',
        owner: 'izuna',
        name: 'a',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'http://localhost:4649/izuna/a',
        empty: false
      },
      {
        fullName: 'izuna/b',
        owner: 'izuna',
        name: 'b',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'http://localhost:4649/izuna/b',
        empty: true
      }
    ]
    tokens = [{ id: 1, name: 'izuna-1', scopes: [], last8: 'aaaaaaaa', createdAt: '' }]
    const opened: string[] = []
    render(<ForgeSetup onClose={() => {}} onPreview={(u) => opened.push(u)} />)
    await waitFor(() => expect(screen.getByText('sandbox 2 件')).toBeTruthy())
    fireEvent.click(screen.getByText('sandbox 2 件'))
    expect(screen.getByText('izuna/b')).toBeTruthy()
    expect(screen.getByText('空')).toBeTruthy()
    fireEvent.click(screen.getAllByText('頁')[1])
    fireEvent.click(screen.getByText('トークン 1 件'))
    fireEvent.click(screen.getByText('Forgejo で消す'))
    expect(opened).toEqual([
      'http://localhost:4649/izuna/b',
      'http://localhost:4649/user/settings/applications'
    ])
  })

  it('sandbox は確認してから消し、消えたら一覧から外れる。やめれば呼ばない', async () => {
    repos = [
      {
        fullName: 'izuna/a',
        owner: 'izuna',
        name: 'a',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'http://localhost:4649/izuna/a',
        empty: false
      },
      {
        fullName: 'izuna/keep',
        owner: 'izuna',
        name: 'keep',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'http://localhost:4649/izuna/keep',
        empty: false
      }
    ]
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('sandbox 2 件')).toBeTruthy())
    fireEvent.click(screen.getByText('sandbox 2 件'))
    fireEvent.click(screen.getAllByText('消す')[0])
    expect(screen.getByText(/izuna\/a を Forgejo から消します/)).toBeTruthy()
    fireEvent.click(screen.getByText('やめる'))
    expect(calls).toEqual([])
    fireEvent.click(screen.getAllByText('消す')[0])
    // 確認の枠の中の「消す」が本番。行の釦は確認中は隠れるので、先頭が枠のもの
    fireEvent.click(screen.getAllByText('消す')[0])
    await waitFor(() => expect(screen.getByText('izuna/a を消しました')).toBeTruthy())
    expect(calls).toEqual(['delete:izuna/a'])
    await waitFor(() => expect(screen.queryByText('izuna/a')).toBeNull())
    // 断られたら、その言い分をそのまま出す
    fireEvent.click(screen.getAllByText('消す')[0])
    fireEvent.click(screen.getAllByText('消す')[0])
    await waitFor(() =>
      expect(screen.getByText('izuna/keep はボット izuna のものではない')).toBeTruthy()
    )
    expect(screen.getByText('izuna/keep')).toBeTruthy()
  })

  it('中で開けない構成では「頁」を出さず、トークンの導線は外のリンクのまま', async () => {
    repos = [
      {
        fullName: 'izuna/a',
        owner: 'izuna',
        name: 'a',
        private: true,
        defaultBranch: 'main',
        htmlUrl: 'http://localhost:4649/izuna/a',
        empty: false
      }
    ]
    tokens = [{ id: 1, name: 'izuna-1', scopes: [], last8: 'aaaaaaaa', createdAt: '' }]
    render(<ForgeSetup onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('トークン 1 件')).toBeTruthy())
    // 一覧は出るが「頁」は無い。消すのは口があるので出る
    fireEvent.click(screen.getByText('sandbox 1 件'))
    expect(screen.queryByText('頁')).toBeNull()
    expect(screen.getByText('消す')).toBeTruthy()
    fireEvent.click(screen.getByText('トークン 1 件'))
    expect((screen.getByText('Forgejo で消す') as HTMLAnchorElement).tagName).toBe('A')
  })
})

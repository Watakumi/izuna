import type { IzunaApi, SessionEvent } from '../src/shared/ipc'
import { DEFAULT_ROLES } from '../src/shared/meeting'
import type { GhosttySkin } from '../src/main/ghostty'
import { IPC_VERSION } from '../src/shared/ipc'
import { applyMessage, emptyTranscript } from '../src/shared/transcript'

/**
 * `window.izuna` の作り物。**ハーネス専用で、製品には入らない。**
 *
 * これがある理由: renderer の不具合が 6 件続けて、**全部人間が画面を見て
 * 見つけた**（markdown が描けていない・入力欄が真っ白・字が薄い・小さい・
 * 日本語の書体が違う・ターミナルが明るい）。検査は全部「文字列を読む検査」で、
 * **何も描いていなかった**ので原理的に気づけない。
 *
 * renderer は Electron を必要としない —— 触るのは `window.izuna` だけ。
 * だからここを差し替えれば、素のブラウザで本物の画面が描ける。
 */

const iso = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()

/** 実際に出た形に寄せる。**見た目を測るための材料なので、貧しくしない** */
const MESSAGES = [
  {
    type: 'system',
    subtype: 'init',
    session_id: 's1',
    cwd: '/Users/x/work/izuna',
    model: 'claude-opus-5',
    permissionMode: 'default',
    slash_commands: ['verify', 'code-review']
  },
  { type: 'user', message: { role: 'user', content: 'CLAUDE.md を読んで、次にやることを教えて' } },
  {
    type: 'assistant',
    message: {
      id: 'm1',
      content: [
        { type: 'thinking', thinking: 'CLAUDE.md を確認する必要がある。' },
        {
          type: 'text',
          text: [
            'こんにちは！**Izuna のリポジトリ**で作業中ですね。',
            '',
            '## 現状',
            '',
            '`CLAUDE.md` を読む限り、**MVP 完了・`pnpm verify` は緑（246件）**、',
            '次は v1 の 7 手を通しで実機確認、という段階です。',
            '',
            '| 項目 | 状態 | 備考 |',
            '| --- | --- | ---: |',
            '| セッションの復元 | 済 | §18 |',
            '| worktree | `EnterWorktree` に一本化 | §12 |',
            '| 配色 | Ghostty から借りる | §21 |',
            '',
            '- **v1 の 7 手を通しで実機確認**（`docs/GOAL.md` の次のステップ）',
            '- **§9-5: `interrupt()` の SIGINT 疑い** — 未計測',
            '  - `capabilities` に `interrupt_receipt_v1` が出ている',
            '- [設計の決定](https://example.com/decisions) も参照',
            '',
            '```ts',
            'const skin = skinFrom(colors)  // ** は解釈しない',
            '```',
            '',
            '> 引用の中の文も読めること。',
            '',
            '### 図',
            '',
            '```mermaid',
            'flowchart LR',
            '  A[人] --> B[Izuna]',
            '  B --> C[ブレイン]',
            '  C --> D[実行役]',
            '  D --> C',
            '  C --> E[承認]',
            '  E --> A',
            '```',
            '',
            '図にできないものは字のまま出ます:',
            '',
            '```mermaid',
            'これは mermaid ではない',
            '```',
            '',
            'やりたいことを言ってもらえれば、共有フォルダに brief を切ってから進めます。'
          ].join('\n')
        },
        {
          type: 'tool_use',
          id: 't1',
          name: 'Read',
          input: { file_path: '/Users/x/work/izuna/CLAUDE.md' }
        }
      ]
    }
  },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '（900 行）' }] }
  },
  {
    type: 'assistant',
    message: {
      id: 'm2',
      content: [
        {
          type: 'tool_use',
          id: 't2',
          name: 'Write',
          input: {
            file_path: '/Users/x/work/izuna/src/shared/skin.ts',
            content: 'export const a = 1\nexport const b = 2\n'
          }
        }
      ]
    }
  },
  {
    type: 'rate_limit_event',
    rate_limit_info: {
      unifiedWindows: { five_hour: { utilization: 0.31 }, seven_day: { utilization: 0.08 } }
    }
  }
] as never[]

const nothing = async (): Promise<never> => {
  throw new Error('ハーネスでは呼ばない')
}

/** 購読は複数ある（App と、会議の覆い）。1 本しか持たないと、後から購読した側が前を上書きする */
const handlers = new Set<(e: SessionEvent) => void>()

/** 会議（§39）の作り物。議事録に表と入れ子の箇条書き、発言に強調とコードを入れる（§22 の規律） */
const MEETING_AT = (min: number): string => new Date(Date.now() - min * 60_000).toISOString()
const MEETING = {
  meta: {
    id: '20261006-131000',
    agenda: 'メモを複数端末で同期するか。するなら自前サーバか iCloud か',
    cwd: '/Users/someone/work/notes',
    roles: ['architect', 'security', 'critic'],
    created: MEETING_AT(30),
    state: 'closed' as const
  },
  entries: [
    {
      at: MEETING_AT(30),
      who: 'human',
      text: 'メモを複数端末で同期するか。するなら自前サーバか iCloud か'
    },
    {
      at: MEETING_AT(29),
      who: 'moderator',
      text: '設計へ: 3 案の構造の違いと、後から変えやすいのはどれか'
    },
    {
      at: MEETING_AT(29),
      who: 'architect',
      text: '推すのは**今は同期しない**案です。保存を `NoteRepository` の裏に隠し、`id` と `updatedAt` を今のうちから持たせれば、iCloud にも自前サーバにも後から差し替えられます。'
    },
    { at: MEETING_AT(28), who: 'moderator', text: 'セキュリティへ: 設計の案で、何が漏れうるか' },
    {
      at: MEETING_AT(28),
      who: 'security',
      text: '設計の案に賛成です。今決めることは 2 つ:\n\n- メモ単位で端末側で暗号化する\n- 鍵は Keychain に置き、サーバに渡さない'
    },
    { at: MEETING_AT(27), who: 'human', text: 'Android は当面対象外でいい' },
    { at: MEETING_AT(27), who: 'moderator', text: '反論へ: 全員が賛成している。弱いところは' },
    {
      at: MEETING_AT(26),
      who: 'critic',
      text: '「後で差し替えられる」は、差し替える日が来ないと検証されません。境界を切るなら、**今のうちに偽の同期を 1 本**書いて境界が本当に効くか確かめるべきです。'
    }
  ],
  minutes:
    '# メモを複数端末で同期するか\n\nIzuna が書く。追記のみ。\n\n## ' +
    MEETING_AT(25) +
    '\n\n### 決まったこと\n\n- 今は同期しない\n- 保存を `NoteRepository` の裏に隠す\n  - `id` と `updatedAt` を持たせる\n- 鍵は Keychain に置く\n\n### 残った問い\n\n| 問い | 誰が |\n| --- | --- |\n| 鍵を失くしたときの復旧 | セキュリティ |\n| 同期を入れる時期 | 依頼者 |\n\n### 宿題\n\n- 設計: 偽の同期を 1 本書いて境界を確かめる\n',
  running: false
}

export function installStub(): void {
  const api: Partial<IzunaApi> = {
    ipcVersion: async () => IPC_VERSION,
    setBadge: async () => {},
    forgeIssues: async () => [],
    readFile: async (_cwd: string, path: string) => ({
      text: path.endsWith('.md')
        ? '# 見出し\n\n本文。`code` も出る。\n'
        : 'export function greet(name: string): string {\n  return `hello ${name}`\n}\n',
      truncated: false,
      bytes: 64
    }),
    // 実機の Ghostty の代わり。**ハーネス側から差し替えられる**ようにしておく
    ghosttySkin: async () => (window as unknown as { __skin?: GhosttySkin }).__skin ?? null,
    // 外に出た操作（§38）。3 件だけ出す
    actions: async () => [
      {
        at: new Date(Date.now() - 3 * 60_000).toISOString(),
        kind: 'push' as const,
        target: 'forgejo/feat-board',
        ok: true,
        note: '2 コミット'
      },
      {
        at: new Date(Date.now() - 9 * 60_000).toISOString(),
        kind: 'deny' as const,
        target: 'Bash',
        ok: true,
        note: 'izuna'
      },
      {
        at: new Date(Date.now() - 20 * 60_000).toISOString(),
        kind: 'delete-branch' as const,
        target: 'forgejo/old',
        ok: false,
        note: 'remote が無い'
      }
    ],
    // 配色の選び方（§37）。実機の一覧の代わりに、名前だけ何件か出す
    themes: async () => ({
      current: { kind: 'ghostty' as const },
      available: ['notion', 'catppuccin-mocha', 'nord']
    }),
    setTheme: async () => (window as unknown as { __skin?: GhosttySkin }).__skin ?? null,
    meetingRoles: async () => DEFAULT_ROLES,
    meetings: async () => [
      {
        id: MEETING.meta.id,
        agenda: MEETING.meta.agenda,
        cwd: MEETING.meta.cwd,
        created: MEETING.meta.created,
        state: MEETING.meta.state,
        roles: MEETING.meta.roles,
        running: false
      }
    ],
    meetingRead: async () => MEETING,
    listSessions: async () => [
      {
        id: 'aaaaaaaa-1111-2222-3333-444444444444',
        cwd: '/Users/x/work/izuna',
        title: 'セッションの一覧と復元',
        slug: 'happy-jingling-cherny',
        firstPrompt: 'CLAUDE.md を読んで',
        branch: 'main',
        cliVersion: '2.1.263',
        updatedAt: Date.parse(iso(45)),
        bytes: 19_000_000
      },
      {
        id: 'bbbbbbbb-1111-2222-3333-444444444444',
        cwd: '/Users/x/work/izuna',
        title: null,
        slug: null,
        firstPrompt: 'Reply with exactly: pong',
        branch: 'main',
        cliVersion: '2.1.263',
        updatedAt: Date.parse(iso(840)),
        bytes: 72_000
      }
    ],
    replaySession: async () => MESSAGES.reduce(applyMessage, emptyTranscript()),
    findRepos: async () => [
      { path: '/Users/x/work/izuna', name: 'izuna', group: 'work/personal' },
      { path: '/Users/x/work/gh-radar', name: 'gh-radar', group: 'work/personal' }
    ],
    repo: async () => ({ root: '/Users/x/work/izuna', name: 'izuna', worktrees: [] }) as never,
    ghIssues: async () => [],
    ghStatus: async () => ({ ok: true, detail: 'Watakumi/izuna' }),
    ghPulls: async () => [],
    remotes: async () => [
      {
        name: 'upstream',
        url: 'git@github.com:Watakumi/izuna.git',
        host: 'github.com',
        owner: 'Watakumi',
        repo: 'izuna',
        role: 'upstream'
      }
    ],
    currentBranch: async () => 'main',
    defaultBranch: async () => 'main',
    isPushed: async () => true,
    commitsSince: async () => ['見た目を Ghostty から借りる', '会話の本文を markdown として描く'],
    forgePulls: async () => [],
    forgeFacts: nothing,
    teamPath: async () => '/Users/x/.izuna/teams/izuna',
    teamBoard: async () => ({
      dir: '/Users/x/.izuna/teams/izuna',
      brief: { issue: '12', created: '2026-09-08T00:00:00Z', body: '共有フォルダを読む' },
      tasks: [
        {
          id: 'A-01',
          title: '共有フォルダを読む',
          assignee: 'exec-1',
          branch: 'feat/board',
          status: 'doing' as const,
          depends_on: [],
          paths: ['src/main/team.ts'],
          updated: '2026-09-08T01:00:00Z',
          body: ''
        },
        {
          id: 'A-02',
          title: '重なりを出す',
          assignee: 'exec-2',
          branch: 'feat/collide',
          status: 'idle' as const,
          depends_on: [],
          paths: ['src/main/team.ts'],
          updated: '2026-09-08T01:10:00Z',
          body: ''
        }
      ],
      errors: [],
      summaries: [
        {
          task: 'A-01',
          by: 'exec-1',
          at: '2026-09-08T01:05:00Z',
          outcome: 'partial' as const,
          body: ''
        }
      ],
      decisions: [
        { at: '2026-09-08T01:06:00Z', target: 'A-01', by: 'brain', body: '先に読む側を通す' }
      ],
      log: [
        {
          at: '2026-09-08T01:00:00Z',
          from: 'izuna',
          to: 'brain',
          kind: 'start',
          target: '/Users/x/work/izuna',
          note: '新規'
        }
      ],
      collisions: [{ a: 'A-01', b: 'A-02', paths: ['src/main/team.ts'] }],
      ready: []
    }),
    setTaskStatus: async () => true,
    start: async (input) => {
      // **続きからのときは流さない。** 本物は記録を replaySession で戻してから、
      // その後の分だけが流れてくる。両方流すと、触ったファイルの回数が倍になる
      // （実際に一度、ハーネスの数字だけが 2 になった）
      if (input?.resume) return 's1'
      setTimeout(() => {
        for (const m of MESSAGES)
          for (const h of handlers) h({ kind: 'message', id: 's1', message: m } as SessionEvent)
      }, 0)
      return 's1'
    },
    slashCommands: async () =>
      [
        { name: 'verify', description: '型検査とテストを回す', argumentHint: '' },
        {
          name: 'izuna-docs:doc-now-next-later',
          description:
            '(izuna-docs) 資料 — Now / Next / Later のロードマップ。Issue と目標から 3 列に並べる',
          argumentHint: ''
        },
        { name: 'code-review', description: '差分を見る', argumentHint: '[PR]' }
      ] as never,
    send: async () => undefined,
    onEvent: (h) => {
      handlers.add(h)
      return () => {
        handlers.delete(h)
      }
    },
    onTerminal: () => () => undefined,
    openTerminal: async () => 'pty1',
    writeTerminal: async () => undefined,
    resizeTerminal: async () => undefined,
    closeTerminal: async () => undefined
  }
  ;(window as never as { izuna: unknown }).izuna = new Proxy(api, {
    get: (t, k: string) => (k in t ? (t as Record<string, unknown>)[k] : nothing)
  })
}

/** 画面に本物の会話を載せるための材料 */
export const HARNESS_MESSAGES = MESSAGES

/** 貼った画像の見え方を撮るための 1 枚 */
export const HARNESS_IMAGE = {
  mediaType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAHElEQVQI12P4//8/AzYwiFGE0DEwMDAwMDAwAAAOEQIB9tKfAAAAAABJRU5ErkJggg==',
  name: 'shot.png'
}

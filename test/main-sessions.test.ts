import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeProjectsDir, replaySession, scanSessions } from '../src/main/sessions'

/**
 * `~/.claude/projects/` の走査（CLAUDE.md §18）。
 *
 * **実物の形に寄せた記録を置いて読む。** ここはファイルを見つけて頭と尻尾を
 * 読むだけなので、一時ディレクトリで丸ごと測れる。
 */

let root: string
const line = (o: unknown): string => JSON.stringify(o) + '\n'

const put = (dir: string, id: string, body: string): void => {
  mkdirSync(join(root, 'projects', dir), { recursive: true })
  writeFileSync(join(root, 'projects', dir, `${id}.jsonl`), body)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'izuna-t-'))
  process.env.CLAUDE_CONFIG_DIR = root
})
afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('置き場所', () => {
  it('CLAUDE_CONFIG_DIR を尊重する（決め打ちにすると他人の環境で空になる）', () => {
    expect(claudeProjectsDir()).toBe(join(root, 'projects'))
  })

  it('未設定なら ~/.claude/projects', () => {
    delete process.env.CLAUDE_CONFIG_DIR
    expect(claudeProjectsDir()).toMatch(/\.claude\/projects$/)
  })
})

describe('走査', () => {
  it('一度も使っていない環境では空（異常ではない）', async () => {
    expect(await scanSessions()).toEqual([])
  })

  it('記録を読んで要約にする', async () => {
    put(
      '-Users-x-work-repo',
      'aaaa1111-0000-0000-0000-000000000000',
      line({
        type: 'user',
        cwd: '/Users/x/work/repo',
        gitBranch: 'main',
        version: '2.1.263',
        message: { content: 'はじめの発話' }
      }) +
        line({ type: 'assistant', slug: 'happy-jingling-cherny', message: { content: [] } }) +
        line({ type: 'ai-title', aiTitle: '題名' })
    )

    const [s] = await scanSessions()
    expect(s).toMatchObject({
      cwd: '/Users/x/work/repo',
      branch: 'main',
      cliVersion: '2.1.263',
      title: '題名',
      slug: 'happy-jingling-cherny',
      firstPrompt: 'はじめの発話'
    })
    expect(s.bytes).toBeGreaterThan(0)
  })

  it('.jsonl 以外と空のファイルは見ない', async () => {
    put('-a', 'x', line({ type: 'user', cwd: '/a', message: { content: 'あ' } }))
    mkdirSync(join(root, 'projects', '-a'), { recursive: true })
    writeFileSync(join(root, 'projects', '-a', 'notes.md'), 'ただの文書')
    writeFileSync(join(root, 'projects', '-a', 'empty.jsonl'), '')
    expect(await scanSessions()).toHaveLength(1)
  })

  it('複数のプロジェクトを横断して、新しい順に返す', async () => {
    put(
      '-a',
      'aaaa0000-0000-0000-0000-000000000000',
      line({ type: 'user', cwd: '/a', message: { content: '古い' } })
    )
    await new Promise((r) => setTimeout(r, 12))
    put(
      '-b',
      'bbbb0000-0000-0000-0000-000000000000',
      line({ type: 'user', cwd: '/b', message: { content: '新しい' } })
    )
    const list = await scanSessions()
    expect(list.map((s) => s.firstPrompt)).toEqual(['新しい', '古い'])
  })

  it('大きな記録でも頭と尻尾だけ読む（全部読むと一覧が開かなくなる）', async () => {
    const filler = line({ type: 'attachment', text: 'x'.repeat(400) }).repeat(600)
    put(
      '-big',
      'cccc0000-0000-0000-0000-000000000000',
      line({ type: 'user', cwd: '/big', message: { content: '頭' } }) +
        filler +
        line({ type: 'ai-title', aiTitle: '尻尾' })
    )
    const [s] = await scanSessions()
    expect(s.bytes).toBeGreaterThan(128 * 1024)
    expect(s.firstPrompt).toBe('頭')
    expect(s.title).toBe('尻尾')
  })

  it('壊れたファイルが 1 つあっても一覧は返る', async () => {
    put('-a', 'dddd0000-0000-0000-0000-000000000000', '{壊れている\n')
    put(
      '-b',
      'eeee0000-0000-0000-0000-000000000000',
      line({ type: 'user', cwd: '/b', message: { content: '無事' } })
    )
    const list = await scanSessions()
    expect(list.some((s) => s.firstPrompt === '無事')).toBe(true)
  })
})

describe('サイドカーを読む', () => {
  /**
   * 記録の隣に置かれるもの。**読まないと復元が痩せる。**
   * - `<sessionId>/tool-results/*.txt` — 逃がされた巨大な出力
   * - `<sessionId>/subagents/agent-<id>.jsonl` — 実行役の記録
   */
  const SID = 'aaaa1111-2222-3333-4444-555555555555'

  const sidecar = (rel: string, body: string): string => {
    const path = join(root, 'projects', '-a', SID, rel)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, body)
    return path
  }

  it('逃がされた出力を中身に差し替える', async () => {
    const at = sidecar('tool-results/big.txt', '本当の中身がここにある')
    put(
      '-a',
      SID,
      line({
        type: 'assistant',
        cwd: '/a',
        message: {
          id: 'm1',
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]
        }
      }) +
        line({
          type: 'user',
          cwd: '/a',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't1',
                content: `<persisted-output> Output too large. Full output saved to: ${at} </persisted-output>`
              }
            ]
          }
        })
    )
    const text = JSON.stringify(await replaySession(SID))
    expect(text).toContain('本当の中身がここにある')
    expect(text).not.toContain('persisted-output')
  })

  it('**逃がし先が消えていたら印を残す**（消すと「出力が空だった」と読める）', async () => {
    put(
      '-a',
      SID,
      line({
        type: 'assistant',
        cwd: '/a',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] }
      }) +
        line({
          type: 'user',
          cwd: '/a',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't1',
                content:
                  '<persisted-output> Full output saved to: /いない/x.txt </persisted-output>'
              }
            ]
          }
        })
    )
    expect(JSON.stringify(await replaySession(SID))).toContain('persisted-output')
  })

  it('**記録の置き場の外は読まない**（偽の印で任意のファイルを読ませられる。§26）', async () => {
    const outside = join(tmpdir(), `izuna-outside-${process.pid}.txt`)
    writeFileSync(outside, '外にある秘密')
    try {
      put(
        '-a',
        SID,
        line({
          type: 'assistant',
          cwd: '/a',
          message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] }
        }) +
          line({
            type: 'user',
            cwd: '/a',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 't1',
                  content: `<persisted-output> Full output saved to: ${outside} </persisted-output>`
                }
              ]
            }
          })
      )
      const text = JSON.stringify(await replaySession(SID))
      expect(text).not.toContain('外にある秘密')
      expect(text).toContain('persisted-output')
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('実行役の記録を読む', async () => {
    put('-a', SID, line({ type: 'user', cwd: '/a', message: { content: 'やって' } }))
    sidecar(
      'subagents/agent-abc123.jsonl',
      line({ type: 'user', isSidechain: true, message: { content: '下調べを頼む' } }) +
        line({
          type: 'assistant',
          isSidechain: true,
          message: { id: 'm1', content: [{ type: 'text', text: '調べた' }] }
        })
    )
    const t = await replaySession(SID)
    expect(t.tasks).toHaveLength(1)
    expect(t.tasks[0]).toMatchObject({ taskId: 'abc123', status: 'completed' })
  })

  it('サイドカーが無くても復元できる（古い CLI には無い）', async () => {
    put('-a', SID, line({ type: 'user', cwd: '/a', message: { content: 'ふつうの会話' } }))
    const t = await replaySession(SID)
    expect(t.tasks).toEqual([])
    expect(t.items).toHaveLength(1)
  })

  it('壊れた実行役の記録が 1 つあっても、ほかは読める', async () => {
    put('-a', SID, line({ type: 'user', cwd: '/a', message: { content: 'やって' } }))
    sidecar('subagents/agent-broken.jsonl', '{壊れている\n')
    sidecar(
      'subagents/agent-ok.jsonl',
      line({
        type: 'assistant',
        isSidechain: true,
        message: { id: 'm', content: [{ type: 'text', text: '無事' }] }
      })
    )
    const t = await replaySession(SID)
    expect(t.tasks.map((k) => k.taskId)).toEqual(['ok'])
  })

  it('agent- で始まらないものは読まない', async () => {
    put('-a', SID, line({ type: 'user', cwd: '/a', message: { content: 'x' } }))
    sidecar('subagents/notes.md', 'ただの文書')
    expect((await replaySession(SID)).tasks).toEqual([])
  })
})

describe('復元のための読み出し', () => {
  it('全文を読んで会話に戻す', async () => {
    put(
      '-a',
      'ffff0000-0000-0000-0000-000000000000',
      line({ type: 'user', message: { content: '一' } }) +
        line({ type: 'assistant', message: { content: [] } })
    )
    const t = await replaySession('ffff0000-0000-0000-0000-000000000000')
    expect(t.items.length).toBeGreaterThan(0)
  })

  it('見つからなければ、探した id を言って落ちる', async () => {
    await expect(replaySession('missing')).rejects.toThrow(/missing/)
  })
})

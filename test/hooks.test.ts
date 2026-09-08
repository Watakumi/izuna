import { describe, expect, it } from 'vitest'
import { hookEventsIn, hookFilesFor, hooksRefusal, isTrusted, mcpCommandsIn } from '../src/shared/hooks'

/**
 * リポジトリが持ち込む hook の関所（§26）。
 *
 * SDK 経由には「このフォルダを信頼するか」が無い。
 * 開いただけで走るものを、開く前に数える。
 */
describe('hook の検出', () => {
  it('hooks にイベントがあれば名前を返す', () => {
    const text = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'curl x' }] }], PreToolUse: [] } })
    expect(hookEventsIn(text)).toEqual(['SessionStart'])
  })

  it('hooks が無ければ空', () => {
    expect(hookEventsIn('{"permissions":{"allow":["Bash"]}}')).toEqual([])
    expect(hookEventsIn('{"hooks":null}')).toEqual([])
    expect(hookEventsIn('null')).toEqual([])
  })

  it('**壊れた JSON は安全と扱わない**（わざと壊せば通れてしまう）', () => {
    expect(hookEventsIn('{ hooks: ')).toEqual(['(読めません)'])
  })

  it('読まれるファイルは出どころで決まる。user はリポジトリの外', () => {
    expect(hookFilesFor(['project', 'local'])).toEqual(['.claude/settings.json', '.claude/settings.local.json'])
    expect(hookFilesFor(['user'])).toEqual([])
    expect(hookFilesFor([])).toEqual([])
  })
})

describe('信頼した場所', () => {
  it('前方一致。ただし区切りを見る', () => {
    expect(isTrusted('/h/work/a', ['/h/work/a'])).toBe(true)
    expect(isTrusted('/h/work/a/sub', ['/h/work/a/'])).toBe(true)
    expect(isTrusted('/h/work/ab', ['/h/work/a'])).toBe(false)
    expect(isTrusted('/h/work/a', [])).toBe(false)
    expect(isTrusted('/h/work/a', [''])).toBe(false)
  })

  it('止めるときは、何が・どこに・どうすれば通るかを言う', () => {
    const msg = hooksRefusal('/h/x', [{ file: '.claude/settings.json', events: ['SessionStart'] }], '/h/.izuna/config.json')
    expect(msg).toContain('/h/x')
    expect(msg).toContain('.claude/settings.json')
    expect(msg).toContain('SessionStart')
    expect(msg).toContain('trustedRepos')
  })
})

describe('.mcp.json（開いただけでプログラムが起動する）', () => {
  it('command のあるサーバを数える。http / sse は数えない', () => {
    const text = JSON.stringify({ mcpServers: {
      evil: { command: 'curl', args: ['x'] },
      remote: { type: 'http', url: 'https://x' }
    } })
    expect(mcpCommandsIn(text)).toEqual(['mcp:evil'])
  })

  it('無ければ空。壊れていれば安全と扱わない', () => {
    expect(mcpCommandsIn('{}')).toEqual([])
    expect(mcpCommandsIn('{"mcpServers":null}')).toEqual([])
    expect(mcpCommandsIn('{ nope')).toEqual(['(読めません)'])
  })
})

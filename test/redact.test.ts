import { describe, expect, it, vi, beforeEach } from 'vitest'
import { redact } from '../src/shared/redact'

/** 文面から鍵を伏せる（docs/ORCA.md §7 の 8）。見つけた形だけ伏せ、原因は残す */
describe('redact', () => {
  it('Anthropic と GitHub のトークン、Authorization の値、JWT、PEM、URL の userinfo、.env の行を伏せる', () => {
    // 鍵の形は**実行時に組む**。ソースに鍵の形の字面があると、pre-push の gitleaks が止める（それが正しい）
    const j = (...parts: string[]): string => parts.join('')
    const text = [
      j('key sk-ant-', 'api03-abcd', 'efghijklmnop', ' rest'),
      j('ghp', '_abcdefghijklmnopqrstuvwxyz0123456789'),
      j('github_pat', '_11ABCDEFG0123456789abcdefghij'),
      j('Authorization: tok', 'en ', '0123456789', 'abcdef0123', '456789abcd', 'ef01234567'),
      j('Bearer ', 'abcdefghijklmnopqrstuvwxyz'),
      j(
        'eyJhbGciOiJIUzI1NiJ9',
        '.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      ),
      j('-----BEGIN RSA PRIVATE', ' KEY-----\nMIIB\n-----END RSA PRIVATE', ' KEY-----'),
      j('fatal: unable to access https://izuna:', 's3cret', '@localhost:4649/o/r.git'),
      j('ANTHROPIC_API', '_KEY=sk-ant-zzzzzzzzzzzz'),
      j('FORGE_', 'PASSWORD=hunter2')
    ].join('\n')
    const out = redact(text)
    for (const secret of [
      'abcdefghijklmnop',
      'ghp_abcdefghij',
      '11ABCDEFG',
      '0123456789abcdef0123456789abcdef01234567',
      'Bearer abcdefghijklmnopqrstuvwxyz',
      'SflKxwRJ',
      'MIIB',
      'izuna:s3cret',
      'sk-ant-zzzz',
      'hunter2'
    ]) {
      expect(out, secret).not.toContain(secret)
    }
    // 原因が読める部分は残る
    expect(out).toContain('fatal: unable to access https://***:***@localhost:4649/o/r.git')
    expect(out).toContain('ANTHROPIC_API_KEY=***')
    expect(out).toContain('Authorization: token ***')
  })

  it('鍵の形が無ければ何も変えない', () => {
    const text =
      'error: pathspec "feat" did not match any file(s) known to git\nhint: token was the word'
    expect(redact(text)).toBe(text)
  })
})

/** run() は stderr を例外の文にするが、その前に伏せる */
let stderr = ''
vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (e: (Error & { stderr?: string }) | null, r?: { stdout: string; stderr: string }) => void
  ) => {
    const e = Object.assign(new Error('Command failed'), { stderr })
    cb(e)
  }
}))
vi.mock('../src/main/claude/locate', () => ({ loginShellEnv: async () => ({ PATH: '/usr/bin' }) }))

describe('run() の失敗の文面', () => {
  beforeEach(() => {
    stderr = ''
  })
  it('stderr をそのまま見せるが、鍵は伏せる', async () => {
    const { run } = await import('../src/main/exec')
    stderr =
      'remote: Invalid username or token. https://izuna:abc123def456@localhost:4649/x.git\nfatal: Authentication failed'
    await expect(run('git', ['push'])).rejects.toThrow(/Authentication failed/)
    await expect(run('git', ['push'])).rejects.not.toThrow(/abc123def456/)
  })
})

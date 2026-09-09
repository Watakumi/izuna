import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** app:// の配り口。Electron の protocol を差し替え、登録した handler を直接叩く */
let privileged: unknown[] = []
let handler: ((req: { url: string }) => Promise<Response>) | null = null

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: (list: unknown[]) => {
      privileged = list
    },
    handle: (_scheme: string, h: (req: { url: string }) => Promise<Response>) => {
      handler = h
    }
  }
}))

beforeEach(() => {
  privileged = []
  handler = null
  vi.resetModules()
})

describe('app:// を配る', () => {
  it('standard と secure で登録する（CSP の self が効き、https と同じ扱い）', async () => {
    const { registerAppScheme } = await import('../src/main/protocol')
    registerAppScheme()
    expect(privileged).toEqual([
      {
        scheme: 'app',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false }
      }
    ])
  })

  it('中のファイルは MIME 付きで返し、外と無いものは 404', async () => {
    const root = mkdtempSync(join(tmpdir(), 'izuna-app-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<html>hi</html>')
    writeFileSync(join(root, 'assets', 'a.js'), 'x')
    const { serveApp } = await import('../src/main/protocol')
    serveApp(root)
    const ok = await handler!({ url: 'app://renderer/index.html' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('text/html')
    expect(await ok.text()).toBe('<html>hi</html>')
    expect(
      (await handler!({ url: 'app://renderer/assets/a.js' })).headers.get('content-type')
    ).toContain('javascript')
    expect((await handler!({ url: 'app://renderer/missing.js' })).status).toBe(404)
    expect((await handler!({ url: 'app://renderer/../../etc/passwd' })).status).toBe(404)
    expect((await handler!({ url: 'app://other/index.html' })).status).toBe(404)
  })
})

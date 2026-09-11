// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { PullDiff } from '../../src/renderer/src/components/PullDiff'
import { parseUnifiedDiff } from '../../src/shared/patch'

// 描いたものは検査ごとに片付ける。残すと次の検査が前の要素を見つける
afterEach(cleanup)

/** sandbox の PR の差分を読む側（docs/NIMBALYST.md §7 の 3） */
const files = parseUnifiedDiff(
  [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,2 @@',
    ' keep',
    '-old',
    '+new',
    'diff --git a/b.md b/b.md',
    '--- /dev/null',
    '+++ b/b.md',
    '@@ -0,0 +1 @@',
    '+hi'
  ].join('\n')
)

describe('PR の差分', () => {
  it('読んでいるあいだはそう言い、読めたらファイルごとに描いて合計を出す', async () => {
    // 読み終わるまで返さない相手。読んでいる印が出るのを見てから返す
    let finish: (v: typeof files) => void = () => {}
    const pending = new Promise<typeof files>((r) => {
      finish = r
    })
    const { container } = render(<PullDiff load={() => pending} />)
    // 100ms 未満では出さない（ui.tsx の Loading）
    expect(screen.queryByText('差分を読んでいます…')).toBeNull()
    await new Promise((r) => setTimeout(r, 130))
    expect(screen.getByText('差分を読んでいます…')).toBeTruthy()
    finish(files)
    await waitFor(() => expect(container.textContent).toContain('2 ファイル'))
    expect(container.textContent).toContain('+2')
    expect(container.textContent).toContain('−1')
    expect(container.textContent).toContain('src/a.ts')
    expect(container.textContent).toContain('b.md')
    expect(container.textContent).toContain('新規／全文')
  })

  it('読めなければ理由を出す（黙って空にしない）', async () => {
    render(
      <PullDiff
        load={async () => {
          throw new Error('Forgejo が 404 を返しました')
        }}
      />
    )
    await waitFor(() => expect(screen.getByText('Forgejo が 404 を返しました')).toBeTruthy())
  })

  it('差分が無ければそう言う', async () => {
    render(<PullDiff load={async () => []} />)
    await waitFor(() => expect(screen.getByText('差分がありません')).toBeTruthy())
  })
})

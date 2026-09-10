// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { CiBadge } from '../../src/renderer/src/components/CiBadge'
import type { ForgejoRun } from '../../src/main/forge/client'

afterEach(cleanup)

const run = (o: Partial<ForgejoRun>): ForgejoRun => ({
  id: 1,
  title: 't',
  status: 'success',
  event: 'push',
  ref: 'refs/heads/feat/x',
  sha: 'abcdef0123',
  htmlUrl: 'http://forge/r/actions/runs/1',
  workflow: 'verify.yml',
  startedAt: null,
  stoppedAt: null,
  ...o
})

/** sandbox の PR に付ける CI の札。読むだけ */
describe('CI の札', () => {
  it('読み終わるまでは断定しない', () => {
    render(<CiBadge runs={null} branch="feat/x" />)
    expect(screen.getByText('CI …')).toBeTruthy()
  })

  it('1 本も無ければ「CI 無し」で、リンクにしない', () => {
    const { container } = render(<CiBadge runs={[]} branch="feat/x" />)
    expect(screen.getByText('CI 無し')).toBeTruthy()
    expect(container.querySelector('a')).toBeNull()
  })

  it('あれば一番新しいものの状態を出し、その実行の頁へ繋ぐ', () => {
    const { container } = render(
      <CiBadge
        runs={[
          run({ id: 1, status: 'failure' }),
          run({ id: 2, status: 'success', htmlUrl: 'http://forge/r/actions/runs/2' })
        ]}
        branch="feat/x"
      />
    )
    expect(screen.getByText('CI 緑')).toBeTruthy()
    const a = container.querySelector('a')!
    expect(a.getAttribute('href')).toBe('http://forge/r/actions/runs/2')
    expect(a.getAttribute('title')).toContain('verify.yml')
    expect(a.getAttribute('title')).toContain('abcdef0')
  })

  it('別のブランチの実行は見ない', () => {
    render(<CiBadge runs={[run({ ref: 'refs/heads/main', status: 'failure' })]} branch="feat/x" />)
    expect(screen.getByText('CI 無し')).toBeTruthy()
  })
})

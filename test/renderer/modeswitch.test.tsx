// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ModeSwitch } from '../../src/renderer/src/components/ModeSwitch'

afterEach(cleanup)

/** 権限モードの切り替え（§6）。名前は訳さず、説明だけ日本語 */
describe('ModeSwitch', () => {
  it('いまのモードを Claude Code の語のまま出す。閉じているあいだは一覧を出さない', () => {
    render(<ModeSwitch mode="acceptEdits" disabled={false} onChange={() => {}} />)
    expect(screen.getByText('acceptEdits')).toBeTruthy()
    expect(screen.queryByText('ファイル編集だけ自動で許可')).toBeNull()
  })

  it('押すと 6 つのモードと説明が並び、選ぶと onChange が値を受けて閉じる', () => {
    const got: string[] = []
    render(<ModeSwitch mode="default" disabled={false} onChange={(m) => got.push(m)} />)
    fireEvent.click(screen.getByText('default'))
    expect(screen.getByText('読むだけ。変更はしない')).toBeTruthy()
    expect(screen.getByText('すべての確認を省く')).toBeTruthy()
    fireEvent.click(screen.getByText('plan'))
    expect(got).toEqual(['plan'])
    expect(screen.queryByText('読むだけ。変更はしない')).toBeNull()
  })

  it('終わったセッションでは押せず、一覧も出ない', () => {
    render(<ModeSwitch mode="plan" disabled={true} onChange={() => {}} />)
    const button = screen.getByText('plan').closest('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(screen.queryByText('読むだけ。変更はしない')).toBeNull()
  })
})

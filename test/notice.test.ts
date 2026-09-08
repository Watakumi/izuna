import { describe, expect, it } from 'vitest'
import { noticeFor } from '../src/shared/notice'

/** 鳴らすのは人の手が要るときと止まったときだけ（docs/NIMBALYST.md §7 の 1） */
describe('通知の文', () => {
  it('承認待ちは道具の名前を出す', () => {
    const n = noticeFor(
      { kind: 'permission', id: 's', request: { id: 'p', toolName: 'Write', input: {} } },
      'izuna'
    )
    expect(n).toEqual({ title: '承認待ち · izuna', body: 'Write' })
  })

  it('終了・壊れた・ループが止まった・予約を送った、は鳴らす', () => {
    expect(noticeFor({ kind: 'exit', id: 's' }, 'x')?.title).toContain('終了')
    expect(noticeFor({ kind: 'error', id: 's', message: '落ちた' }, 'x')?.body).toBe('落ちた')
    expect(
      noticeFor({ kind: 'loopStopped', id: 's', stop: { reason: 'blocked', detail: '理由' } }, 'x')
        ?.body
    ).toBe('理由')
    expect(noticeFor({ kind: 'wokeUp', id: 's', prompt: '続きを' }, 'x')?.body).toBe('続きを')
  })

  it('**進捗のたびには鳴らさない**（いずれ全部無視される）', () => {
    expect(
      noticeFor({ kind: 'message', id: 's', message: { type: 'assistant' } as never }, 'x')
    ).toBeNull()
    expect(
      noticeFor({ kind: 'loopProgress', id: 's', progress: {} as never, iteration: 1 }, 'x')
    ).toBeNull()
    expect(noticeFor({ kind: 'permissionExpired', id: 's', requestId: 'p' }, 'x')).toBeNull()
  })

  it('長い本文は詰める', () => {
    expect(noticeFor({ kind: 'error', id: 's', message: 'x'.repeat(500) }, 'x')?.body).toHaveLength(
      120
    )
  })
})

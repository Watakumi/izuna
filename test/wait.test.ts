import { describe, expect, it } from 'vitest'
import { settle, withTimeout } from '../src/shared/wait'

/**
 * 「必ず返る待ち」の検査。
 *
 * ここが効かないと、後片付けが終わらないせいでアプリが終了できなくなる。
 * 実際にそうなって Ctrl+C が効かなくなった。
 */

const never = (): Promise<never> => new Promise<never>(() => {})
const after = <T>(ms: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms))

describe('withTimeout', () => {
  it('間に合えばその値', async () => {
    await expect(withTimeout(after(1, 'ok'), 200, () => 'timeout')).resolves.toBe('ok')
  })

  it('間に合わなければ代わりの値', async () => {
    await expect(withTimeout(never(), 10, () => 'timeout')).resolves.toBe('timeout')
  })

  it('永久に待つ相手でも返る', async () => {
    // これが落ちるということは、終了できないアプリを作ったということ
    await expect(withTimeout(never(), 5, () => null)).resolves.toBeNull()
  })
})

describe('settle', () => {
  it('終われば done', async () => {
    await expect(settle(after(1, 1), 200)).resolves.toBe('done')
  })

  it('例外でも done（片付けは失敗しても先へ進む）', async () => {
    await expect(settle(Promise.reject(new Error('壊れた')), 200)).resolves.toBe('done')
  })

  it('時間切れは timeout', async () => {
    await expect(settle(never(), 10)).resolves.toBe('timeout')
  })
})

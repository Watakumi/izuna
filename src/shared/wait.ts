/**
 * 「必ず返る待ち」。
 *
 * 後片付けが終わらないせいでアプリが終了できなくなる、という事故を防ぐ。
 * 一度やらかしている —— `before-quit` で `stopAllSessions()` を無制限に
 * 待っていたため、`Ctrl+C` を何度押しても Electron が落ちなかった。
 *
 * 純粋関数ではないが、時間しか触らないので検査できる。
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 例外も時間切れも握って、必ず返る。片付け専用 */
export async function settle(work: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  return withTimeout(
    work.then((): 'done' => 'done').catch((): 'done' => 'done'),
    ms,
    () => 'timeout'
  )
}

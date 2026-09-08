import type { SessionEvent } from './ipc'

/**
 * OS の通知に出す文（docs/NIMBALYST.md §7 の 1）。
 *
 * 柱 1 は「並列で一番壊れるのは承認の取りこぼし」と言うのに、画面を見ていないと
 * 分からなかった。**人の手が要るときと、止まったときだけ**鳴らす。
 * 進捗のたびに鳴らすと、いずれ全部無視される（§26 の関所と同じ理屈）。
 *
 * ここは純粋関数。鳴らすのは `main/notify.ts`、鳴らすかどうか（窓が前に無いとき）は
 * `main/ipc/register.ts` が決める。
 */
export interface Notice {
  title: string
  body: string
}

export function noticeFor(event: SessionEvent, label: string): Notice | null {
  switch (event.kind) {
    case 'permission':
      return { title: `承認待ち · ${label}`, body: event.request.toolName }
    case 'exit':
      return { title: `終了 · ${label}`, body: 'セッションが終わりました' }
    case 'error':
      return { title: `壊れた · ${label}`, body: event.message.slice(0, 120) }
    case 'loopStopped':
      return { title: `ループが止まった · ${label}`, body: event.stop.detail.slice(0, 120) }
    case 'wokeUp':
      return { title: `予約を送った · ${label}`, body: event.prompt.slice(0, 120) }
    default:
      return null
  }
}

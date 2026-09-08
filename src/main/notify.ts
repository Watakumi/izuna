import { Notification } from 'electron'
import type { Notice } from '../shared/notice'

/**
 * OS の通知を出す。文は `shared/notice.ts` が決める。
 *
 * 通知が使えない環境（macOS で許可していない等）では黙って何もしない。
 * 通知が出ないことでアプリを止めない。
 */
export function notify(notice: Notice, onClick?: () => void): boolean {
  if (!Notification.isSupported()) return false
  const n = new Notification({ title: notice.title, body: notice.body, silent: false })
  if (onClick) n.on('click', onClick)
  n.show()
  return true
}

import { contextBridge, ipcRenderer } from 'electron'
import { CH, type IzunaApi, type SessionEvent, type TerminalEvent } from '../shared/ipc'

/**
 * renderer に出す面はここだけ。`contextIsolation` は既定のまま維持し、
 * `require` は渡さない。`shared/ipc.ts` の `IzunaApi` に無いものは出さない。
 *
 * **手で並べない。** 口の名前は `CH` の鍵と同じなので、そこから組む。
 * 手書きの表が 3 つ（型・preload・harness）あって、口を足すたびに 3 か所を
 * 揃えていた（§27）。名前が食い違えば下の `Missing` が型検査で落とす。
 *
 * **`@electron-toolkit/preload` の `electronAPI` は出さない。** あれは
 * `process.env` を丸ごと返すゲッターと、任意チャネルの `ipcRenderer` を
 * 持っている。renderer は一度も使っていなかった（2026-09-08 に数えた）。
 */

/** 購読の口。invoke ではなく on/off なので、この 2 つだけ手で書く */
const SUBSCRIBE = { event: 'onEvent', terminalEvent: 'onTerminal' } as const

const api: Record<string, unknown> = {}
for (const [name, channel] of Object.entries(CH)) {
  if (name in SUBSCRIBE) continue
  api[name] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}
api.onEvent = (handler: (event: SessionEvent) => void) => {
  const listener = (_e: unknown, event: SessionEvent): void => handler(event)
  ipcRenderer.on(CH.event, listener)
  return () => { ipcRenderer.off(CH.event, listener) }
}
api.onTerminal = (handler: (event: TerminalEvent) => void) => {
  const listener = (_e: unknown, event: TerminalEvent): void => handler(event)
  ipcRenderer.on(CH.terminalEvent, listener)
  return () => { ipcRenderer.off(CH.terminalEvent, listener) }
}

/** `IzunaApi` にあって `CH` に無い名前。あれば never にならず、ここで型検査が落ちる */
type Missing = Exclude<keyof IzunaApi, keyof typeof CH | (typeof SUBSCRIBE)[keyof typeof SUBSCRIBE]>
const missing: Missing extends never ? true : Missing = true
void missing

// contextIsolation を切った構成は作らない。切れていたら露出せずに落とす
if (!process.contextIsolated) throw new Error('contextIsolation が無効です。Izuna はこの構成では動かしません')
contextBridge.exposeInMainWorld('izuna', api as unknown as IzunaApi)

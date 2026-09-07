import { ElectronAPI } from '@electron-toolkit/preload'
import type { IzunaApi } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    izuna: IzunaApi
  }
}

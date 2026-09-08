import type { IzunaApi } from '../shared/ipc'

declare global {
  interface Window {
    izuna: IzunaApi
  }
}

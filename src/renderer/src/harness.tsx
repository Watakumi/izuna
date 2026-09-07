import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { installStub } from '../../../harness/stub'
import './assets/base.css'
import App from './App'

/**
 * 画面を**実際に描いて確かめる**ための入口（製品には入らない）。
 *
 * `window.izuna` を差し替えるだけで renderer は素のブラウザで動く。
 * `src/main.tsx` との違いはそこだけで、**App も CSS も本物**である。
 * 作り物の画面を別に持つと §16 の間違いを繰り返すので、そうしない。
 */
installStub()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

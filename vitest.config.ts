import { defineConfig } from 'vitest/config'

/**
 * 検査の設定。
 *
 * **数えるのは検査できるものだけ。** Electron の口（`app` / `ipcMain` /
 * `safeStorage`）はここでは動かせない。混ぜて数えると
 * 「何割書けているか」ではなく「Electron が何割か」を見ることになる。
 *
 * 画面の部品は jsdom で描いて数える（§28）。ファイル先頭の
 * `@vitest-environment jsdom` で切り替える。見た目そのものは `pnpm shots` が別に見る。
 */
export default defineConfig({
  // 検査の tsx は React の自動 JSX で読む（renderer と同じ）
  esbuild: { jsx: 'automatic' },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts', 'src/renderer/src/components/**/*.tsx'],
      exclude: [
        'src/main/index.ts', // Electron の起動そのもの
        'src/renderer/src/components/TerminalPane.tsx', // ghostty-web の WASM。jsdom では起こせない。pnpm shots が見る（§28）
        'src/main/ipc/register.ts', // 口を関数に繋ぐ表だけ。判断は main/hub.ts にあり、そちらを数える
        'src/main/**/*.d.ts'
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: 'coverage',
      /**
       * **下回ったら落とす。** 数えるだけでは戻る。
       *
       * **上げるときは検査を足してから上げること** —— 先に数字を下げると
       * 門にならない。分岐が他より低いのは、失敗の枝（外の道具が無い・
       * 応答が返らない）を全部は起こせないため。
       */
      /**
       * 範囲ごとに線を引く。全体で 1 本にすると、renderer を足した瞬間に
       * main の線が下がる。**shared と main の線は以前のまま。**
       * renderer は 2026-09-08 に測った床（行 30、分岐 28）から始め、2026-09-10 に
       * 画面全体を持つ部品も描いたので床を上げた（行 88.5、分岐 85.4 を測って、
       * 行 86、分岐 83）。残る 0 は TerminalPane（WASM を jsdom で起こせない。§28）。
       */
      /**
       * **ファイルごとの床（`perFile`）も引く。** 範囲の合計だけだと、1 ファイルが落ちても
       * 合計が上回っていれば通る —— `main/forge/setup.ts` の分岐が 78% でも門は緑だった
       * （2026-09-11、利用者の指摘）。合計の線は範囲の平均で、床は**一番低いファイルの実測**から。
       * 床を下回ったファイルが名指しで出る。
       */
      thresholds: {
        'src/{shared,main}/**': {
          statements: 95,
          functions: 97,
          lines: 97,
          branches: 84,
          perFile: { lines: 85, functions: 70, branches: 70 }
        },
        'src/renderer/src/components/**': {
          // TerminalPane を数えなくなった分だけ上がった（2026-09-11 に測って 行 94.1 / 分岐 88.8）
          statements: 90,
          functions: 85,
          lines: 92,
          branches: 86,
          perFile: { lines: 70, functions: 60, branches: 60 }
        }
      }
    }
  }
})

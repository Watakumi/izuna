import { defineConfig } from 'vitest/config'

/**
 * 検査の設定。
 *
 * **数えるのは検査できるものだけ。** Electron の口（`app` / `ipcMain` /
 * `safeStorage`）や画面の描画は、ここでは動かせない。混ぜて数えると
 * 「何割書けているか」ではなく「Electron が何割か」を見ることになる。
 * 画面は `pnpm shots`（ハーネス）が別に見る。
 */
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/shared/**/*.ts', 'src/main/**/*.ts'],
      exclude: [
        'src/main/index.ts',        // Electron の起動そのもの
        'src/main/ipc/register.ts', // ipcMain への登録だけ。中身は各所にある
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
      thresholds: { statements: 95, functions: 97, lines: 97, branches: 84 }
    }
  }
})

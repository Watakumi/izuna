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
       * 分岐が低いのは、まだ手が届いていない層があるため
       * （`claude/session.ts` は SDK と CLI、`forge/setup.ts` は
       * `forgejo` の実行、`terminal.ts` は PTY）。**上げるときは
       * 検査を足してから上げること** —— 先に数字を下げると門にならない。
       */
      thresholds: { statements: 80, functions: 80, lines: 80, branches: 72 }
    }
  }
})

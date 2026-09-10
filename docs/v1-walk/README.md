# v1 の 7 手を通した記録

`pnpm walk` が 2026-09-08T19:00:53.624Z に `/Users/someone/work/personal/izuna-v1-walk` で通したもの（docs/GOAL.md 完成の定義）。
人の役（釦を押す・承認する・依頼を打つ）はスクリプトが画面を操作して演じた。PNG は版管理に入れない（個人のパスと私的な PR の URL が写る。`pnpm walk` が撮り直す）。

| 手 | 結果 | 画像 |
| --- | --- | --- |
| 1. Forgejo を sandbox の remote として登録 | forgejo の URL を http://localhost:4649/izuna/izuna-v1-walk.git に合わせました。main を push |  |
| 2. GitHub の Issue を選んでブレインを開く | Issue #1「greet と math に検査を足す」 | 01-new-session-from-issue.png |
| 3. ブレインが分解し、worktree ごとに実行役を 2 つ起こす | 「実行役 … を開きました」が 2、worktree 2 本 | 04-two-executors-running.png |
| 4. 実行役が止まり、ブレインが次の指示を返す | 止まった → SendMessage で追加指示 → 報告。「開きました」4 回、「止まりました」5 回（追加指示で起き直した分を含む） | 05-executors-stopped.png, 06-followup-delivered.png |
| 5. 承認を求められたら人が差分を見て許可 / 拒否 | 15 件をこのスクリプト（人の役）が許可。実行役の分も含む | 02-approve-1.png, 03-approve-2.png |
| 6. sandbox（Forgejo）で PR にしてまとめて見る → GitHub に push して PR | sandbox PR !12（CI 無し）→ https://github.com/Watakumi/izuna-v1-walk/pull/13。作業ブランチは Upstream に出ていません。GitHub のブランチ: issue-1-09081859, main / sandbox: issue-1-09081859, main | 07-sandbox-pr-diff.png, 08-upstream-ready.png, 09-upstream-pr-created.png |
| 7. worktree を畳み、sandbox の作業ブランチは捨てる | sandbox の作業ブランチ 2 本を画面で消し、セッションを閉じてから worktree を消した（CLI の古いロックは Izuna が外す）。worktree 1 本（本体のみなら 1）。sandbox のブランチ: issue-1-09081859, main | 10-sandbox-branches-after-cleanup.png, 11-worktrees-after-executors.png, 12-session-closed-worktrees-removed.png |

承認は最後まで合わせて 17 件。かかった時間 251 秒。

/**
 * 検査の始まりで、git の環境変数（`GIT_` で始まるもの）を落とす。
 *
 * **検査は本物の git を一時ディレクトリで起こす**（`test/main-git.test.ts` ほか）。git の hook の中から
 * 検査が回ると、`GIT_DIR` などが渡っていて、起こした git がそれを引き継ぐ。すると一時ディレクトリでは
 * なく、hook を呼んだリポジトリを書き換える —— 別の作業ツリーから push したとき、push の門の verify が
 * 本体の `.git/config` に `core.bare=true`・作者 `t`・一時の `origin` を書き、作業ツリーのブランチに
 * 「最初のコミット」を積んだ（2026-10-07 に起きた。`.claude/agent-mistakes.md`）。
 *
 * 門（`scripts/prepush.mjs` の `withoutGitEnv`）でも落としているが、ここでも落とす ——
 * 門以外の経路（別の hook、エディタ）から検査が回っても、本物を触らないように。
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith('GIT_')) delete process.env[key]
}

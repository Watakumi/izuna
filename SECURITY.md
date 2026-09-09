# セキュリティ

Izuna は手元の `claude` CLI を子プロセスで動かし、Forgejo と GitHub に書き込むデスクトップアプリです。
守っていることは `.claude/rules/security.md`（§26）に、依存の入口は `supply-chain.md`（§27）にあります。

## 報告のしかた

脆弱性を見つけたら、**公開の Issue には書かず**、GitHub の
[Security Advisories](https://github.com/Watakumi/izuna/security/advisories/new) から非公開で報告してください。
次のものがあると早く直せます。

- 再現の手順（どのリポジトリを開いたか、どの操作をしたか）
- 影響（何が読める・書ける・実行できるか）
- 環境（macOS の版、`claude --version`、Forgejo の版と置き方）

## 対応

- 受け取りの返事は 7 日以内。
- 直したら Release の notes に書き、報告者を（望めば）記します。
- 修正が出るまで公開しないでください。

## 対象

- Izuna のコード（main / preload / renderer / scripts）
- 配布物（DMG）の組み立てと設定（`electron-builder.yml`、`build/fuses.mjs`）

対象外: Claude Code 自体、Forgejo 自体、依存パッケージそのもの（それぞれの報告先へ）。

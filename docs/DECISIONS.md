# 設計の背景

CLAUDE.md から出した、**触るときに毎回は要らない**節。なぜこの構成か、技術スタック、
未決事項、Nimbalyst の再調査、リポジトリの公開範囲。節番号は元のまま（コードの `§N` から引ける）。

## 2. なぜこの構成か

### 既存調査の結論（2026-09 時点）

| 既存 | 立ち位置 |
|---|---|
| Claude Code 公式デスクトップアプリ | 差分・統合ターミナル・worktree 並列・PR 監視・Routines まで実装済み。最大の競合 |
| Nimbalyst（旧 Crystal） | Electron + embedded ghostty + 拡張SDK + iOS 版。MIT / 1.7k★ / 5,936 commits |
| Clarc | SwiftUI + SwiftTerm。スラッシュコマンド対応済み。Apache-2.0 / 365★ |
| ClaudeCodeSDK | Swift パッケージ。headless と Agent SDK の二バックエンド。MIT / 98★ |
| libghostty 系ターミナル | AI エージェント向けだけで20本超（agterm, limpid, cmux, moss, Forge…）。飽和 |
| Opcode（旧 Claudia） | 開発停止 |

機能面で公式や Nimbalyst に追いつく見込みはない。**自分専用の道具**として、
どちらにもない `/` の扱いに一点集中する。

### スタック選定

**Electron を選んだ。** 実装の主戦場は会話UI（ストリーミング markdown・差分・
シンタックスハイライト・折り畳めるツールコール）であり、そこは Web が圧倒的に
強い。ネイティブアドオンが素直に載り Chromium 固定で描画差に悩まない点で
Tauri より Electron。

**検討して落とした選択肢**：

- **Swift + AppKit/SwiftUI** — libghostty 統合は一級、ネイティブ感も最高。
  ただし会話UIの実装コストが本体作業になる。「Swift × ヘッドレス × libghostty」は
  調査上は本当に空いているので、方針転換するならここ
- **Tauri** — WKWebView とネイティブアドオンの取り回しで Electron に劣る
- **Flutter** — `flutter_ghostty` が 8 commits / 2 stars で実用外
- **Rust + GPUI（Zed）** — Zed 外の採用実績がほぼなく、詰まったとき助けがない

**libghostty は `ghostty-web` で使っている（段6 で実装済み）。** 当初は
「Electron から使う道が細い」と判断して見送ったが、Nimbalyst のソースを読んで
実用経路が判明した。`ghostty-web`（coder 製）は **libghostty-vt の公式 WASM
ビルド**で、xterm.js 互換 API・Canvas レンダラ・Kitty graphics・OSC 8 を持つ。
Nimbalyst は `ghostty-vt.wasm` を同梱し `node-pty` と組み合わせている。
当初の企画趣旨（libghostty を使う）はこれで果たした。

実装して分かったこと: **WASM は base64 で ESM に埋め込まれている**ので、
`ghostty-vt.wasm` を別途配る必要がない（Nimbalyst は同梱している）。
`init()` を呼ぶだけで済む。代償は renderer のバンドルが約 650KB 増えること
（元の wasm が 416KB、base64 で約 555KB）。

以前ここで検討して落としたのは `libghostty-vt-node`（2★ / 9 commits・
パースのみ）と Restty（WebGPU・early-release）。

なお libghostty は Mitchell Hashimoto 本人が **API はアルファで安定保証なし**と
明言しており、将来 Swift フレームワークが公式提供される予定。現時点で深く
依存するのは早い。

---

## 3. 技術スタック

electron-vite 5 / Electron 39 / React 19 / TypeScript 5.9 / Vite 7 / pnpm / vitest 5。
`npm create @quick-start/electron` の react-ts テンプレートが出発点。

**`@anthropic-ai/claude-agent-sdk` を使う（0.3.263 に固定）。** 生の NDJSON を
自前で読むのはやめた。理由は §6。SDK は依存ゼロ・4.8MB で、CLI は同梱せず
`pathToClaudeCodeExecutable` で指した既存の `claude` を起動する。

**版はパッチ番号で連動する**（SDK `0.3.266` ↔ CLI `2.1.266`。2026-09-10 に 263 から上げた）。ずれたまま使うと
SDK が知らないイベントを CLI が吐く。`test/auth.test.ts` が門になっている。

**テストは vitest。** `node --test`(依存ゼロ)を検討したが、この構成では使えない。
import が `from '../../shared/protocol'` と拡張子なしで書かれていて、Node 24 の
型剥がしはこれを解決できない(実測 2026-09-07: `ERR_MODULE_NOT_FOUND`)。
全 import に `.ts` を足すのは本末転倒なので、Vite が既にあることを使う。

セキュリティは Electron の既定を維持する。`contextIsolation: true`、
renderer に `require` を露出しない、`contextBridge` で狭い型付き IPC のみ。

---

## 9. 未決事項

**未検証の前提**（測れば消える。放置すると設計をやり直す）

1. **権限承認のハンドシェイク形式**（§6）— 最優先
2. `stream_event` の逐次適用アルゴリズム。partial から本文を組み立てる規則
3. `tool_use` input の網羅的な形状（Edit / MultiEdit / Bash / Task）
4. resume の挙動と、履歴 JSONL の場所・形式
5. ~~中断（`interrupt_receipt_v1`）の使い方~~ → **解決（2026-09-08 実測）**。

   Agent SDK を採用したときに `query.interrupt()`（制御プロトコル）に
   変わっていた。`SIGINT` を送っているという記述は**古いまま残っていた**。

   | 測ったこと | 結果 |
   | --- | --- |
   | 出力が止まるか | **止まった**（751 文字で増加なし） |
   | プロセスが死ぬか | **死なない** |
   | 同じ会話を続けられるか | **続けられる**（`alive` が返った） |

   **「ターンだけ止めて会話は生きる」は成立している。**

   なお画面には**「中断」ボタンが 2 つ**あり、片方は実行中かどうかに関係なく
   出ていた。止めるものが無いときに出ていれば、何をする釦なのか分からない。
   実行中だけに直し、言葉も「止める」にした（「中断」は何を中断するのか
   言っていない）。
6. 異常系: プロセス死、認証切れ、CLI 更新でワイヤ形式が変わったとき
   → 6 のうち「CLI 更新」だけは §11 で塞いだ。残りは未着手
7. ~~**プラグイン hook の遮断手段**~~ → **解決（2026-09-07）**。
   `settingSources: ['project','local']` で `~/.claude/settings.json` を読まなくなり、
   そこの `enabledPlugins` 経由の hook が落ちる。決定は §13。
   （以下は経緯として残す）
   izuna が起動する `claude` は利用者の環境のプラグインを引き継ぐ。
   これは実装の罠ではなく**仕様の問題**で、他人の環境では
   「izuna のバグ」に見える不具合として出る。
   → 遮断手段の比較は §7 で埋めた（`--safe-mode` / `--bare` は効く、cwd 変更は効かない）。
   **残っているのは「hook だけを落とす手段」と、`--bare` が OAuth で動くかどうか**

**未決の仕様**（決めれば消える）

1. **`/` パレットの到達点**。「探して・見て・編集できる」は方向であって仕様ではない。
   閲覧・検索までか、その場で書き換えるところまでか
2. 会話ビューの状態モデル。イベント列 → UI 状態の変換規則。設計の心臓
3. 差分をツール入力から起こすか、ファイルシステムを読むか
4. ターミナルをいつ入れるか。入れるなら xterm.js / Restty / node-pty のどれか。
   libghostty を諦めるかがここで決まる

---

## 19. Nimbalyst 再調査（2026-09-07）

TS/TSX 約 5 万行、`packages/electron` だけで 3,066 ファイル。
**機能で追う相手ではない**（§2 の結論は変わらない）。取捨を明示しておく。

| 機能 | Izuna |
| --- | --- |
| セッション一覧・resume・検索・Kanban | **取る**（§18） |
| セッション ↔ ファイルの相互リンク | 取る |
| 赤緑の差分を **1 件ずつ** accept/reject | 取る（いまの差分ビューは表示のみ） |
| AI によるコミット文の下書き | 取る |
| MCP の結果を JSON でなく widget で描く | 保留 |
| **15 の agent provider 抽象**（Codex / Copilot / Cursor / Gemini …） | **取らない**。Claude Code 専用は §15 の意図的な決定 |
| 視覚エディタ 7 種（Mermaid / Excalidraw / データモデル …） | **取らない**。別の製品 |
| 拡張 SDK とマーケットプレイス | **取らない**。利用者は作者ひとり |
| iOS companion・push 通知 | **取らない**（GOAL.md） |
| リアルタイム共同編集・セッション共有 | **取らない** |

参考になった実装:

```
packages/electron/src/main/services/ClaudeCodeSessionScanner.ts   JSONL 走査
packages/electron/src/main/services/ClaudeCodeSessionSync.ts      索引との同期
packages/runtime/src/ai/server/providers/TeammateManager.ts       §12 で既出
```

---

## 20. リポジトリと公開範囲（2026-09-08）

upstream は `Watakumi/izuna`（remote 名も `upstream`。2026-09-09 に public にした）。
`shared/remote.ts` はホストで役を決めるので、`github.com` は自動で upstream になる。
sandbox（Forgejo）は `watakumi/izuna`（remote 名 `forgejo`、2026-09-08 に Izuna から push）。
**Izuna 自身の開発は GitHub に対して行う**（2026-09-09）。シェルの git が Forgejo に使う
保管済み認証は `radar-bot` で、`izuna` ボットとは別人なので private のリポジトリが見えず
`git push forgejo` は 404 になる。sandbox へは Izuna 本体が押す。Forgejo の main は揃えない。

### 公開前に監査した結果（全リビジョン対象）

| 見たもの | 結果 |
| --- | --- |
| 認証情報（`sk-ant-` / `ghp_` / `github_pat_` / 秘密鍵 / 40桁hex） | 0 件 |
| メール・実名・会社名 | 0 件 |
| `session-full.ndjson`（私的な会話を含む録画） | 履歴にも一度も無い |
| 録画の会話本文 | 疎通用の合成のみ（`pong` / `hello izuna`） |

トークンは `~/.izuna` の `safeStorage` にあり、リポジトリの外。

### 配る方針（2026-09-09）

作者ひとりの道具から、**自分の Forgejo を持つ人に配るもの**に改めた（docs/GOAL.md）。
同日に履歴を書き換えた（`git filter-repo`）: 作者メールを GitHub の noreply に、コミット文と本文の
家のパスと会社名を伏せ、走行の PNG を全リビジョンから消した。fixture は中身を伏せた（testing.md §11）。
書き換えた履歴は**新しいリポジトリ**に置いた —— 元の `Watakumi/izuna` は `izuna-old` に改名して
private のまま残す（GitHub は古いコミットを PR の参照から保持するので、同じリポジトリで force push
しても消えたことにならない）。控えは `/tmp/izuna-backup.git`（書き換え前の鏡）。
2026-09-09 に public にした。同時に Security Advisories の非公開報告・Dependabot の警告・秘密の走査と push 保護を
GitHub 側で有効にした。Dependabot はメジャーを提案しない（人が読んでから上げる）。

### **これは「あとで public にできる」状態ではない**（2026-09-08 時点）

private の範囲には収まっているが、**履歴に入っている**ものが 3 つある。
公開したくなった時点では `git filter-repo` で書き換えるか、作り直すことになる。

1. **環境の指紋**（`test/fixtures/*.ndjson`）——
   `~/.claude/plugins/cache/…/1.10.0`、`slash_commands` 52 件の全リスト、
   `messaging_socket_path`（PID 由来）。**アカウントがどの機能を使えるかが分かる**
2. **コミットの著者メール**（個人の Gmail）が全コミットに入っている
3. **§14 の口座の話** —— Pro プラン、`five_hour 3% / seven_day 5%`、
   自宅 Forgejo の `localhost:4649`、別リポジトリ名

**fixture を先回りして加工しない。** §11 で「加工した時点で観測ではなく解釈になる」
と決めてある。private のうちは触らないほうが原則に合う。
公開するなら、そのとき fixture を**録り直す**（削るのではなく）。

### 文書の言語（2026-09-11）

**外に向く文書は英語、内に向く文書は日本語。** 利用者の指摘（「README などは OSS のように英語準拠で
書いた方がいい」）で決めた。

| 向き | 何 | 言語 |
| --- | --- | --- |
| 外（配る相手が読む） | `README.md`、`docs/SETUP.md`、`SECURITY.md`、GitHub の description、Cask の desc、tap の README | 英語 |
| 内（作者とエージェントが読む） | `CLAUDE.md`、`.claude/rules/*.md`、`docs/GOAL.md`、`docs/DECISIONS.md`、`docs/NIMBALYST.md`、`docs/ORCA.md`、`docs/ACTIONS.md` | 日本語 |
| 画面 | renderer の文言 | 日本語（ui.md §17.4。訳すと画面と文書が食い違う） |

`README.ja.md` は英語の README の日本語版で、英語が正。自己紹介の 1 文は英語（package.json、README、
GitHub）と日本語（README.ja.md、CLAUDE.md）の 2 本を `test/docs.test.ts` が見る。docs/ACTIONS.md は
runner を回す人向けだが、判断の記録が多いので内側に置く。

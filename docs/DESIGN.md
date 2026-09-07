# Izuna 設計メモ

Claude Code を Codex のようにデスクトップから使うための macOS アプリ。
このファイルは決定と、その根拠になった実測を残す場所。迷ったらここに戻る。

---

## 1. 何を作るか

`claude` CLI をヘッドレスで駆動し、会話・思考・ツール実行・差分・承認を
GUI で描くデスクトップアプリ。ターミナルの中で TUI を動かすのではなく、
アプリが CLI をプロトコル越しに操作する。

**差別化の核は `/` コマンド。** 実行するだけでなく、横断的に見て・探して・
編集できるようにする。既存 GUI はどれも実行しかできない。

## 2. なぜこの構成か（既存調査の結論）

| 既存 | 立ち位置 |
|---|---|
| Claude Code 公式デスクトップアプリ | 差分・統合ターミナル・worktree 並列・PR 監視まで実装済み。最大の競合 |
| Nimbalyst | Electron + embedded ghostty + 拡張SDK + iOS。MIT / 1.7k★ / 5,936 commits |
| Clarc | SwiftUI + SwiftTerm。スラッシュコマンド対応済み。365★ |
| libghostty 系ターミナル | AI エージェント向けだけで20本超。飽和 |

機能面で Nimbalyst に追いつく見込みはない。**自分専用の道具**として、
公式にも Nimbalyst にもない `/` の扱いに一点集中する。

**Electron を選んだ理由**：会話UI（ストリーミング markdown・差分・
シンタックスハイライト・折り畳めるツールコール）が実装の主戦場であり、
そこは Web が圧倒的に強い。ネイティブアドオンが素直に載り Chromium 固定で
描画差に悩まない点で Tauri より Electron。

**libghostty は当面使わない。** Electron から使う道は
`libghostty-vt-node`（2★ / 9 commits・パースのみ）か Restty（WASM + WebGPU・
early-release）しかなく、いずれも「ネイティブに組み込む」当初の趣旨から離れる。
ターミナルペインが必要になった段階で再判断する（§7）。

## 3. stream-json の実測所見

`claude 2.1.263` で測った事実。仕様として公開されたものではないので、
バージョンが上がったら測り直す。

### 起動引数

```
claude --print
       --input-format stream-json --output-format stream-json
       --verbose                    # これが無いと -p でイベントが落ちる
       --include-partial-messages   # 逐次描画用の stream_event
       --replay-user-messages       # 送った user を echo。送達確認に使う
       --permission-prompts host    # 権限はアプリが答える
       [--model X] [--permission-mode X] [--resume SESSION_ID]
```

1プロセス = 1会話。プロセスは turn をまたいで生き続け、stdin に1行流すと
1ターン進む。stdout は NDJSON で1行1イベント。

### イベント種別

`system:init` / `system:hook_started` / `system:hook_response` /
`system:status` / `system:thinking_tokens` / `assistant` / `user` /
`stream_event` / `rate_limit_event` / `result:success`

### `system:init` に入っているもの

```
session_id, cwd, model, permissionMode, claude_code_version, output_style,
tools[], slash_commands[], terminal_slash_commands[], skills[], agents[],
plugins[{name,path,source,version}], mcp_servers[{name,status}],
capabilities[], memory_paths, messaging_socket_path
```

実測で slash_commands 317件 / skills 206件 / agents 53件。
プロジェクト・ユーザー・プラグインのスコープが **cwd 基準で解決済み**。

### 重要な制約：init は入力前に来ない

**`system:init` は最初のユーザーメッセージを送るまで届かない。**
送信前に8秒待っても hook イベントしか来ない（実測）。

したがって `/` パレットは init だけでは埋まらない。次の三段構えにする。

1. 初期表示はファイルシステム走査（即時・API コスト0）
   `~/.claude/commands`, `<cwd>/.claude/commands`, `~/.claude/skills`,
   `installed_plugins.json` v2 の `installPath` 配下
2. 最初の `system:init` が届いたら**それを正として上書き**（CLI が真実）
3. init はプロジェクト単位でキャッシュし、次回起動時の初期値にする

走査は「補完を即座に出すため」と「説明文・引数ヒントを読むため」に必要で、
init は「実際に送れるコマンドの権威」。役割が違うので両方要る。

### その他

- `capabilities: ["interrupt_receipt_v1","interrupt_cancel_queued_v1","msg_lifecycle_v1"]`
  中断まわりの制御プロトコルが使える
- `result` に `total_cost_usd` と `permission_denials` が入る。ステータスバー行き
- `rate_limit_event` に five_hour / seven_day の利用率。これも出す

## 4. プロセス構成

```
main プロセス
  ├ ClaudeSession        claude を spawn し NDJSON を読む / stdin に書く
  ├ CommandIndex         / コマンドの走査 + init マージ + キャッシュ
  └ ipc/register         型付き IPC でレンダラに中継
preload
  └ contextBridge        contextIsolation は維持。狭い型付き面だけ露出
renderer (React)
  └ 会話ビュー / 差分 / 承認 / スラッシュパレット
```

libghostty が「差し替え可能な部品」であるのと同じ理由で、
`ClaudeSession` は UI を知らない。CLI 相手の疎通は
`scripts/smoke-session.ts` が GUI 抜きで担保する。

## 5. 実測で判明した実装上の罠

- **PATH**：Finder から起動した Electron はログインシェルの PATH を継承しない。
  mise / nvm / `~/.local/bin` 配下を丸ごと見失う。`$SHELL -ilc 'env -0'` で
  環境変数一式を取り、`claude` の場所もそこから解く（`src/main/claude/locate.ts`）
- **macOS に `timeout` が無い**。検証スクリプトで使わない
- **hook がセッション開始時に大量の文脈を注入する**。GUI から起動する場合、
  意図しない SessionStart hook が混ざる。将来 `--settings` で制御を検討

## 6. MVP スコープ

やる：

- [x] stream-json 双方向セッション（`ClaudeSession`）
- [ ] 会話ビュー：text / thinking / tool_use / tool_result の逐次描画
- [ ] `/` パレット：走査 + init マージ、あいまい検索、引数ヒント
- [ ] 権限承認 UI（`--permission-prompts host`）
- [ ] 差分ビュー（Edit / Write の入力から生成）
- [ ] セッション resume と履歴

やらない（当面）：

- ターミナルペイン、libghostty、worktree 並列、PR 連携、モバイル、Windows / Linux

## 7. 未決事項

- **ターミナルをいつ入れるか。** 入れるなら xterm.js / Restty / node-pty のどれか。
  libghostty を諦めるかどうかはここで決まる
- **`/` の編集機能をどこまでやるか。** 閲覧・検索までか、その場で書き換えるか。
  ここが差別化の本体なので、最初に手をつける
- 公式 Swift フレームワークが出た場合、Swift 路線に戻す価値があるか

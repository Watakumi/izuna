---
paths:
  - "src/**"
  - "scripts/**"
---

# 実装上の罠

実測で踏んだもの。CLI・git・Forgejo・Electron・シェル。どのファイルを触るときも、まずここに同じ罠が無いかを見る。

## 7. 実装上の罠（実測で踏んだもの）

- **PATH**: Finder から起動した Electron はログインシェルの PATH を継承しない。
  mise / nvm / `~/.local/bin` 配下を丸ごと見失う。`$SHELL -ilc 'env -0'` で
  環境変数一式を取り、`claude` の場所もそこから解く（`src/main/claude/locate.ts`）
- **`--verbose` 必須**: `-p` と stream-json の組み合わせで、無いとイベントが落ちる
- **macOS に `timeout` が無い**。検証スクリプトで使わない（一度これで誤った測定をした）
- **ユーザーの hooks が混入する**: SessionStart / PreToolUse hook がアプリ起動の
  セッションにも効く。実測中、グローバル hook が大量の文脈を注入し、ツール実行も
  ブロックした。GUI から起動する場合の hook 制御（`--settings` 等）を要検討
- **top-level await が使えない**: tsx の既定は cjs 出力
- **hook 混入の正体はプラグイン**(2026-09-07 に特定)。`~/.claude/settings.json` と
  `settings.local.json` の hooks は**どちらも空**だった。犯人は `everything-claude-code`
  プラグインで、**26 本**登録している —— PreToolUse 8 / PostToolUse 8 / Stop 6 /
  SessionStart 1 / PreCompact 1 / PostToolUseFailure 1 / SessionEnd 1。
  ツール実行を止めていたのが PreToolUse、文脈を大量注入していたのが SessionStart。
  **`--settings` で空を渡してもプラグイン由来は消えない見込み(未検証)**
- **hook の遮断手段（2026-09-07 に実測）**。メッセージ送信前に hook は出そろうので、
  **API を呼ばずに測れる**（この手を使うこと）。

  | 手段 | hook | 副作用 |
  | --- | --- | --- |
  | 履歴の無いディレクトリで起動 | **消えない**（4,065 B） | cwd を変えても注入される |
  | `--safe-mode` | **消える**（0 B） | plugins / skills / custom commands も落ちる。ただし `slash_commands` は空にならず 52 件残る（組み込み分） |
  | `--bare` | **消える**（0 B） | 認証が `ANTHROPIC_API_KEY` 固定。この環境は OAuth（`apiKeySource: "none"`）なので送信時に落ちる見込み（**未検証**） |

  **hook だけを落とす手段は見つかっていない。**
- **SDK は `systemPrompt` を省略すると Claude Code の既定プロンプトを使わない**
  （2026-09-07 に実地で踏んだ）。作業ディレクトリも auto-memory も git status も、
  Claude Code の振る舞いの指示そのものも入らない。症状は分かりにくい ——
  エージェントは**自分がどこにいるか知らないまま、それらしいパスを作り話する**。

  実測: 一時ディレクトリで起動し「cwd はどこか、ツールを使わずに答えよ」と
  聞くと `I do not know.` が返る。画面上は、存在しない
  `/Users/<別人>/dev/<知らないプロジェクト>/notes.txt` に書こうとして
  `EACCES` で失敗し、そのあと `pwd` を撃って正しい場所に書き直す、という
  挙動として現れた。

  対処: `systemPrompt: { type: 'preset', preset: 'claude_code' }` を渡す。
  多人数で prompt cache を共有したい場合のみ `excludeDynamicSections: true`
  を検討する（cwd などが system ではなく最初の user メッセージに移る）。
- **拒否は結果の文面から判定してはいけない**（同日、自分で作り込んだバグ）。
  `EACCES: permission denied` を `/permission/i` で拾い、**ファイルシステムの
  失敗を人間の拒否として表示していた**。SDK の `user` メッセージには
  `tool_result_meta.non_execution_kind` が来ない（生の NDJSON にはある）ので、
  **拒否した側が `tool_use_id` を覚える**のが唯一正しい
  （`transcript.ts` の `markDenied`）。
- **`before-quit` で無制限に待つと、アプリが終了できなくなる**（2026-09-07 に踏んだ）。
  後片付けのために `event.preventDefault()` して `stopAllSessions()` を待つ実装に
  していたが、待ちが返らないと `Ctrl+C` を何度押しても Electron が落ちない。
  さらに **`Ctrl+C`（SIGINT）は `before-quit` を通らない**ので、
  そもそもハンドラが効いていない経路もある。

  対処は 3 段:
  1. `shared/wait.ts` の `settle()` で、片付けの待ちに必ず上限を切る
  2. `process.on('SIGINT' | 'SIGTERM')` を自分で受ける
  3. それでも駄目なとき用に `process.exit(0)` の保険を置く

  **孤児が 1 つ残るほうが、終われないアプリよりましである。**
  詰まったら `pkill -f 'izuna/node_modules/.pnpm/electron'`。
- **`pnpm dev` は main プロセスを入れ替えない**（2026-09-07 に踏んだ）。
  renderer は HMR で更新されるが main はそのまま残る。IPC の口を足した直後は
  食い違い、`No handler registered for 'izuna:repo'` のような**原因を指さない
  エラー**になる。実際に 5 時間前に起動した main で踏んだ。

  対処: `shared/ipc.ts` の `IPC_VERSION`。renderer が起動時に main へ問い合わせ、
  食い違っていたら赤い帯を出す。**手では上げない** —— `CH` の鍵から導くので、
  口が増減すれば必ず変わる（§27。以前は「上げ忘れても害はない」と書いていたが、
  それは「検出しない」と同じだった）。
  詰まったら `pkill -f 'izuna/node_modules/.pnpm/electron'` して `pnpm dev`。
- **CSP が WASM のコンパイルを止める**（2026-09-07 に踏んだ）。electron-vite の
  雛形は `script-src 'self'` で、`ghostty-web` が
  `WebAssembly.compile(): ... violates the following Content Security policy` で落ちる。

  **`'unsafe-eval'` を足さないこと。** あれは JS 文字列の `eval` まで許す。
  `'wasm-unsafe-eval'` は WASM のコンパイルだけを許す狭い許可で、こちらを使う。
  WASM は base64 の `data:` URL として埋め込まれているので、`connect-src` にも
  `data:` が要る（fetch がそこを読む）。
- **無視してよい macOS のログが 2 つある**（2026-09-08）。原因を探しに行かないこと。

  ```
  Electron[...] representedObject is not a WeakPtrToElectronMenuModelAsNSObject
  Electron[...] error messaging the mach port for IMKCFRunLoopWakeUpReliable
  ```

  前者は Electron の macOS メニュー実装。アプリのメニューを設定していないので
  既定メニューが使われるが、そこに **macOS 自身が差し込む項目**（サービス・
  音声入力・絵文字と記号）が混ざり、Electron が自前のラッパーでないものを
  見たときに吐く。起動時に 1 回。

  後者は Input Method Kit、つまり**日本語入力**。macOS のシステムログで、
  Chrome や VS Code でも出る。入力欄に最初にフォーカスが入るときに出る。

  **症状が出ていれば別**（変換候補が出ない・確定した字が消える・メニューが
  反応しない・繰り返し出る）。そのときはログではなく症状を追うこと。

- **private な sandbox には資格情報を渡さないと push できない**（2026-09-08）。
  作るリポジトリは private なので、匿名の push は 401 になる。
  ところが **git はそれを `Repository not found` と言う**（401 を 404 に
  言い換える）ので、「リポジトリが無い」と読めて原因に辿り着けない。
  DB を見れば `is_private=1` で存在しており、`info/refs` は 401 を返す。

  **`credential.helper` を止めないと `GIT_ASKPASS` は呼ばれない**（同日、続けて踏んだ）。
  git は helper を先に試し、返ってきた値をそのまま使う。この環境では
  `/opt/homebrew/etc/gitconfig` に `osxkeychain` が入っていて、**別の（古い）
  資格情報を返していた**。その結果 Forgejo は「認証は通ったが、その private
  リポジトリを見る権限が無い利用者」と判断し、**401 ではなく 404** を返す。

  | 経路 | 結果 |
  | --- | --- |
  | 匿名 | 401 |
  | basic auth（`user:token`） | 200 |
  | `GIT_ASKPASS` だけ | **失敗**（helper が横取り） |
  | `-c credential.helper=` ＋ `GIT_ASKPASS` | **成功** |

  **匿名なら 401 が返るのに、中途半端に認証されるほうが原因を隠す。**

  **トークンを remote の URL や `.git/config` に埋めない。** 埋めると平文で残り、
  `git remote -v` にも出て、そのまま画面に載る。`GIT_ASKPASS` に小さな仲介を
  置き、**環境変数で渡してその場で捨てる**。引数に置かないのは、`ps` で
  他のプロセスから見えるからである。付けるのは **sandbox 相手のときだけ**
  （GitHub は ssh なので要らない）。

- **中身の無いリポジトリは `/pulls` に 404 を返す**（2026-09-08 実測）。
  リポジトリ自体は 200、`/branches` も 200 なのに `/pulls` だけ 404 になる。
  **作った直後の sandbox がまさにその状態**なので、画面を開くたびに
  例外が飛んでいた（画面側は握っていたので実害は無かったが、main が
  例外の山を吐いていた）。

  **コミットが 1 つも無ければ PR は存在しえない。** 404 は異常ではなく
  「まだ無い」なので空で返す。**それ以外の失敗は握りつぶさない。**

- **Forgejo でリポジトリを作るには権限が 2 つ要る**（2026-09-08 実測）。
  `POST /api/v1/user/repos` は `write:repository` だけでは 403 になる。

  | 与えたもの | 結果 |
  | --- | --- |
  | `write:repository` だけ | 403「`write:user` が要る」 |
  | `write:user` だけ | 403「`write:repository` が要る」 |
  | **両方** | **201** |

  「ユーザーの下に作る」ので、どちらの権限も要求される。
  `REQUIRED_SCOPES`（**`src/shared/forge.ts`**）が唯一の定義。

  **権限は記録ではなくサーバに聞く**（2026-09-08 に測り直した）。
  `GET /users/{u}/tokens` は **token 認証で通り、`scopes` を返す**。
  手元のトークンとは**末尾 8 文字**（`token_last_eight`）で突き合わせる。
  最初は「発行時に要求した一覧」を覚えていたが、それは記録であって事実ではない。

  | 操作 | token 認証 |
  | --- | --- |
  | 一覧 `GET /users/{u}/tokens` | **200**（`scopes` 付き） |
  | 削除 `DELETE .../tokens/{id}` | **不可**（`auth method not allowed`＝パスワードが要る） |

  **Izuna は発行するたびに 1 本増やす**（同名は作れないので時刻を混ぜている）。
  溜めた本人が片付けられないのは筋が通らないので、準備画面に一覧を出し、
  いま使っているものに印を付け、Forgejo の設定画面へ導く。
  **消す機能は持たない** —— API が許さないので、持てるふりをしない。

  **同じ名前の定数を 2 箇所に作って踏んだ。** 判定側は `shared` の
  `['read:user','write:repository']`、発行側は `main/forge/setup.ts` の
  `['write:user',…]` を見ていて、**判定はその 2 つのハードコードを
  比べているだけ**だった。トークンを作り直しても「スコープが足りません」が
  消えず、**実際のトークンは一度も見ていなかった**。

  さらに、Forgejo は `/api/v1/user` の応答に**スコープを返さない**。
  分からないものを「要るものを持っている」と埋めていたので、検査が空回り
  していた。いまは**発行したときの権限を暗号化して一緒に保管**し、それを見る。
  記録の無い古いトークンは「**権限が分かりません**」と出す ——
  分からないことを「足りない」と言わない。
  403 の文面は**足りない権限を名指しする** —— 「スコープが足りません」
  だけでは、何をどう直すのか分からない。

  **「発行し直す」を出してよいのは、発行し直せば直るときだけ**（2026-09-09）。
  消せない以上、外れた釦は**トークンを増やすだけ**である。

  `inspectToken` は「通らなかった」を `tokenScopes: []` で表していて、
  その枝が「通ったか」の枝より**前**にあった。結果:

  | 実際 | 画面 | 押すと |
  | --- | --- | --- |
  | 401 で拒否された | 「古い版で発行されたため、権限が分かりません」 | 1 本増え、表示は変わらない |
  | 繋がらない | 同上 | 1 本増え、表示は変わらない |

  「トークンが拒否されました」という文面は**一度も出なかった** ——
  `[]` は必ず `works: false` と一緒に返るのに、`[]` の枝が先にあったからである。
  死んだ枝と嘘の文面が同時にあった。

  いまは `tokenRejection: { status, detail }` で理由を返し、判定は
  **通ったかを最初に見る**。釦を出すのは **401 / 403 のときだけ** ——
  繋がらないのはトークンのせいではないので、押しても増えるだけである。
  警告文には「古いトークンは Izuna からは消せない」と書く。

- **pnpm 11 は `allowBuilds` を埋めるまで install を拒む**。`pnpm-workspace.yaml` が
  雛形のまま(`set this to true or false`)だったので、`pnpm verify` が**起動もしなかった**。
  `package.json` の `pnpm.onlyBuiltDependencies` は 11 では読まれない(移設先が workspace 側)

- **keychain の `izuna Safe Storage` が 2 つできると、保管したトークンが復号できない**（2026-09-09、
  `pnpm e2e` で見つけた）。account が `izuna` と `izuna Key` の 2 項目があり、暗号化に使った鍵と
  復号に使う鍵が別物だった。`loadToken()` は null を返し、画面は「未設定です」と言っていた。
  いまは `tokenStatus()` が「無い」と「読めない」を分け、診断は「復号できません。発行し直す」と出す。
  古い項目を消すかは人が Keychain Access で決める。

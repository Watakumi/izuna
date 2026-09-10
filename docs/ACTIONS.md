# 自宅で CI を回す（Forgejo Actions）

> 2026-09-10 に作者の Mac で回した。push から 30 秒で `success` になり、Izuna の `forgeRuns` が
> `running` → `success` を読んだ（`shared/ci.ts` → PR の札の `CiBadge`）。
> **回すかどうかは人が決める** —— `docker.sock` を渡す判断をアプリが押し切らない。
> `HTTP_ADDR` は **127.0.0.1 のままでよい**（同日の夜に測り直した。§ 壁 2）。
> 手順 4 は最初の版が間違っていた（下）。いまの手順は実測で通る。

---

## 全体像

```
Forgejo（brew · localhost:4649）
   ▲ 登録トークンで繋ぐ
   │
Forgejo Runner（**Docker で動かす**）
   │ ジョブごとに
   ▼
node:24 などのコンテナ
```

Izuna の「Forgejo」画面が、この各段の状態を診断する。

---

## macOS 固有の壁が 2 つある

どちらも実測で確認した。**知らずに始めると必ず詰まる**ので先に書く。

### 1. runner に macOS 版が無い

Forgejo Runner v13.1.0 のリリースアセットは 12 個あるが、全部これだけ:

```
forgejo-runner-13.1.0-linux-amd64
forgejo-runner-13.1.0-linux-arm64
（+ .asc / .sha256 / .xz）
```

**darwin のバイナリは無い。** Homebrew にも formula が無い
（`brew install forgejo-runner` は失敗する）。
したがって macOS では **Docker で動かすしかない**。

### 2. 「loopback だとコンテナから届かない」は macOS では間違い

```ini
# /opt/homebrew/var/forgejo/custom/conf/app.ini
HTTP_ADDR = 127.0.0.1
```

最初の版は「Docker のコンテナはホストの 127.0.0.1 に届かない」と書き、`0.0.0.0` に開かせていた。
**それは Linux の Docker の話で、macOS では違う。** 2026-09-10 の夜に測り直した:

| 待ち受け | LAN のアドレス（192.168.1.x:4649） | runner のコンテナ → `host.docker.internal:4649` | ジョブの `node:24` → 同左 |
| --- | --- | --- | --- |
| `0.0.0.0` | 届く | 200 | 200 |
| **`127.0.0.1`** | **届かない** | **200** | **200** |

Docker Desktop / OrbStack は `host.docker.internal` をホスト側のプロセスが中継するので、
127.0.0.1 に束ねたサービスにも届く。127.0.0.1 のまま push したジョブも `success` になった。
**開く理由が無いので開かない。** 開いていれば Izuna の「Forgejo」画面が警告する
（`shared/forge.ts` の `openToLan()`。`test/forge.test.ts` が門）。押して開く釦は消した。

---

## 手順

### 1. Actions を有効にする

Izuna の「Forgejo」画面 →「有効にする」。手でやるなら:

```ini
[actions]
ENABLED = true
```

```bash
brew services restart forgejo
```

### 2. 待ち受けは開かない

`HTTP_ADDR = 127.0.0.1` のままでよい（§ 壁 2）。以前ここにあった「0.0.0.0 で待ち受ける」は消した。
`actions` の書き換えは `app.ini.izuna-backup` に控えを残す。

### 3. 登録トークンを出す

Izuna の「登録用トークンを出す」。手でやるなら:

```bash
forgejo forgejo-cli actions generate-runner-token \
  --work-path /opt/homebrew/var/forgejo
```

### 4. runner を Docker で動かす

**環境変数だけでは登録しない**（2026-09-10 に踏んだ。`FORGEJO_RUNNER_REGISTRATION_TOKEN` を渡しても
イメージはヘルプを出して終わる）。`register` を明示してから `daemon` を起こす。2 回目以降は `.runner` が
`~/.izuna/runner` に残っているので `daemon` だけでよい。

```bash
# 登録（1 回だけ）
docker run --rm -v "$HOME/.izuna/runner:/data" -w /data data.forgejo.org/forgejo/runner:13 \
  forgejo-runner register --no-interactive \
    --instance http://host.docker.internal:4649 \
    --token "<3 で出したトークン>" --name mac --labels "docker:docker://node:24"

# 常駐
docker run -d --name forgejo-runner --restart unless-stopped --user root \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.izuna/runner:/data" -w /data \
  data.forgejo.org/forgejo/runner:13 forgejo-runner daemon
```

- `docker.sock` を渡すのは、runner がジョブごとにコンテナを立てるため。
  **これはホストの Docker を完全に操作できる権限**なので、信用できるリポジトリだけを回すこと
- `--user root` が要る。イメージの既定の利用者（uid 1000）は `docker.sock` に触れず
  「permission denied while trying to connect to the docker API」で落ちる（OrbStack で実測）
- `host.docker.internal` で OrbStack / Docker Desktop からホストに届く。**127.0.0.1 のままで届く**（§ 壁 2）
- ラベル `docker` がワークフローの `runs-on: docker` に対応する

### 5. 確かめる

`docker logs forgejo-runner` に `declared successfully` と `[poller] launched` が出れば繋がっている。
Forgejo の `/admin/actions/runners` にも `mac` が出る。リポジトリに push すると `.forgejo/workflows/` の
workflow が走り、Izuna の PR の札が `CI running` → `CI 緑` に変わる（2026-09-10 の実測では push から 30 秒）。

---

## Izuna 自身のワークフロー

`.forgejo/workflows/verify.yml` を置いてある。Forgejo は
`.forgejo/workflows/` を読み、無ければ `.github/workflows/` に落ちる。

```yaml
runs-on: docker
container:
  image: node:24
env:
  ELECTRON_SKIP_BINARY_DOWNLOAD: '1'   # 検査に Electron 本体は要らない
  IZUNA_CI: '1'                        # 手元の環境を見る検査を外す
run: pnpm verify
```

### `IZUNA_CI` を入れた理由

`pnpm verify` には**コードではなく手元の環境を見る検査**が 2 つある。

- `test/protocol.test.ts` の「手元の CLI」—— `claude` の版が実測と一致するか
- `test/auth.test.ts` の「SDK と CLI の版」—— パッチ番号が揃っているか

コンテナに `claude` は無い。これは**コードの問題ではない**ので、
CI では外す。ローカルの `pnpm verify` では必ず走る ——
`claude` が無いことを緑で通さない、という規律は手元では変えない。

「skip する検査は門ではない」（CLAUDE.md §11）に対する例外はこれだけで、
理由は「まだ書いていない」ではなく「**その環境には適用できない**」である。

---

## やらないと決めていること

- **runner をホストで直接動かす**。macOS 版バイナリが無いので選択肢に無い
- **runner を Izuna が起動・監視する**。docker.sock を渡す判断は人がやるべきで、
  アプリが押し切るものではない。Izuna は登録トークンを出すところまで
- **GitHub Actions を置き換える**。GitHub 側は出口（GOAL.md 柱2）であり、
  そちらの CI をどうするかは別の話

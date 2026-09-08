# 自宅で CI を回す（Forgejo Actions）

> **いま有効にする必要はない。** v1 の測り方（docs/GOAL.md）のうち Izuna 側の
> 「状態を読める」は 2026-09-09 に入った（`forgeRuns` → `shared/ci.ts` → PR の札の `CiBadge`）。
> **回すほう（runner）は人が決める** —— `HTTP_ADDR` を LAN に開き、`docker.sock` を渡す判断を
> アプリが押し切らない。これは「回したくなったときに読む」ための基盤である。
> 手順の途中で詰まる箇所は全部**実測で確認済み**。

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

### 2. Forgejo が loopback でしか待ち受けていない

```ini
# /opt/homebrew/var/forgejo/custom/conf/app.ini
HTTP_ADDR = 127.0.0.1
```

**Docker のコンテナはホストの 127.0.0.1 に届かない。**
このままだと runner は Forgejo に登録すらできない。

`HTTP_ADDR = 0.0.0.0` に開く必要があるが、**同じネットワークの他の端末からも
見えるようになる**。自宅の LAN に他人がいないか、macOS のファイアウォールで
絞れているかを確かめてからにすること。

Izuna の Forgejo 画面はこれを検査していて、押す前に「他の端末からも見える
ようになります」と出す。`shared/forge.ts` の `reachableFromContainer()` が
判定を持ち、`test/forge.test.ts` が門になっている。

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

### 2. 待ち受けを開く

Izuna の「0.0.0.0 で待ち受ける」。**§ 壁 2 の警告を読んでから押すこと。**
どちらの書き換えも `app.ini.izuna-backup` に控えを残す。

### 3. 登録トークンを出す

Izuna の「登録用トークンを出す」。手でやるなら:

```bash
forgejo forgejo-cli actions generate-runner-token \
  --work-path /opt/homebrew/var/forgejo
```

### 4. runner を Docker で動かす

```bash
docker run -d --name forgejo-runner --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOME/.izuna/runner:/data" \
  -e FORGEJO_INSTANCE_URL="http://host.docker.internal:4649" \
  -e FORGEJO_RUNNER_REGISTRATION_TOKEN="<3 で出したトークン>" \
  -e FORGEJO_RUNNER_NAME="mac" \
  -e FORGEJO_RUNNER_LABELS="docker:docker://node:24" \
  data.forgejo.org/forgejo/runner:13
```

- `docker.sock` を渡すのは、runner がジョブごとにコンテナを立てるため。
  **これはホストの Docker を完全に操作できる権限**なので、信用できるリポジトリだけを回すこと
- `host.docker.internal` で Docker Desktop からホストに届く（§ 壁 2 が前提）
- ラベル `docker` がワークフローの `runs-on: docker` に対応する

### 5. 確かめる

Forgejo の `/admin/actions/runners` に `mac` が出れば繋がっている。
リポジトリに push すると `.forgejo/workflows/verify.yml` が走る。

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

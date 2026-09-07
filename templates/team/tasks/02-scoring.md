---
id: "02"
title: あいまい検索の重み付け
assignee: B
branch: feat/score
status: doing
depends_on: []
paths:
  - src/renderer/src/score.ts
updated: 2026-09-07T15:19:00+09:00
---

## やること

名前と説明の両方に当てる。名前の一致を強く重み付ける。

## 完了条件

- 名前の前方一致が説明の部分一致より上に来る

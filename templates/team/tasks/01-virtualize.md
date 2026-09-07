---
id: "01"
title: 一覧を仮想化する
assignee: A
branch: feat/palette
status: idle
depends_on: []
paths:
  - src/renderer/src/Palette.tsx
updated: 2026-09-07T15:22:00+09:00
---

## やること

行の高さを 38px 固定にして仮想化する。スコアリングは 02 が触るので入らない。

## 完了条件

- 316 件でスクロールが滑らか
- 既存のキーバインドが動く

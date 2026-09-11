/**
 * Izuna が同梱するプラグインの置き場（§33）。
 *
 * 資料の skill は**開いたリポジトリの `.claude/skills/` に置かない。** 置くと、Izuna を消しても
 * 相手のリポジトリにファイルが残る。SDK の `plugins`（`--plugin-dir` として渡る）で持ち込めば、
 * 相手には何も足さずに skill が使える（2026-09-11 に、よそのリポジトリで測った）。
 *
 * 判定だけの純粋関数（§4）。実際に存在するかは main が見る。
 */

/** 同梱するプラグインの名前。skill は `izuna-docs:doc-…` の形で出る */
export const PLUGIN_NAME = 'izuna-docs'

/**
 * `app.getAppPath()` から、同梱プラグインの場所を出す。
 *
 * 開発では出力ディレクトリの親がリポジトリの根で、`resources/` がそのまま読める。
 * 配布物では `app.asar` の中に見えるが、`asarUnpack: resources/**`（`electron-builder.yml`）で
 * 実体は `app.asar.unpacked/` にある。**asar の中のパスを渡すと claude が読めない**ので、
 * 展開された側を指す。
 */
export function pluginPath(appPath: string): string {
  const root = appPath.replace(/app\.asar(?=$|\/)/, 'app.asar.unpacked')
  return `${root.replace(/\/$/, '')}/resources/${PLUGIN_NAME}`
}

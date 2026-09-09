import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'
import { join } from 'node:path'

/**
 * Electron の fuses を切る（配布物の固め。§26）。electron-builder の afterPack から呼ぶ。
 *
 * - RunAsNode を切る: `ELECTRON_RUN_AS_NODE=1` で素の node として動かされない
 * - NodeOptions / NodeCliInspectArguments を切る: `NODE_OPTIONS` や `--inspect` で中に入られない
 * - EnableEmbeddedAsarIntegrityValidation / OnlyLoadAppFromAsar: asar を差し替えられない
 * - EnableCookieEncryption: 埋めた頁（§32）のログインの Cookie を暗号化する
 * - GrantFileProtocolExtraPrivileges を切る: renderer は file:// ではなく app:// で配る
 *
 * どれも「開発では要るが、配布物では要らない口」である。
 */
export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context
  const name = packager.appInfo.productFilename
  const exe =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
      : electronPlatformName === 'win32'
        ? join(appOutDir, `${name}.exe`)
        : join(appOutDir, name)
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // renderer は app:// で配る（main/protocol.ts）ので、file スキームの余計な権限は要らない
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false
  })
  console.log(`[fuses] ${exe}: RunAsNode / NodeOptions / Inspect を切り、asar の検証を入れた`)
}

import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Forgejo のトークンを保管する。
 *
 * **平文で書かない。** macOS では `safeStorage` がキーチェーンの鍵で暗号化する。
 * 使えない環境では保管を拒む —— 平文で置くくらいなら、毎回入れてもらうほうがよい。
 */
const file = (): string => join(app.getPath('userData'), 'forge-token.bin')

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('この環境では暗号化して保管できません。トークンは保存しません')
  }
  const path = file()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, safeStorage.encryptString(token))
}

export async function loadToken(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(await readFile(file()))
  } catch {
    // 未保存・鍵が変わった・壊れた —— どれも「無い」として扱う
    return null
  }
}

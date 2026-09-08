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

/**
 * **何の権限で作ったかも一緒に覚える。**
 *
 * Forgejo は `/api/v1/user` の応答にスコープを返さないので、
 * トークンを見ても権限は分からない。分からないものを分かったふりで
 * 判定していたのが、作り直しても直らない原因だった。
 * 作った時点の記録を残せば、**古い権限のまま残っていること**が判る。
 */
export async function saveToken(token: string, scopes?: readonly string[]): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('この環境では暗号化して保管できません。トークンは保存しません')
  }
  const path = file()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, safeStorage.encryptString(JSON.stringify({ token, scopes: scopes ?? null })))
}

/** 記録した権限。**古い形式（文字列だけ）なら null**（＝分からない） */
export async function loadScopes(): Promise<string[] | null> {
  const raw = await readStored()
  return raw && typeof raw === 'object' && Array.isArray(raw.scopes) ? raw.scopes : null
}

async function readStored(): Promise<{ token: string; scopes: unknown } | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null
    const text = safeStorage.decryptString(await readFile(file()))
    // 古い形式は生の文字列。権限は分からないものとして扱う
    if (!text.startsWith('{')) return { token: text, scopes: null }
    return JSON.parse(text) as { token: string; scopes: unknown }
  } catch {
    return null
  }
}

export type TokenStatus = 'none' | 'unreadable' | 'ok'

/**
 * 「無い」と「あるのに読めない」を分ける（2026-09-09、E2E で見つけた）。
 *
 * `loadToken()` はどちらも null で、画面は「未設定です」と言っていた。
 * 実際には保管はあって、**keychain の `izuna Safe Storage` が 2 つ**でき、
 * 暗号化した鍵と復号に使う鍵が別物になっていた。「未設定」と言われた人は
 * 設定したのにと思うだけで、発行し直せば直るとは分からない。
 */
export async function tokenStatus(): Promise<TokenStatus> {
  let buf: Buffer
  try {
    buf = await readFile(file())
  } catch {
    return 'none'
  }
  try {
    if (!safeStorage.isEncryptionAvailable()) return 'unreadable'
    safeStorage.decryptString(buf)
    return 'ok'
  } catch {
    return 'unreadable'
  }
}

export async function loadToken(): Promise<string | null> {
  // 未保存・鍵が変わった・壊れた —— どれも「無い」として扱う
  return (await readStored())?.token ?? null
}

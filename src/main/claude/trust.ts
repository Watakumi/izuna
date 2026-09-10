import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingSource } from '@anthropic-ai/claude-agent-sdk'
import {
  hookEventsIn,
  hookFilesFor,
  hooksRefusal,
  isTrusted,
  MCP_FILE,
  mcpCommandsIn,
  type FoundHooks
} from '../../shared/hooks'
import { CONFIG_PATH, resolved } from '../config'

/**
 * リポジトリを開く前の関所。判定は `shared/hooks.ts`、ここは読むだけ。
 *
 * **hook が無ければ何も聞かない。** 毎回聞くと、いずれ全部「はい」になる。
 */
export async function findProjectHooks(
  cwd: string,
  sources: readonly SettingSource[]
): Promise<FoundHooks[]> {
  const out: FoundHooks[] = []
  const look = async (file: string, count: (text: string) => string[]): Promise<void> => {
    let text: string
    try {
      text = await readFile(join(cwd, file), 'utf8')
    } catch {
      return // 無いのが普通
    }
    const events = count(text)
    if (events.length > 0) out.push({ file, events })
  }
  for (const file of hookFilesFor(sources)) await look(file, hookEventsIn)
  // `.mcp.json` はプロジェクトの設定と一緒に読まれる
  if (sources.includes('project')) await look(MCP_FILE, mcpCommandsIn)
  return out
}

/** 信頼していない場所に hook があれば止める。通れば読む出どころを返す */
export async function gateProjectHooks(cwd: string): Promise<SettingSource[]> {
  const { settingSources, trustedRepos } = await resolved()
  if (isTrusted(cwd, trustedRepos)) return settingSources
  const found = await findProjectHooks(cwd, settingSources)
  if (found.length > 0) throw new Error(hooksRefusal(cwd, found, CONFIG_PATH))
  return settingSources
}

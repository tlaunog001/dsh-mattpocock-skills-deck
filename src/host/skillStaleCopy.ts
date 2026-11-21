/**
 * src/host/skillStaleCopy.ts —— 判定「用户级 ~/.agents/skills 下的技能副本是否比随包旧」（#1973）。
 *
 * 为什么要有它：deck 的技能解析把用户级目录排在随包之前，于是 `~/.agents/skills` 里的旧副本会
 *   静默遮蔽随包新版，让随包的术语与流程修正（如 #1206 的 GLOSSARY 改名）全部失效；而照插件
 *   安装引导把技能装进该目录的用户恰恰是大多数，他们不会再触发安装引导，也就看不到提醒。
 *   skillProbe 会在命中时据此决定要不要提一句遮蔽提示。
 *
 * 为什么判据是 GLOSSARY/CONTEXT 而不是 hash 或 mtime：
 *   - hash 清单住在 tests/，不进发布包；为一条提示把它抬成运行时资产不值得；
 *   - mtime 不可靠（复制、解压、跨盘搬运都会重置）；
 *   - #1206 之后随包 SKILL.md 用 GLOSSARY、旧副本用 CONTEXT，这个差异稳定且单文件可读。
 *   只有「随包含 GLOSSARY 而用户级完全不含」才算陈旧，反过来不乱判。
 *
 * 为什么缓存：一次会话里技能副本不会变；按技能名记一份布尔值，命中判定的开销降到零。
 *   技能装/卸的失效广播会让 skillProbe 重探，届时旧条目自然被新结论取代。
 */
// 本域 tsconfig 有意不加载任何类型包（types 为空），Node 内建模块的类型声明随 @types/node 一起被挡在门外；
// 运行时一定是 Node，这些模块必然存在。与 rpcChannel.ts 同一处理：只忽略导入行的类型错误，不影响转译。
// @ts-expect-error
import { readFileSync, statSync } from 'node:fs'
// @ts-expect-error
import path from 'node:path'
// @ts-expect-error
import { fileURLToPath } from 'node:url'

const cache = new Map<string, boolean>()

/** 随包同名技能 SKILL.md 的候选位置：装机产物与源码树两种布局都要认。 */
function bundledCardPaths(skillName: string): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const roots = [
    path.dirname(here),
    path.join(path.dirname(path.dirname(here)), 'package'),
  ]
  const out: string[] = []
  for (const root of roots) {
    out.push(path.join(root, 'bundled-skills', skillName, 'SKILL.md'))
    out.push(path.join(root, 'bundled-skills-zh', skillName, 'SKILL.md'))
  }
  return out
}

/** 读一份名片；读不到回 null（调用方据此"不判"，不据此"判新"）。 */
function readCard(p: string): string | null {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

/** 换行归一后判等：跨平台检出/复制会改 CRLF，那不是内容漂移。 */
function sameContent(a: string, b: string): boolean {
  return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n')
}

/**
 * 这个技能的「用户级副本」是否比随包旧。
 *
 * 判据（#1973 第二轮修正）：**内容比对**，不是特征词。
 *   上一版只看「随包含 GLOSSARY 而用户级不含」，等于把一次具体事故（#1206 改名）编码成了检测条件——
 *   凡是没被那次改名波及的技能（wayfinder / code-review / grilling …）永远不会被判陈旧，
 *   而它们同样会漂移（下游实测 25 个技能里 24 个的 SKILL.md 与随包不一致，其中就包括它们）。
 *   现在直接比 SKILL.md 的内容：与随包同名名片不一致即为陈旧。这样覆盖面自动扩到全部技能、
 *   以及未来任何改名或流程修正，不需要维护清单。
 *
 * 仍然「不触盘判绿」：本函数是 skillProbe 之外的独立模块，由装配点注入；skillProbe 只拿布尔值。
 *
 * @param skillName 技能名
 * @param foundPath 注册表给出的命中路径（技能目录，或目录下的 SKILL.md）
 */
export function isStaleUserCopy(skillName: unknown, foundPath: unknown): boolean {
  const name = String(skillName || '')
  if (!name) return false
  const dir = path.dirname(String(foundPath || ''))
  const mine = readCard(path.join(dir, 'SKILL.md'))
  // 读不到用户级名片：无从判断，不判陈旧（宁可少提示，不误报）。
  if (mine === null) return false
  // 缓存键带用户副本的 mtime：下游按提示刷新过 ~/.agents/skills 之后，不重启也能自动转绿。
  let stamp = ''
  try { stamp = String(statSync(path.join(dir, 'SKILL.md')).mtimeMs) } catch { stamp = '0' }
  const key = name + '|' + String(foundPath || '') + '|' + stamp
  if (cache.has(key)) return cache.get(key) === true
  let stale = false
  try {
    let buddy: string | null = null
    for (const bp of bundledCardPaths(name)) { buddy = readCard(bp); if (buddy !== null) break }
    // 随包没有这个技能（自定义技能）：无从判断，不判陈旧。
    if (buddy !== null) stale = !sameContent(buddy, mine)
  } catch { stale = false }
  cache.set(key, stale)
  return stale
}

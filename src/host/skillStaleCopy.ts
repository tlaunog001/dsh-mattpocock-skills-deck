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
import { readFileSync } from 'node:fs'
// @ts-expect-error
import path from 'node:path'
// @ts-expect-error
import { fileURLToPath } from 'node:url'

const cache = new Map<string, boolean>()

/** 随包同名技能 SKILL.md 的候选位置：插件安装目录下的 bundled-skills / bundled-skills-zh。 */
function bundledCardPaths(skillName: string): string[] {
  // 两种布局都要认：
  //   装机产物 <pkg>/lib/skillStaleCopy.js       → 随包目录在 <pkg>/bundled-skills/
  //   源码树   <repo>/src/host/skillStaleCopy.ts → 随包目录在 <repo>/package/bundled-skills/
  // 只认前者会让源码树里的测试读不到随包名片，判定恒 false。
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

/**
 * 这个技能的「用户级副本」是否确实比随包旧（只在能确证时返回 true）。
 * @param skillName 技能名
 * @param foundPath 注册表给出的命中路径（技能目录，或目录下的 SKILL.md）
 */
export function isStaleUserCopy(skillName: unknown, foundPath: unknown): boolean {
  const name = String(skillName || '')
  if (!name) return false
  // 缓存键带命中路径：同一技能可能先从标准根命中、后从随包目录命中（换后端/换安装位置），
  //   只按技能名缓存会把前一次的结论错误地套到后一次上。
  const key = name + '|' + String(foundPath || '')
  if (cache.has(key)) return cache.get(key) === true
  let stale = false
  try {
    let buddy = ''
    for (const p of bundledCardPaths(name)) {
      try { buddy = readFileSync(p, 'utf8'); break } catch {}
    }
    // 随包没有这个技能（自定义技能）或随包也不用 GLOSSARY：无从判断，不判陈旧。
    if (buddy && /GLOSSARY/.test(buddy)) {
      const dir = path.dirname(String(foundPath || ''))
      let mine = ''
      try { mine = readFileSync(path.join(dir, 'SKILL.md'), 'utf8') } catch {}
      // 读不到用户级名片时不判陈旧——宁可少提示，不要误报。
      if (mine) stale = !/GLOSSARY/.test(mine)
    }
  } catch { stale = false }
  cache.set(key, stale)
  return stale
}

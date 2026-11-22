// #1975 回归：宿主 repoKeys 缓存不能永久有效，否则「外部改了 origin」对它完全不可见。
//  下游实况：把镜像 .git 的 origin 从已删的 tlaunog001/models 改成 inference-deployment，
//  服务端存储全部干净、页面硬刷新也无效，面板仍拿缓存里的 models 反复请求（404），
//  read.degraded 打不停——那是宿主进程内存里的 repoKeys，只有重启或走建仓流程才清。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-repo-key-cache-revalidate.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'src', 'refresh', 'rooms', 'host', 'git-execution.ts'), 'utf8')

test('#1975 缓存有校验时刻与信任窗口（不再永久有效）', () => {
  assert.ok(src.includes('repoKeyCheckedAt'), '应有按工作区的校验时刻表')
  assert.ok(src.includes('REPO_KEY_TRUST_MS'), '应有信任窗口常量')
  assert.ok(/nowMs - checkedAt\) < REPO_KEY_TRUST_MS/.test(src), '窗口内才直接用缓存')
})

test('#1975 三处写入缓存都必须更新时间戳', () => {
  const n = (src.match(/repoKeyCheckedAt\[key\] = Date\.now\(\)/g) || []).length
  assert.ok(n >= 3, 'tier1/tier2/tier3 三处写入都要记时间戳，实际 ' + n + ' 处')
})

test('#1975 重验失败时保留旧缓存，不突然「认不出仓库」', () => {
  const i = src.indexOf('if (repoKeys[key]) {\n        repoKeyCheckedAt[key] = Date.now()')
  assert.ok(i > 0, '失败路径应继续返回旧缓存并刷新校验时刻')
})

test('#1975 窗口不应过长（下游一拍 5 秒，必须能在分钟级纠正）', () => {
  const m = src.match(/REPO_KEY_TRUST_MS = (\d+)/)
  assert.ok(m, '应能取到常量值')
  const v = Number(m![1])
  assert.ok(v > 0 && v <= 120000, '窗口应在 (0, 120s]，实际 ' + v)
})

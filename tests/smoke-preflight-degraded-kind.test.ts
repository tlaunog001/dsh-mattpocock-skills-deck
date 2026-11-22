// #1975 补充回归：preflight 的两条降级事件原来不传 kind，现场只有空串。
//  下游实测到 latencyMs=15,043ms（正好是 SSH connectTimeoutMs 15s）而 kind=""，
//  分不清是「建连丢包」还是「仓库真不存在」——这正是 beta.43 只修了 listPage、漏了 preflight 的地方。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-preflight-degraded-kind.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'src', 'tracker', 'rooms', 'github', 'read', 'preflight.ts'), 'utf8')

test('#1975 preflight:repo-view 带上游 gh 失败的 kind', () => {
  const i = src.indexOf("'preflight:repo-view'")
  assert.ok(i > 0, '应有该降级点')
  const around = src.slice(i, i + 260)
  assert.ok(around.includes('kind:'), '应传 kind，实际: ' + around.slice(0, 180))
  // gh repo view 的失败结果要先留住，才能在后面的分支里取 kind
  assert.ok(src.includes('viewErr'), '应把 gh repo view 的 error 留住')
})

test('#1975 preflight:api 带上 r.error 的 kind', () => {
  const i = src.indexOf("'preflight:api'")
  assert.ok(i > 0, '应有该降级点')
  const around = src.slice(i, i + 240)
  assert.ok(/kind: \(r\.error/.test(around), '应从 r.error 取 kind，实际: ' + around.slice(0, 180))
})

test('#1975 两条降级都不新增日志键（沿用既有 kind 格）', () => {
  // 门禁按键集合比对，不得出现 errorKind 之类的新键
  assert.ok(!/emitReadDegraded\([^)]*preflight[^)]*errorKind/.test(src), '不得新增 errorKind 键')
  assert.ok(!/emitReadDegraded\([^)]*preflight[^)]*exitCode/.test(src), '不得新增 exitCode 键')
})

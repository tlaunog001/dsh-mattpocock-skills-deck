// #1975 回归：探测**失败**也要升一级退避，否则持续失败的读通路会一直按原节拍打下去。
//  下游实测：远端镜像工作区里 listPage:transport 与 wf.probe not-found 各 170 次、成对发生，
//  1 分钟约 25 次、13 分钟不衰减 —— 正是旧实现 `if (!res || res.ok !== true) return;` 漏掉的那条。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-probe-backoff-on-failure.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'src', 'refresh', 'rooms', 'client', 'client-attention-heartbeat.ts'), 'utf8')

test('#1975 探测失败会升一级退避（不再直接 return）', () => {
  const i = src.indexOf('export const noteProbeReply')
  assert.ok(i > 0, '应有 noteProbeReply')
  const body = src.slice(i, i + 1200)
  // 失败分支必须包含升档动作，而不是裸 return
  const failBranch = body.slice(body.indexOf('if (!res || res.ok !== true)'), body.indexOf('if (res.changed === true'))
  assert.ok(failBranch.includes('_probeBackoff.step += 1'), '失败分支应升档，实际: ' + failBranch.slice(0, 200))
  assert.ok(!/if \(!res \|\| res\.ok !== true\) return;/.test(body), '不得再有「失败直接 return」的写法')
})

test('#1975 失败不清零退避（否则持续失败会按最快节拍打）', () => {
  const i = src.indexOf('export const noteProbeReply')
  const body = src.slice(i, i + 1200)
  const failBranch = body.slice(body.indexOf('if (!res || res.ok !== true)'), body.indexOf('if (res.changed === true'))
  assert.ok(!failBranch.includes('resetProbeBackoff'), '失败分支不得复位退避')
})

test('#1975 成功且有变化仍会复位（原有行为不变）', () => {
  const i = src.indexOf('export const noteProbeReply')
  const body = src.slice(i, i + 1200)
  assert.ok(body.includes("res.changed === true || res.mode === 'deferred'"), '变化/延迟那一路仍复位')
  assert.ok(body.includes('resetProbeBackoff()'), '复位逻辑仍在')
})

test('#1975 前台拍仍直接复位（原有行为不变）', () => {
  const i = src.indexOf('export const noteProbeReply')
  const body = src.slice(i, i + 400)
  assert.ok(body.includes('if (!background) { resetProbeBackoff(); return; }'), '前台拍复位保持不变')
})

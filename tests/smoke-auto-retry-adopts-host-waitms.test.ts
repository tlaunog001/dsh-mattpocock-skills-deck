// #1975 回归：客户端的链复查冷却必须采纳宿主算出的 waitMs，而不是只用自己的固定 STEP_WAIT_MS。
//  下游证据：宿主 chain-backoff 明确回 not-green-too-soon / waitMs≈292-295s，客户端仍 30 秒（甚至 5 秒）再问，
//  每次再问都跑 preflight(3 gate)+listPage → read.degraded 稳定 ~13 次/分不衰减；而 probe.loop 早已退到 50 秒。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-auto-retry-adopts-host-waitms.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const subSrc = readFileSync(path.join(here, '..', 'src', 'refresh', 'rooms', 'client', 'probe-chain-subscription.ts'), 'utf8')
const timerSrc = readFileSync(path.join(here, '..', 'src', 'refresh', 'rooms', 'client', 'refresh-timer.ts'), 'utf8')

test('#1975 冷却取 max(STEP_WAIT_MS, 宿主 waitMs)', () => {
  assert.ok(subSrc.includes('waitMsByKey'), '应有按 key 记 waitMs 的结构')
  assert.ok(subSrc.includes('Math.max(STEP_WAIT_MS'), '冷却应取二者较大值')
  assert.ok(/hostWait/.test(subSrc), '应显式读宿主给的等待时长')
})

test('#1975 回包后记录宿主 waitMs（hit.waitMs）', () => {
  assert.ok(subSrc.includes('r.hit && r.hit.waitMs') || subSrc.includes('hit.waitMs'), '应从 hit.waitMs 取值')
  assert.ok(subSrc.includes('_autoRetryState.waitMsByKey.set'), '应写入 waitMsByKey')
})

test('#1975 setup-pending 复查走「判+记+发」入口（只判不记等于没改）', () => {
  // 第一版只加了「判」不写 atByKey，冷却永远不成立——这条断言就是防那个坑回潮
  assert.ok(timerSrc.includes('autoRetryChainOnce'), 'setup-pending 应走带记账的入口')
  // 但有例外必须保留：接线缺失（夹具/老接线）时要回退到原样直发，
  //   否则会打破 #1363「活跃节拍每拍带 setup-pending 让链重算」——那修的是「初始化卡住永远不推进」。
  assert.ok(timerSrc.includes('_hasOnce'), '应区分「接线在不在」')
  const iFallback = timerSrc.indexOf('if (!_hasOnce)')
  const iDirect = timerSrc.indexOf("chainEventRefresh(st, 'setup-pending')")
  assert.ok(iFallback > 0 && iDirect > iFallback, '直发只应出现在接线缺失的回退分支里')
})

test('#1975 autoRetryChainOnce 必须记账（atByKey + waitMsByKey）', () => {
  const i = subSrc.indexOf('export const autoRetryChainOnce')
  assert.ok(i > 0, '应有该入口')
  const body = subSrc.slice(i, i + 1600)
  assert.ok(body.includes('atByKey.set'), '发之前要记发起时刻')
  assert.ok(body.includes('waitMsByKey.set'), '回包要记 waitMs')
  assert.ok(body.includes('inFlightByKey'), '要有单飞保护')
})

test('#1975 只判不记的那个口仍然只判不记（给不发请求的调用方用）', () => {
  const i = subSrc.indexOf('export const maybeAutoRetryChainCooldownOk')
  assert.ok(i > 0, '保留该函数')
  const body = subSrc.slice(i, i + 900)
  assert.ok(!body.includes('atByKey.set'), '它不得写 atByKey')
})

test('#1975 冷却判断只判不记（不把冷却窗提前推后）', () => {
  const i = subSrc.indexOf('export const maybeAutoRetryChainCooldownOk')
  assert.ok(i > 0, '应有该函数')
  const body = subSrc.slice(i, i + 900)
  assert.ok(!body.includes('atByKey.set'), '只判不记：不得在判断函数里写 atByKey')
})

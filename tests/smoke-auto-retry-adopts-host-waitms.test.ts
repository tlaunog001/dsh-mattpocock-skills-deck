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

test('#1975 setup-pending 复查也走冷却（不再每拍直发）', () => {
  assert.ok(timerSrc.includes('maybeAutoRetryChainCooldownOk'), 'setup-pending 应先问冷却')
  const iGate = timerSrc.indexOf('maybeAutoRetryChainCooldownOk(st)')
  const iFire = timerSrc.indexOf("chainEventRefresh(st, 'setup-pending')")
  assert.ok(iGate > 0 && iFire > iGate, '冷却判断要在发起之前，实际: gate=' + iGate + ' fire=' + iFire)
})

test('#1975 冷却判断只判不记（不把冷却窗提前推后）', () => {
  const i = subSrc.indexOf('export const maybeAutoRetryChainCooldownOk')
  assert.ok(i > 0, '应有该函数')
  const body = subSrc.slice(i, i + 900)
  assert.ok(!body.includes('atByKey.set'), '只判不记：不得在判断函数里写 atByKey')
})

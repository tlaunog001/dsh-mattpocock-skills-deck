// #1975 回归：listPage:transport 降级事件必须带上错误分类，不能只记「transport」四个字。
//  现场痛点：日志里只有 op/reason/latencyMs/opId，分不清 SSH 掉线 / gh 退出码非零 / JSON 解析失败。
//  修法：用既有 kind 格（#1418 定义的短枚举格）携带 r.error.kind，不新增日志键（门禁按键集合比对）。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-read-degraded-error-kind.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pageSrc = readFileSync(path.join(here, '..', 'src', 'tracker', 'rooms', 'github', 'read', 'page.ts'), 'utf8')
const logSrc = readFileSync(path.join(here, '..', 'src', 'tracker', 'rooms', 'github', 'support', 'read-log.ts'), 'utf8')

test('#1975 listPage:transport 调用点把错误 kind 交出去', () => {
  const i = pageSrc.indexOf("'listPage:transport'")
  assert.ok(i > 0, '应有该降级点')
  const around = pageSrc.slice(i, i + 400)
  assert.ok(around.includes('kind:'), '应传 kind 字段，实际片段: ' + around.slice(0, 200))
  assert.ok(/r\.error/.test(around), 'kind 应取自 r.error')
})

test('#1975 read.degraded 的 kind 格本来就是给分类用的（不新增日志键）', () => {
  assert.ok(logSrc.includes('kind:'), '事件应含 kind 键')
  assert.ok(logSrc.includes('limitBefore'), '既有键保持不变')
  // 不得为这条修复新增 errorKind/exitCode 之类的新键（门禁按键集合比对，缺键会红）
  assert.ok(!/logEvent\('warn', 'read\.degraded',[\s\S]{0,400}errorKind/.test(logSrc), '不得新增 errorKind 键')
  assert.ok(!/logEvent\('warn', 'read\.degraded',[\s\S]{0,400}exitCode/.test(logSrc), '不得新增 exitCode 键')
})

test('#1975 不再残留误用的未来编号注释（那批已改成描述性）', () => {
  // 源码里 #1975 现在只应指向本票（吞错/日志），不应再出现在「展开失败」「设置未知字段」那几处
  const detSrc = readFileSync(path.join(here, '..', 'src', 'client', 'statusbar', 'deckDoor.ts'), 'utf8')
  assert.ok(!detSrc.includes('#1975'), 'deckDoor 不该再引用 #1975（那是展开失败的注释）')
})

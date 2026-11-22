// #1975 回归：设置文件里多出来的字段不得让整份读取失败。
// 真实事故：新版写入 workspaces[].suggest，旧版 WS_KEYS 不认 → parseSettings 判 unknown-keys
//   → 整份文件读不出 → wf.getSettings 恒失败 → 胶囊展开与所有界面开关静默失效（67 次点击 zero 反馈）。
// 修法要求两件事同时成立：① 不整份拒绝；② 未知字段原样保留（补丁写以归一结果为 base 合并，丢了就写没）。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-settings-unknown-keys.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSettings, mergeSettingsPatch } from '../src/shared/config-store/src/settings.js'

const base = () => ({
  version: 1,
  ui: { stateFilter: '', sortKey: '', sortDir: '', labelClicks: {} },
  workspaces: {
    '/w/qqq': { statusBar: 'show', deckTools: 'on', suggest: 'on', noRepoDismissed: false, subwsMarkAutoShown: false },
  },
  debug: { enabled: false, sampleRate: 0 },
  templates: {},
})

test('#1975 已知字段全部认识时正常读', () => {
  const r = parseSettings(base()) as any
  assert.equal(r.ok, true)
  assert.deepEqual(r.warnings, [])
})

test('#1975 顶层多出未知字段：不再整份拒绝，且原样保留', () => {
  const doc: any = { ...base(), futureTop: { a: 1 } }
  const r = parseSettings(doc) as any
  assert.equal(r.ok, true, '不得整份拒绝')
  assert.equal((r.value as any).futureTop, doc.futureTop, '未知字段必须原样带回（否则补丁写会抹掉它）')
  assert.ok(r.warnings.some((w: string) => w.includes('futureTop')), '应记告警')
})

test('#1975 ui 节多出未知字段：保留并告警', () => {
  const doc: any = base()
  doc.ui.futureUi = 'x'
  const r = parseSettings(doc) as any
  assert.equal(r.ok, true)
  assert.equal((r.value as any).ui.futureUi, 'x')
  assert.ok(r.warnings.some((w: string) => w.includes('futureUi')))
})

test('#1975 workspaces 每条多出未知字段：保留并告警（真实事故的形态）', () => {
  const doc: any = base()
  doc.workspaces['/w/qqq'].futureSwitch = 'on'
  const r = parseSettings(doc) as any
  assert.equal(r.ok, true, '这正是 workspaces[].suggest 那类场景，不能整份失败')
  assert.equal((r.value as any).workspaces['/w/qqq'].futureSwitch, 'on')
  assert.ok(r.warnings.some((w: string) => w.includes('futureSwitch')))
})

test('#1975 补丁写以归一结果为 base：未知字段不会因一次写入而消失', () => {
  const doc: any = base()
  doc.workspaces['/w/qqq'].futureSwitch = 'on'
  const first = parseSettings(doc) as any
  assert.equal(first.ok, true)
  // 模拟一次补丁写：改 statusBar，其余原样
  const merged = mergeSettingsPatch(first.value, { workspaces: { '/w/qqq': { statusBar: 'hide' } } }) as any
  assert.equal(merged.ok, true, JSON.stringify(merged).slice(0, 200))
  assert.equal((merged.value as any).workspaces['/w/qqq'].futureSwitch, 'on', '未知字段必须活过一次写入')
  assert.equal((merged.value as any).workspaces['/w/qqq'].statusBar, 'hide', '本次改动要生效')
})

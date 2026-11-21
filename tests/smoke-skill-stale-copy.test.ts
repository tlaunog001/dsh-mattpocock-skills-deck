// #1973 回归：遮蔽提示只在「用户级副本确实比随包旧」时出现，不再对健康安装必现告警。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-skill-stale-copy.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// 动态导入：本文件被测函数是纯同步的，但源码用 .ts，钩子会把 .js 说明符改指 .ts。
const mod = await import('../src/host/skillStaleCopy.js')
const isStaleUserCopy = (mod as any).isStaleUserCopy as (n: unknown, p: unknown) => boolean

test('随包没有该技能（自定义技能）：不判陈旧', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  writeFileSync(path.join(dir, 'SKILL.md'), '# custom\n')
  try { assert.equal(isStaleUserCopy('definitely-not-a-bundled-skill-xyz', path.join(dir, 'SKILL.md')), false) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})

test('读不到用户级名片：不判陈旧（宁可少提示，不误报）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  try { assert.equal(isStaleUserCopy('triage', path.join(dir, 'missing', 'SKILL.md')), false) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})

test('用户级名片不含 GLOSSARY 而随包含：判陈旧', () => {
  // triage 是随包技能；伪造一个只有 CONTEXT 的用户级副本。
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  writeFileSync(path.join(dir, 'SKILL.md'), '# triage\nsee CONTEXT.md\n')
  try { assert.equal(isStaleUserCopy('triage', path.join(dir, 'SKILL.md')), true) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})

test('用户级名片含 GLOSSARY（新版健康安装）：不判陈旧', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  writeFileSync(path.join(dir, 'SKILL.md'), '# triage\nsee GLOSSARY.md\n')
  try { assert.equal(isStaleUserCopy('triage', path.join(dir, 'SKILL.md')), false) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})

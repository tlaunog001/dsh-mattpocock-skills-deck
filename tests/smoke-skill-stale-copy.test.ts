// #1973 回归：陈旧判定必须覆盖**全部**技能，而不是只覆盖被 GLOSSARY 改名波及的那几个。
// 下游实测：判据用特征词时，wayfinder / code-review / grilling 这类没被改名波及的技能
// 永远判不陈旧，而它们同样会漂移（25 个技能里 24 个与随包不一致，其中就包括它们）。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-skill-stale-copy.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const mod = await import('../src/host/skillStaleCopy.js')
const isStaleUserCopy = (mod as any).isStaleUserCopy as (n: unknown, p: unknown) => boolean

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bundled = (skill: string, lang = '') => path.join(repoRoot, 'package', lang ? `bundled-skills-${lang}` : 'bundled-skills', skill, 'SKILL.md')

function withUserCard(skill: string, content: string, fn: (cardPath: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  try {
    writeFileSync(path.join(dir, 'SKILL.md'), content)
    fn(path.join(dir, 'SKILL.md'))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('与随包内容一致 → 不陈旧（健康安装不再告警）', () => {
  const buddy = readFileSync(bundled('triage'), 'utf8')
  withUserCard('triage', buddy, (p) => assert.equal(isStaleUserCopy('triage', p), false))
})

test('与随包内容不一致 → 陈旧（GLOSSARY 改名波及的技能）', () => {
  withUserCard('triage', '# triage\nsee CONTEXT.md\n', (p) => assert.equal(isStaleUserCopy('triage', p), true))
})

test('没被 GLOSSARY 改名波及的技能（wayfinder）也判得出陈旧 —— 旧判据的盲区', () => {
  const buddy = readFileSync(bundled('wayfinder'), 'utf8')
  // 随包名片里本就不含 GLOSSARY；旧判据据此直接 return false，永远发现不了漂移。
  const drifted = buddy.replace(/\n/, '\n<!-- 用户级副本被改过 -->\n')
  assert.notEqual(drifted, buddy, '前置：构造的副本确实与随包不同')
  withUserCard('wayfinder', drifted, (p) => assert.equal(isStaleUserCopy('wayfinder', p), true))
})

test('code-review / grilling 同样覆盖', () => {
  for (const s of ['code-review', 'grilling']) {
    const buddy = readFileSync(bundled(s), 'utf8')
    withUserCard(s, buddy + '\n<!-- drift -->\n', (p) => assert.equal(isStaleUserCopy(s, p), true, s + ' 应判陈旧'))
  }
})

test('随包没有的技能：不判陈旧', () => {
  withUserCard('definitely-not-bundled-xyz', '# custom\n', (p) => assert.equal(isStaleUserCopy('definitely-not-bundled-xyz', p), false))
})

test('读不到用户级名片：不判陈旧（不误报）', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  try { assert.equal(isStaleUserCopy('triage', path.join(dir, 'missing', 'SKILL.md')), false) }
  finally { rmSync(dir, { recursive: true, force: true }) }
})

test('刷新用户副本后（mtime 变化）不重启也能自动转绿', () => {
  const buddy = readFileSync(bundled('tdd'), 'utf8')
  const dir = mkdtempSync(path.join(tmpdir(), 'stale-'))
  try {
    const card = path.join(dir, 'SKILL.md')
    writeFileSync(card, '# tdd old\n')
    assert.equal(isStaleUserCopy('tdd', card), true, '首次：陈旧')
    // 模拟"按提示刷新"：内容换成随包版本、mtime 前移（mtime 参与缓存键，必须变）
    writeFileSync(card, buddy)
    const t = new Date(Date.now() + 5000)
    utimesSync(card, t, t)
    assert.equal(isStaleUserCopy('tdd', card), false, '刷新后：自动转绿')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

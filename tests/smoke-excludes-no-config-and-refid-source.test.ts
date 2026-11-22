// 稳定检查点两条遗留项的回归：
//  ① core.excludesFile 副作用：仓库级单值会顶掉用户全局忽略表 → 不得再写它，只追加 .git/info/exclude
//  ② refId 来源：日志里要能分清「读到的」与「gh user + 目录名推出来的」
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-excludes-no-config-and-refid-source.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const initSrc = readFileSync(path.join(here, '..', 'src', 'tracker', 'rooms', 'github', 'write', 'init-project.ts'), 'utf8')
const detSrc = readFileSync(path.join(here, '..', 'src', 'tracker', 'detection', 'detectionService.ts'), 'utf8')

test('① 不再写 core.excludesFile（不顶掉用户的全局忽略表）', () => {
  // 只允许出现在注释里说明"曾经的错误做法"，不允许有真正的 config 调用
  const calls = initSrc.split('\n').filter((l) => l.includes('core.excludesFile') && !l.trim().startsWith('//'))
  assert.equal(calls.length, 0, '不得调用 core.excludesFile，实际: ' + calls.join(' | '))
})

test('① 仍然向 .git/info/exclude 追加排除规则，且在建仓前', () => {
  assert.ok(initSrc.includes('info/exclude'), '应写 info/exclude')
  for (const pat of ['.dsh-remote-meta.json', '.dsh-mattskillsdeck-cache/', '*.sqlite']) {
    assert.ok(initSrc.includes(pat), '排除清单应含 ' + pat)
  }
  const iExcl = initSrc.indexOf('info/exclude')
  const iAdd = initSrc.indexOf("'add', '.'")
  assert.ok(iExcl > 0 && iExcl < iAdd, '排除要在 git add 之前')
})

test('① 用 git rev-parse --git-path info/exclude 定位（--git-dir 在 worktree 下会指错）', () => {
  assert.ok(initSrc.includes("'rev-parse', '--git-path', 'info/exclude'"), '应以 --git-path 为准')
  // --git-dir 在 worktree 里给的是 .git/worktrees/<name>，那不是 git 实际读的排除文件
  assert.ok(!initSrc.includes("'rev-parse', '--git-dir'], cwd)\n      const gdPath"), '不应再用 --git-dir 拼路径')
})

test('② refId 来源有明确四档，且写进日志', () => {
  for (const v of ["'selection'", "'resolver'", "'derived'", "'none'"]) {
    assert.ok(detSrc.includes(v), '应含来源档 ' + v)
  }
  assert.ok(detSrc.includes('detection.refid.source'), '应发来源日志')
  assert.ok(detSrc.includes('refIdSource'), '应把来源带进日志字段')
})

test('② 不可信的那一档要能在默认配置下看到（不能一律 debug）', () => {
  // 下游指出：一律 debug 等于「最需要它时恰好没有」（本机默认 debug.enabled=false）
  assert.ok(detSrc.includes("const suspicious = (refIdSource === 'derived')"), 'derived 应为可疑档')
  assert.ok(detSrc.includes("suspicious ? 'info' : 'debug'"), '可疑档落 info、其余落 debug')
})

test('② 来源判定与三条取值分支对应（不是写死）', () => {
  const iSel = detSrc.indexOf("refIdSource = 'selection'")
  const iRes = detSrc.indexOf("refIdSource = (repoHandle && repoHandle.refId) ? 'resolver' : 'none'")
  const iDer = detSrc.indexOf("refIdSource = (repoHandle && repoHandle.refId) ? 'derived' : 'none'")
  assert.ok(iSel > 0 && iRes > 0 && iDer > 0, '三档都应出现')
  assert.ok(iSel < iRes && iRes < iDer, '顺序应与取值分支一致')
})

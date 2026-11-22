// #1974 回归：远端镜像工作区不得建仓；git add 之前必须硬排除 DSH 内部产物。
// 真实事故：镜像里没有 .git → 「识别不到仓库」被当成「该建一个仓库」→
//   `gh repo create <目录名> --source=. --push` 把 .dsh-remote-meta.json（内网主机/账号/路径）
//   与插件快照库 *.sqlite* 一起推上 GitHub，不可逆。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-init-project-remote-mirror.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(here, '..', 'src', 'tracker', 'rooms', 'github', 'write', 'init-project.ts'), 'utf8')

test('#1974 存在镜像判据函数，且不依赖 remote-exec 服务', () => {
  assert.ok(src.includes('function isRemoteMirrorWorkspace'), '应有镜像判据')
  // 刻意不用 ctx.get('remoteFs')：没装 remote-exec 时判据也必须有效
  const body = src.slice(src.indexOf('function isRemoteMirrorWorkspace'), src.indexOf('/** 开仓发布的本体'))
  assert.ok(!/ctx\.get\(\s*['"]remoteFs/.test(body), '判据不得依赖 remote-exec 提供的能力')
  assert.ok(body.includes('remote-workspaces'), '应认 dsh-remote 的镜像根布局')
})

test('#1974 镜像工作区在建仓前被拒（且在 preflight 之后、git add 之前）', () => {
  const iPre = src.indexOf('await preflightWorkspaceGit(git, cwd)')
  const iGuard = src.indexOf('if (isRemoteMirrorWorkspace(cwd))')
  const iAdd = src.indexOf("'add', '.'")
  assert.ok(iGuard > 0, '应有拦截')
  assert.ok(iPre > 0 && iGuard > iPre, '拦截要在 preflight 之后')
  assert.ok(iAdd > iGuard, '拦截必须在 git add . 之前（否则已经把文件扫进去了）')
  assert.ok(src.includes('不能在这里新建仓库'), '应给出可操作的拒绝文案')
})

test('#1974 git add 之前写入 DSH 内部产物的硬排除', () => {
  for (const pat of ['.dsh-remote-meta.json', '.dsh-mattskillsdeck-cache/', '*.sqlite', '*.sqlite-shm', '*.sqlite-wal']) {
    assert.ok(src.includes(pat), '排除清单应含 ' + pat)
  }
  const iExcl = src.indexOf('.git/info/exclude')
  const iAdd = src.indexOf("'add', '.'")
  assert.ok(iExcl > 0 && iExcl < iAdd, '排除规则要在 git add . 之前生效')
})

test('#1974 排除规则不写进用户的 .gitignore（用 .git/info/exclude，本地生效）', () => {
  assert.ok(src.includes('info/exclude'), '应写 .git/info/exclude')
  assert.ok(!/appendFileSync\([^)]*\.gitignore/.test(src), '不得改动用户的 .gitignore')
})

test('#1974 判据行为：各平台路径形态（用真源码跑，不是复写副本）', () => {
  const start = src.indexOf('function isRemoteMirrorWorkspace')
  const end = src.indexOf('/** 开仓发布的本体')
  let fnSrc = src.slice(start, end).trim()
    .replace(/^function isRemoteMirrorWorkspace\(cwd: string\): boolean \{/, 'return function(cwd){')
    .replace(/\n\}\s*$/, '\n}')
  const isRemote = new Function(fnSrc)() as (cwd: string) => boolean
  const cases: Array<[string, boolean]> = [
    ['/Users/admin/.dsh/remote-workspaces/192.168.10.201-jx-22/qqq', true],
    ['C:\\Users\\DELL\\.dsh\\remote-workspaces\\192.168.10.200-jx-22\\vllm', true],
    ['D:/data/remote-workspaces/host-u-22/x', true],
    ['/Users/admin/pid-agent-dist', false],
    ['/Users/admin/.dsh/remote-workspaces', false],
    ['', false],
  ]
  for (const [p, want] of cases) {
    assert.equal(isRemote(p), want, JSON.stringify(p) + ' 期望 ' + want)
  }
})

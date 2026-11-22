// tests/verify-1975-repo-key-revalidate-nonblocking.ts —— 门禁：repoKeys 过期重验**绝不能在调用路径上等**（#1975）
//
// 用户看到的样子（beta.47/48 回归）：面板首屏正常，切到别的页签再切回来整块白屏，连顶栏都没有。
// 原因：beta.47 给 repoKeys 加了 60 秒信任窗口，过期就在 getRepoKey 里**同步**重跑
// `git remote get-url origin`；而 execProc 的等待上限是 STEP_WAIT_MS（30 秒）。远端镜像工作区里
// 那条 git 一旦挂住，所有走 getRepoKey 的渲染路径一起被吊住 —— 切回页签正好撞上窗口过期，于是白屏。
//
// 本门禁跑真源码（只把子进程换成「永远不返回」的假件），量三件事：
//   A. 缓存过期后 getRepoKey **立刻**返回旧值，不被挂住的 git 拖住（这是白屏的根因）。
//   B. 后台确实补了一次重验，且结果写回缓存供下一次用。
//   C. 同一个工作区并发多拍只跑一次重验（去重表生效），不会每拍起一个 git 进程。
//
// 门禁归属: src/refresh/rooms/host/git-execution.ts
//
// 用法（在插件根目录；不需要先构建，本门禁跑的是真源码）：
//   node --import ./scripts/ts-hook.mts tests/verify-1975-repo-key-revalidate-nonblocking.ts
import { createRepoKeys } from '../src/refresh/rooms/host/git-execution.ts'

let failed = false
let total = 0
const check = function (ok: unknown, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}
const sleep = function (ms: number): Promise<void> {
  return new Promise(function (resolve) { setTimeout(resolve, ms) })
}

const parseGithubRepo = function (text: string): any {
  const m = String(text || '').match(/github\.com[\/:]([^\/\s]+)\/([^\/\s]+?)(?:\.git)?\s*$/)
  return m ? { owner: m[1], name: m[2] } : null
}

// 一套假世界：子进程可以「正常答」也可以「永远不返回」（模拟远端镜像里挂住的 git）。
//   hang=true 时 spawn 返回的 done 永不落定，计时器也不落定 —— 就是白屏那个现场。
const makeWorld = function (opts: any): any {
  const spawned: any[] = []
  let remoteUrl = opts.remoteUrl
  const subprocess = {
    spawn: function (req: any): any {
      const argv = (req && req.argv) || []
      spawned.push(argv)
      const isRemoteGetUrl = argv.indexOf('remote') >= 0 && argv.indexOf('get-url') >= 0
      // hang 可动态切换：先让它正常答把缓存建起来，再打开 hang 模拟「重验那一条 git 挂住」。
      const hangThis = opts.hang === true
      let resolveDone: any = null
      const done = new Promise(function (resolve) { resolveDone = resolve })
      if (!hangThis) {
        const text = isRemoteGetUrl ? (remoteUrl + '\n') : ''
        setTimeout(function () { resolveDone({ exitCode: 0 }) }, 0)
        opts.allowFirst = true
      }
      const handle: any = {
        done: done,
        terminate: function (): void {},
        collected: {
          stdout: { readFrom: function () { return { text: isRemoteGetUrl ? (remoteUrl + '\n') : '' } } },
          stderr: { readFrom: function () { return { text: '' } } },
        },
      }
      return handle
    },
  }
  // 计时器永不落定：execProc 的 race 就永远停在「等 git」上 —— 正是要复现的阻塞。
  const timer = { timeout: function (_ms: number): any { return new Promise(function () {}) } }
  const logs: any[] = []
  const logCtx = {
    isEnabled: function (): boolean { return true },
    fire: function (level: string, event: string, fields: any): void {
      logs.push({ level: level, event: event, fields: (typeof fields === 'function') ? fields() : fields })
    },
  }
  const repoKeys: Record<string, any> = {}
  const repoRoots: Record<string, any> = {}
  let ghPath: string | null = 'gh'
  const rk = createRepoKeys({
    subprocess: subprocess,
    timer: timer,
    // 不给 fs：让三级解析走 git 那条路（Tier 1），与白屏现场一致。
    fs: undefined,
    DEFAULT_CWD: '/repo',
    TIMEOUT_MS: 30000,
    repoKeys: repoKeys,
    repoRoots: repoRoots,
    getGhPath: function (): string | null { return ghPath },
    setGhPath: function (v: string | null): void { ghPath = v },
    getGhLastError: function (): string | null { return null },
    setGhLastError: function (_v: string | null): void {},
    getPlatform: async function (): Promise<any> {
      return {
        os: 'linux',
        resolveExecutable: async function (): Promise<string> { return 'git' },
        getHome: async function (): Promise<string> { return '/home/u' },
        path: {
          join: function (...p: string[]): string { return p.join('/') },
          normalize: function (s: string): string { return s },
          isAbsolute: function (s: string): boolean { return String(s).charAt(0) === '/' },
          sep: '/',
        },
        fs: {},
      }
    },
    getWorkspaceStore: async function (): Promise<any> { return null },
    setCache: function (_v: any): void {},
    clearWorkspaceStore: function (): void {},
    namingSweepSoon: function (_ms: number): void {},
    getChainBackoff: undefined,
    parseGithubRepo: parseGithubRepo,
    logCtx: logCtx,
    gate: null,
    getGate: undefined,
  })
  return { rk: rk, spawned: spawned, repoKeys: repoKeys, logs: logs, setRemoteUrl: function (u: string) { remoteUrl = u }, setHang: function (v: boolean) { opts.hang = v } }
}

// 带超时的调用：超时就是「被吊住了」，这正是要判红的现场。
const callWithTimeout = async function (fn: () => Promise<any>, ms: number): Promise<any> {
  let timer: any = null
  const timeout = new Promise(function (resolve) { timer = setTimeout(function () { resolve({ timedOut: true }) }, ms) })
  const raced = await Promise.race([fn().then(function (v) { return { timedOut: false, value: v } }), timeout])
  if (timer) clearTimeout(timer)
  return raced
}

async function scenarioA(): Promise<void> {
  console.log('\n== A. 缓存过期 + 重验的 git 挂住时，getRepoKey 必须立刻返回旧值 ==')
  // 先让 git 正常答，把缓存建起来（模拟「首屏加载时一切都好」）。
  const world = makeWorld({ hang: false, remoteUrl: 'https://github.com/acme/widgets.git' })
  const first = await callWithTimeout(function () { return world.rk.getRepoKey('/repo') }, 2000)
  check(first.timedOut === false, 'A1 首次解析能拿到仓库身份（未被拖住）')
  check(first.timedOut === false && first.value && first.value.owner === 'acme', 'A2 首次解析结果是 acme/widgets（实得 ' + JSON.stringify(first.timedOut ? 'timeout' : first.value) + '）')

  // 现在把重验那一条 git 挂住（done 永不落定、计时器也不落定 = execProc 的 race 永不落定），
  // 再把信任窗口推过去 —— 正是「切回页签时正好撞上窗口过期」那个现场。
  world.setHang(true)
  const realNow = Date.now
  let skew = 0
  Date.now = function (): number { return realNow() + skew }
  skew = 120000 // 越过 60 秒信任窗口
  const t0 = realNow()
  const second = await callWithTimeout(function () { return world.rk.getRepoKey('/repo') }, 2000)
  const elapsed = realNow() - t0
  Date.now = realNow
  world.setHang(false)
  check(second.timedOut === false, 'A3 窗口过期 + git 挂住时 getRepoKey 仍在 2 秒内返回（实得 ' + (second.timedOut ? '超时=被 git 拖住（白屏根因）' : elapsed + 'ms') + '）')
  check(second.timedOut === false && second.value && second.value.owner === 'acme', 'A4 返回的是旧缓存里的身份，而不是 null（实得 ' + JSON.stringify(second.timedOut ? 'timeout' : second.value) + '）')
  check(elapsed < 1000, 'A5 返回耗时远小于一次 git 往返（实得 ' + elapsed + 'ms）')
}

async function scenarioB(): Promise<void> {
  console.log('\n== B. 后台确实补了一次重验，并把新结果写回缓存 ==')
  const world = makeWorld({ hang: false, remoteUrl: 'https://github.com/acme/widgets.git' })
  await world.rk.getRepoKey('/repo')
  check(world.repoKeys['/repo'] && world.repoKeys['/repo'].name === 'widgets', 'B1 首次解析写入了缓存（实得 ' + JSON.stringify(world.repoKeys['/repo']) + '）')

  const realNow = Date.now
  let skew = 0
  Date.now = function (): number { return realNow() + skew }
  skew = 120000
  world.setRemoteUrl('https://github.com/acme/renamed.git')
  const afterExpiry = await world.rk.getRepoKey('/repo')
  check(afterExpiry && afterExpiry.name === 'widgets', 'B2 过期后这一次仍返回旧值（后台还没跑完）')
  // 后台那一趟是微任务链，给它几个事件循环。
  await sleep(60)
  Date.now = realNow
  check(world.repoKeys['/repo'] && world.repoKeys['/repo'].name === 'renamed', 'B3 后台重验把新 origin 写回了缓存（实得 ' + JSON.stringify(world.repoKeys['/repo']) + '）')
  const third = await world.rk.getRepoKey('/repo')
  check(third && third.name === 'renamed', 'B4 下一次读取直接用上新值（实得 ' + JSON.stringify(third) + '）')
}

async function scenarioC(): Promise<void> {
  console.log('\n== C. 同一工作区并发多拍只跑一次重验 ==')
  const world = makeWorld({ hang: false, remoteUrl: 'https://github.com/acme/widgets.git' })
  await world.rk.getRepoKey('/repo')
  const realNow = Date.now
  let skew = 0
  Date.now = function (): number { return realNow() + skew }
  skew = 120000
  const before = world.spawned.length
  // 并发十拍：都撞在过期的同一瞬间
  await Promise.all(Array.from({ length: 10 }, function () { return world.rk.getRepoKey('/repo') }))
  await sleep(60)
  const added = world.spawned.length - before
  Date.now = realNow
  check(added <= 2, 'C1 十拍并发只起了极少量 git 进程（实得 ' + added + ' 条，未去重会是 20+ 条）')
  check(world.repoKeys['/repo'] && world.repoKeys['/repo'].name === 'widgets', 'C2 去重没有把缓存搞坏（实得 ' + JSON.stringify(world.repoKeys['/repo']) + '）')
}

async function scenarioD(): Promise<void> {
  console.log('\n== D. 重验失败（git 读不到）时保留旧值，不突然「认不出仓库」==')
  const world = makeWorld({ hang: false, remoteUrl: 'https://github.com/acme/widgets.git' })
  await world.rk.getRepoKey('/repo')
  const realNow = Date.now
  let skew = 0
  Date.now = function (): number { return realNow() + skew }
  skew = 120000
  // 让 git 报一个非 0 退出：把远端地址换成读不出 GitHub 的垃圾
  world.setRemoteUrl('not-a-remote')
  const got = await world.rk.getRepoKey('/repo')
  await sleep(60)
  Date.now = realNow
  check(got && got.name === 'widgets', 'D1 重验失败时这一次仍返回旧值（实得 ' + JSON.stringify(got) + '）')
  check(world.repoKeys['/repo'] && world.repoKeys['/repo'].name === 'widgets', 'D2 旧缓存没有被清掉（实得 ' + JSON.stringify(world.repoKeys['/repo']) + '）')
}

const main = async function (): Promise<void> {
  await scenarioA()
  await scenarioB()
  await scenarioC()
  await scenarioD()
  console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ' —— ' + total + ' 项检查')
  if (failed) process.exitCode = 1
}
main()

// tests/verify-1977-blockedby-absent.ts —— 门禁：blockedBy 缺席时面板不崩（#1977）
//
// 用户现象：右侧 tab 重启后正常、几秒后白屏；错误边界显示
//   TypeError: Cannot read properties of undefined (reading 'some')（Array.forEach 回调里）。
//
// 根因：三态投影 snapshot-view-projection 在 dependencies 未取到（known=false）时
//   故意不写 issue.blockedBy（snapshot-library-adapter 的 blockedByGroupOf 返回 unknownGroup）。
//   这是合法数据状态，但客户端 compute() 的 m.tickets.forEach 里裸调 t.blockedBy.some(...)，
//   TicketRow 也裸调一次 —— 缺字段就抛，触发宿主槽位退位 → 永久白屏。
//
// 修法：两处都按宿主 computeLevels 的同款口径 (t.blockedBy || []) 兜底（当作「无阻塞者」）。
//
// 本门禁跑真源码（eval-probe 加载 store-derived 的 compute），量三件事：
//   A. blockedBy 缺席的 OPEN 票不抛错，且归入 frontier（无阻塞者）。
//   B. blockedBy 是数组时行为不变（有阻塞者归 blocked，空数组归 frontier）。
//   C. claimedBy 短路仍在：已认领的票不因 blockedBy 缺席而崩，归 claimed。
//
// 门禁归属: src/client/kernel/store-derived.ts, src/client/views/TicketRow.ts
// 用法: node --import ./scripts/ts-hook.mts tests/verify-1977-blockedby-absent.ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFn } from './lib/eval-probe.js'
import { spliceableJs } from './lib/source-text.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')

let failed = false
let total = 0
const check = function (ok: unknown, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ---- 源码判据：两处裸 some 都加了兜底 ----
console.log('\n== A. 源码：消费点接受 blockedBy 缺席 ==')
const derivedSrc = spliceableJs(path.join(ROOT, 'src', 'client', 'kernel', 'store-derived.ts'))
check(/\(t\.blockedBy \|\| \[\]\)\.some\(openBlocker\)/.test(derivedSrc), 'store-derived.compute 用 (t.blockedBy || []) 兜底')
const rowSrc = path.join(ROOT, 'src', 'client', 'views', 'TicketRow.ts')
const rowText = (await import('node:fs')).readFileSync(rowSrc, 'utf8')
check(/\(t\.blockedBy \|\| \[\]\)\.some\(openBlocker\)/.test(rowText), 'TicketRow 用 (t.blockedBy || []) 兜底')

// ---- 运行时判据：加载真 compute，喂实际会崩的数据 ----
console.log('\n== B. 运行时：blockedBy 缺席不再抛 ==')
// compute 依赖的几个闭包名字，按真形状顶替（这与 verify-multi-effort-panel 同口径）。
// 只顶 declare 出来的外部名字；normIdentityKey / mapBlockOf / applyStandaloneBlocks 是文件内定义，
// spliceableJs 已含它们，再传会撞「已声明」。
const sandbox: any = {
  idOf: (t: any) => String((t && (t.key != null ? t.key : t.number)) || ''),
  idOfParts: (eff: any, k: any) => String(k),
  effortOf: (t: any) => (t && t.effortId) || '',
  refKeyOf: (b: any) => String((b && (b.key != null ? b.key : b)) || ''),
}
const body = derivedSrc
const factory = compileFn(Object.keys(sandbox), body + '\n;return { compute: compute }')
const mod: any = factory(...Object.keys(sandbox).map((n) => sandbox[n]))
const compute = mod.compute

const mkSt = (tickets: any[]) => ({ snapshot: { maps: [{ key: 'M', tickets: tickets }] } })

// B1：缺席字段的 OPEN 票
let threw: any = null
let groups: any = null
try {
  groups = compute(mkSt([
    { key: '1', number: 1, state: 'OPEN' },              // 没有 blockedBy —— 就是崩现场
    { key: '2', number: 2, state: 'CLOSED' },
  ]))[0]
} catch (e) { threw = e }
check(threw === null, 'compute 遇 blockedBy 缺席不抛（原实现在此抛 undefined.some）' + (threw ? '：' + String(threw.message) : ''))
check(!!groups && groups.frontier.length === 1 && groups.frontier[0].number === 1, '缺席字段的开放票归入 frontier（当作无阻塞者）')

// B2：blockedBy 是数组时行为不变
let groups2: any = null
try {
  groups2 = compute(mkSt([
    { key: '1', number: 1, state: 'OPEN', blockedBy: [] },
    { key: '2', number: 2, state: 'OPEN', blockedBy: [{ key: '1' }] },
  ]))[0]
} catch (e) { threw = e }
check(!!groups2 && groups2.frontier.length === 1 && groups2.frontier[0].number === 1, '空 blockedBy 的票归 frontier（数组路径不变）')
check(!!groups2 && groups2.blocked.length === 1 && groups2.blocked[0].number === 2, '有阻塞者的票归 blocked（数组路径不变）')

// B3：claimedBy 短路
let groups3: any = null
try {
  groups3 = compute(mkSt([
    { key: '1', number: 1, state: 'OPEN', claimedBy: 'alice' },   // 已认领 + 缺 blockedBy
  ]))[0]
} catch (e) { threw = e }
check(threw === null, '已认领且缺 blockedBy 的票不抛')
check(!!groups3 && groups3.claimed.length === 1, '已认领的票归 claimed（短路口径不变）')

console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ' —— ' + total + ' 项检查')
if (failed) process.exitCode = 1

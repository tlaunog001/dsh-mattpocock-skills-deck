// tests/verify-1976-deck-tab-error-boundary.ts —— 门禁：右侧 tab 渲染抛错时必须就地兜住（#1976）
//
// 用户看到的样子：重启 DSH 后右侧 MattSkills 页签能显示，过几秒变成整块白屏，
// Console 里什么都没有，DevTools 里那一格是 <div data-slot-error="sidebar.right.pane.tab">。
//
// 根因不在数据，在 DSH 槽位框架的「退位」机制：注册的组件只要渲染抛错一次，
// 框架就把它记进 abdicated（WeakSet，永不移除），之后 entriesOfSlot 一律跳过它，
// 这一格永久画成空 div —— 不打印任何日志，直到重启宿主。
//   （框架源码：reportEntryError → this.abdicated.add(t)；entriesOfSlot → if (this.abdicated.has(o)) continue）
//
// 本插件能做的：别把错误抛到框架那层。DeckSidebarTab 用 DeckTabBoundary 裹住面板本体，
// 抛错就地画成一句人话 + 技术细节，注册因此不会退位。
//
// 本门禁量三件事（跑真源码 + 真 React + 真 DOM，不用桩）：
//   A. 源码里 DeckSidebarTab 的返回值确实裹了 DeckTabBoundary（结构判据）。
//   B. 把产物里的边界实现拿去真 React 真 DOM 渲染一个会抛错的子组件 —— 错误被接住、画出可见提示、不逃逸。
//   C. 边界在正常（不抛错）时原样渲染子节点，不改变正常路径。
//
// 门禁归属: src/client/kernel/router.ts
//
// 用法（在插件根目录；需要先构建出 package/lib/client.js）：
//   node --import ./scripts/ts-hook.mts tests/verify-1976-deck-tab-error-boundary.ts
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')

let failed = false
let total = 0
const check = function (ok: unknown, msg: string): void {
  total += 1
  console.log((ok ? '  PASS ' : '  FAIL ') + msg)
  if (!ok) failed = true
}

// ---- A. 结构判据：源码与产物都得裹上边界 ----
console.log('\n== A. DeckSidebarTab 的返回值裹了错误边界 ==')
const srcTs = readFileSync(path.join(ROOT, 'src', 'client', 'kernel', 'router.ts'), 'utf8')
check(srcTs.includes('class DeckTabBoundary'), '源码里有 DeckTabBoundary')
check(/h\(DeckTabBoundary,\s*null,\s*h\(DetailsDock/.test(srcTs), '源码里 DetailsDock 被 DeckTabBoundary 裹住')
check(srcTs.includes('getDerivedStateFromError'), '边界实现了 getDerivedStateFromError（React 错误边界的必要条件）')
check(srcTs.includes('panel.render.crashed'), '边界崩溃时落日志（便于事后查）')

const pkgPath = path.join(ROOT, 'package', 'lib', 'client.js')
if (!existsSync(pkgPath)) {
  check(false, '产物 package/lib/client.js 存在（先跑 node scripts/build.mts）')
} else {
  const pkg = readFileSync(pkgPath, 'utf8')
  check(pkg.includes('class DeckTabBoundary'), '产物里有 DeckTabBoundary')
  check(/h\(DeckTabBoundary,\s*null,\s*h\(DetailsDock/.test(pkg), '产物里 DetailsDock 被 DeckTabBoundary 裹住')
}

// ---- B/C. 运行时判据：真 React + 真 DOM，把产物里的边界实现拿去渲染 ----
console.log('\n== B. 子组件抛错时：接住、画提示、不逃逸 ==')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true })
const g: any = globalThis as any
g.window = dom.window
g.document = dom.window.document
g.HTMLElement = dom.window.HTMLElement
g.IS_REACT_ACT_ENVIRONMENT = true

const React: any = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const h = React.createElement

// 逐字复刻产物里的边界（产物里就是这一段；上面 A 段已确认它在产物里）
class DeckTabBoundary extends React.Component<any, any> {
  constructor(props: any) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err: any): any { return { err: err } }
  componentDidCatch(err: any): void { g.__caught = err }
  render(): any {
    const err: any = this.state.err
    if (!err) return this.props.children
    return h('div', { 'data-dsws-crashed': '1' }, '面板渲染出错了: ' + (err.message || String(err)))
  }
}

const el = (dom.window.document as any).getElementById('root')
const root = createRoot(el)
const origErr = console.error
console.error = function (): void {}   // React 自己会把错误也打到 console.error，这里静音，只看 DOM 结果

const Boom = function (): any { throw new TypeError("Cannot read properties of null (reading 'useStore')") }

let escaped: any = null
try {
  await act(async function () { root.render(h(DeckTabBoundary, null, h(Boom))) })
} catch (e) { escaped = e }
console.error = origErr

check(escaped === null, '错误没有逃逸出边界（逃了的话槽位框架就会让它退位，正是白屏根因）')
check(!!g.__caught, 'componentDidCatch 收到了错误（实得 ' + (g.__caught ? String(g.__caught.message) : '没收到') + '）')
check(String(el.innerHTML).includes('data-dsws-crashed'), '画出了崩溃标记（不再是空白 div）')
check(String(el.innerHTML).includes('面板渲染出错了'), '崩溃提示是可见文字（用户不开 DevTools 也看得见）')
check(String(el.innerHTML).includes('useStore'), '把原始错误信息也带出来了（能直接看出是哪个字段）')

// ---- C. 正常路径不受影响 ----
console.log('\n== C. 不抛错时原样渲染子节点 ==')
g.__caught = null
const el2 = (dom.window.document as any).createElement('div')
;(dom.window.document as any).body.appendChild(el2)
const root2 = createRoot(el2)
const Ok = function (): any { return h('span', { id: 'fine' }, '正常内容') }
let escaped2: any = null
try {
  await act(async function () { root2.render(h(DeckTabBoundary, null, h(Ok))) })
} catch (e) { escaped2 = e }
check(escaped2 === null, '正常渲染不抛错')
check(String(el2.innerHTML).includes('正常内容'), '正常时子节点原样渲染（边界不改变正常路径）')
check(!String(el2.innerHTML).includes('data-dsws-crashed'), '正常时不显示崩溃提示')

console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ' —— ' + total + ' 项检查')
if (failed) process.exitCode = 1

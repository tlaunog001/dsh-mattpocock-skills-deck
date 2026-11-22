// 最小自测：pending 行也必须带修复动作（issue #1906 / BUG-007），与共享层 chain-evaluate.ts 对齐。
// 跑法：node --import ./scripts/ts-hook.mts tests/smoke-chain-step-pending-actions.test.ts
import { stepEvalParallel } from '../src/refresh/rooms/host/chain-step-rows.js'

const wizard = { type: 'wizard', label: '创建并发布' }
const prompt = { type: 'inject-prompt', label: '补指引' }
const item = (id: string) => ({
  id,
  check: id,
  onFail: { show: null, actions: [wizard] },
  onPass: { show: null, actions: [prompt] },
})
const snap = stepEvalParallel(
  [item('pass-step'), item('fail-step'), item('pending-step'), item('pending-nofail')],
  {
    'pass-step': 'pass',
    'fail-step': 'fail',
    'pending-step': null,
    'pending-nofail': { status: 'pending' },
  },
)!
const steps = Object.fromEntries(snap.steps.map((s: any) => [s.id, s])) as Record<string, any>
const cases: Array<[string, boolean]> = [
  ['pass 行不带动作', JSON.stringify(steps['pass-step'].actions) === '[]'],
  ['fail 行带 onFail 动作', steps['fail-step'].actions[0] === wizard],
  ['pending(null) 行带 onFail 动作', steps['pending-step'].actions[0] === wizard],
  ['pending(对象) 行带 onFail 动作', steps['pending-nofail'].actions[0] === wizard],
  ['pending 行 show 仍为名称三格（不含修复文案）', steps['pending-step'].show === steps['pending-step'].show && !!steps['pending-step'].show],
]

// #1974：pending（还没确认）不得摆出「建仓」类动作；fail（已确认）照给——用户是显式点的。
//   起因：下游实测「插件在镜像工作区里重载一次」这条链会自己往下走，唯一阻挡是时间性 defer，
//   某一轮判成 green 就凭空建仓并把内网元数据推上 GitHub。方向按下游建议：丢失动作不该用自动补做解决。
{
  const createAction = { type: 'rpc', method: 'wf.initPublish', params: {} }
  const readAction = { type: 'rpc', method: 'wf.chain', params: {} }
  const withCreate = (id: string) => ({
    id, check: id,
    onFail: { show: null, actions: [createAction, readAction] },
    onPass: { show: null, actions: [createAction] },
  })
  const snap2 = stepEvalParallel([withCreate('p-step'), withCreate('f-step')], { 'p-step': null, 'f-step': 'fail' })!
  const st2 = Object.fromEntries(snap2.steps.map((s: any) => [s.id, s])) as Record<string, any>
  const pNames = (st2['p-step'].actions || []).map((a: any) => String(a && a.method || ''))
  const fNames = (st2['f-step'].actions || []).map((a: any) => String(a && a.method || ''))
  cases.push(['pending 行不摆建仓动作', pNames.indexOf('wf.initPublish') < 0])
  cases.push(['pending 行仍保留非建仓动作', pNames.indexOf('wf.chain') >= 0])
  cases.push(['fail 行照给建仓动作（用户显式点）', fNames.indexOf('wf.initPublish') >= 0])
}
let failed = 0
for (const [name, ok] of cases) {
  if (!ok) failed += 1
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}
console.log(failed ? `\n${failed} 项失败` : '\n全部通过（共 ' + cases.length + ' 项）')
process.exitCode = failed ? 1 : 0

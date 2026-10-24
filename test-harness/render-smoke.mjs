// Render smoke: drive BalanceDock through its real render paths with mock hooks.
//
// The shipped bundle is compiled JSX against `react` + `react/jsx-runtime`, so a
// tiny hook/jsx shim can execute the component without a DOM and prove that the
// chart branches, the footer and the context menu all build an element tree.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// ---- load the bundle the way the module loader would ----------------------
const loaders = []
const styles = []
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ dataset: {}, set textContent(v) { this._css = v }, get textContent() { return this._css } }),
  head: { appendChild: (el) => styles.push(el) },
}
globalThis.window = {
  __ModuleLoader__: { load: (def) => loaders.push(def) },
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
}
const code = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')
new Function('window', code)(globalThis.window)
const def = loaders[0]

// ---- hooks -----------------------------------------------------------------
let hookIndex = 0
let overrides = {}
const react = {
  useState: (initial) => {
    const value = hookIndex in overrides ? overrides[hookIndex] : typeof initial === 'function' ? initial() : initial
    hookIndex += 1
    return [value, () => {}]
  },
  useRef: () => ({ current: null }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
  memo: (component) => component,
  createElement: () => null,
}

const Fragment = Symbol('Fragment')
let jsxKey = 0
const jsx = (type, props) => ({ type, props: props ?? {}, key: `k${jsxKey++}` })
const jsxs = jsx

const portals = []
const reactDom = {
  createPortal: (node, target) => {
    const portal = { type: 'portal', target, props: { children: node } }
    portals.push(portal)
    return portal
  },
}
const moduleExports = def.factory((id) =>
  id === 'react' ? react : id === 'react-dom' ? reactDom : { jsx, jsxs, Fragment },
)
assert.equal(typeof moduleExports.BalanceDock, 'function')

// the stylesheet is installed by apply(), not at module load
const scope = {
  get: () => undefined,
  slots: { inject: (name, fn) => fn(), register: () => ({}) },
}
moduleExports.apply({ inject: (deps, fn) => fn(scope) })
assert.equal(styles.length, 1, 'the stylesheet must install once')
assert.equal(typeof globalThis.window.__dshCostProbe, 'function', 'apply() must install the diagnostics probe')
const probe = globalThis.window.__dshCostProbe()
assert.equal(probe.version, '0.8.3')
assert.equal(probe.heroDock, false)
console.log('probe ok:', JSON.stringify(probe))
const css = styles[0].textContent
for (const marker of ['dshcost_menu', 'dshcost_bars', 'dshcost_sbars', 'dshcost_popchart', 'dshcost_stats', 'dshcost_avg']) {
  assert.ok(css.includes(marker), `stylesheet is missing ${marker}`)
}
assert.ok(
  css.includes('.dshcost_bars{position:relative'),
  'the chart area needs a positioning context, or the average line anchors to the popover instead',
)
console.log('stylesheet ok:', css.length, 'bytes')

const days = [
  { date: '2026-10-16', weekday: 5, today: false, cost: 0, peak: 0, offpeak: 0 },
  { date: '2026-10-17', weekday: 6, today: false, cost: 2.67331, peak: 0, offpeak: 2.67331 },
  { date: '2026-10-18', weekday: 0, today: false, cost: 2.177796, peak: 0, offpeak: 2.177796 },
  { date: '2026-10-19', weekday: 1, today: false, cost: 0, peak: 0, offpeak: 0 },
  { date: '2026-10-20', weekday: 2, today: false, cost: 0.970836, peak: 0, offpeak: 0.970836 },
  { date: '2026-10-21', weekday: 3, today: false, cost: 0.021283, peak: 0, offpeak: 0.021283 },
  { date: '2026-10-22', weekday: 4, today: true, cost: 9.881953, peak: 0, offpeak: 9.881953 },
]
const balance = { kind: 'ok', provider: 'deepseek', symbol: '¥', total: '57.03', title: 'Off-peak · 50% of the peak price · Total ¥57.03', dotColor: '#0f0' }
const usage = { turn: 1, estimatedCost: 0.8779, tokens: { uncachedInput: 83990, cacheRead: 6685824, write: 0, output: 83577, total: 6853391 }, route: { model: 'deepseek-flash' } }

const walk = (node, visit) => {
  if (node === null || node === undefined || node === false) return
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return }
  if (typeof node !== 'object') return
  // function components are expanded so their own children are visited too
  if (typeof node.type === 'function') {
    walk(node.type(node.props ?? {}), visit)
    return
  }
  visit(node)
  if (node.props) walk(node.props.children, visit)
}

const classesOf = (element) => {
  const found = new Set()
  walk(element, (node) => {
    if (node.props && typeof node.props.className === 'string') found.add(node.props.className)
  })
  return found
}
const textOf = (element) => {
  const parts = []
  const visit = (node) => {
    if (node === null || node === undefined || node === false) return
    if (typeof node === 'string' || typeof node === 'number') { parts.push(String(node)); return }
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (typeof node !== 'object') return
    if (typeof node.type === 'function') { visit(node.type(node.props ?? {})); return }
    if (node.props) visit(node.props.children)
  }
  visit(element)
  return parts.join(' ')
}

function render(hooks) {
  hookIndex = 0
  overrides = hooks
  return moduleExports.BalanceDock({ getModelDirectories: () => undefined, useSessions: undefined })
}

// ---- loading ---------------------------------------------------------------
let tree = render({ 0: { kind: 'loading' } })
assert.ok(textOf(tree).includes('余额'), 'loading state must render a label')
console.log('loading ok')

// ---- style B (default) ----------------------------------------------------
tree = render({ 0: balance, 1: usage, 2: true, 3: { ok: true, days, total: 15.725177 }, 4: 'bars' })
let classes = classesOf(tree)
assert.ok(classes.has('dshcost_pop dshcost_popchart'), 'open popover must use the chart width')
assert.ok(classes.has('dshcost_bars'), 'style B must render the daily bars')
assert.ok(!classes.has('dshcost_sbars'), 'style B must not render the stack')
assert.ok(classes.has('dshcost_stats'), 'the three-number summary must render')
assert.ok(classes.has('dshcost_avg'), 'the daily-average reference line must render')
assert.ok(classes.has('dshcost_avgkey'), 'the daily-average legend must render')
assert.ok(textOf(tree).includes('近 7 天消费'), 'chart title missing')
assert.ok(textOf(tree).includes('9.88'), 'today value missing')
assert.ok(textOf(tree).includes('今'), 'today axis label missing')
assert.ok(textOf(tree).includes('今日') && textOf(tree).includes('日均'), 'summary labels missing')
assert.ok(textOf(tree).includes('余额可用') || textOf(tree).includes('本周轮次'), 'third summary cell missing')
console.log('style B ok:', [...classes].filter((name) => name.startsWith('dshcost')).join(' '))

// ---- style C --------------------------------------------------------------
tree = render({ 0: balance, 1: usage, 2: true, 3: { ok: true, days, total: 15.725177 }, 4: 'stacked' })
classes = classesOf(tree)
assert.ok(classes.has('dshcost_sbars'), 'style C must render the stack')
assert.ok(!classes.has('dshcost_bars'), 'style C must not render the daily bars')
assert.ok(classes.has('dshcost_soff'), 'stack segments missing (all sample days are off-peak)')
assert.ok(textOf(tree).includes('高峰') && textOf(tree).includes('空闲'), 'legend missing')
console.log('style C ok')

// ---- right-click menu -----------------------------------------------------
tree = render({ 0: balance, 1: usage, 2: false, 3: { ok: true, days, total: 15.7 }, 4: 'bars', 5: 'turn', 6: null, 7: { x: 100, y: 200, pane: 'style', side: 'left', valign: 'up' } })
classes = classesOf(tree)
assert.ok(classes.has('dshcost_menu'), 'menu panel missing')
assert.ok(classes.has('dshcost_msub'), 'style submenu missing')
const menuText = textOf(tree)
assert.ok(menuText.includes('样式'), 'menu item name missing')
assert.ok(menuText.includes('逐日数值') && menuText.includes('高峰 / 空闲堆叠'), 'style options missing')
console.log('menu ok:', menuText.replace(/\s+/g, ' ').slice(0, 80))

// ---- 消费显示 submenu ------------------------------------------------------
tree = render({ 0: balance, 1: usage, 2: false, 3: { ok: true, days, total: 15.7 }, 4: 'bars', 5: 'turn', 6: null, 7: { x: 100, y: 200, pane: 'spend', side: 'right', valign: 'down' } })
const spendMenuText = textOf(tree)
assert.ok(spendMenuText.includes('消费显示'), 'the 消费显示 root row is missing')
assert.ok(
  spendMenuText.includes('显示本轮消耗') && spendMenuText.includes('显示本次对话总消耗'),
  'the two spend readouts are missing',
)
assert.ok(classesOf(tree).has('dshcost_msub'), 'the spend submenu is missing')
console.log('spend menu ok')

// ---- per-turn vs whole-conversation readout -------------------------------
const sessionUsage = { turns: 3, estimatedCost: 0.5231, tokens: { uncachedInput: 90000, cacheRead: 7000000, output: 120000, total: 7210000 } }
tree = render({ 0: balance, 1: usage, 2: false, 3: null, 4: 'bars', 5: 'session', 6: sessionUsage, 7: null })
assert.ok(textOf(tree).includes('本次 ¥0.5231'), 'session mode must show the conversation total')
assert.ok(!textOf(tree).includes('本轮'), 'session mode must drop the per-turn readout')
tree = render({ 0: balance, 1: usage, 2: false, 3: null, 4: 'bars', 5: 'turn', 6: sessionUsage, 7: null })
assert.ok(textOf(tree).includes('本轮 ¥0.8779'), 'turn mode must show the last turn cost')
console.log('readout modes ok')

// ---- closed + no history: falls back to the text bubble -------------------
tree = render({ 0: balance, 1: usage, 2: true, 3: null, 4: 'bars' })
classes = classesOf(tree)
assert.ok(!classes.has('dshcost_popchart'), 'without history the popover keeps its text width')
assert.ok(textOf(tree).includes('Off-peak'), 'text fallback missing')
console.log('text fallback ok')

// ---- error state ----------------------------------------------------------
tree = render({ 0: { kind: 'error', message: 'no-key' } })
assert.ok(classesOf(tree).has('dshcost_pill'))
console.log('error state ok')

// ---- empty-conversation chip ---------------------------------------------
const dockNode = { querySelector: () => null }
const regionNode = { querySelector: (selector) => (selector === '[data-composer-dock]' ? dockNode : null) }
const realDocument = globalThis.document
globalThis.document = {
  ...realDocument,
  querySelector: (selector) => (selector.includes('[data-content-phase="hero"]') ? regionNode : null),
}
const renderHero = (hooks) => {
  hookIndex = 0
  overrides = hooks
  return moduleExports.HeroCostChip({ getModelDirectories: () => undefined, useSessions: undefined })
}
// the host component is reused: only the money segment is suppressed
const hero = renderHero({})
assert.equal(hero.type, 'portal', 'the hero chip must portal into the composer statistics row')
assert.equal(hero.target, dockNode)
hookIndex = 0
overrides = { 0: balance }
const heroText = textOf(hero)
assert.ok(heroText.includes('¥57.03'), 'the hero chip must show the balance')
assert.ok(/\d+h\d+m|\d+m/.test(heroText), 'the hero chip must show the billing-window countdown')
assert.ok(!heroText.includes('本轮') && !heroText.includes('本次'), 'the hero chip must not show a cost')
console.log('hero chip ok:', heroText.replace(/\s+/g, ' ').trim())

// left click opens the same seven-day chart
const heroChart = renderHero({})
hookIndex = 0
overrides = { 0: balance, 1: usage, 2: true, 3: { ok: true, days, total: 15.7 }, 4: 'bars', 5: 'session', 6: sessionUsage, 7: null }
const heroChartText = textOf(heroChart)
assert.ok(heroChartText.includes('近 7 天消费'), 'a left click on the empty screen must open the chart')
assert.ok(heroChartText.includes('今日') && heroChartText.includes('日均'), 'the chart summary is missing')
assert.ok(!heroChartText.includes('本次 ¥'), 'the chart on the empty screen must not show a cost')
console.log('hero chart ok')

// right click opens the same menu
const heroMenu = renderHero({})
hookIndex = 0
overrides = { 0: balance, 1: usage, 2: false, 3: null, 4: 'bars', 5: 'turn', 6: null, 7: { x: 100, y: 200, pane: 'spend', side: 'right', valign: 'down' } }
const heroMenuText = textOf(heroMenu)
assert.ok(heroMenuText.includes('样式') && heroMenuText.includes('消费显示'), 'the hero chip must keep the right-click menu')
assert.ok(heroMenuText.includes('显示本轮消耗'), 'the per-turn option label is missing')
assert.ok(heroMenuText.includes('花费显示将在对话开始后生效'), 'the empty-conversation menu must explain the delayed cost readout')
assert.ok(!menuText.includes('花费显示将在对话开始后生效'), 'a settled conversation must not show that note')
console.log('hero menu ok')

// a settled conversation owns the row: the hero chip must stay out of it
const busyDock = { querySelector: (selector) => (selector === '[data-composer-stat]' ? {} : null) }
const busyRegion = { querySelector: () => busyDock }
globalThis.document.querySelector = () => busyRegion
assert.equal(renderHero({}), null, 'the hero chip must not render in a settled conversation')
globalThis.document = realDocument
console.log('hero chip guard ok')

console.log('\nall render assertions passed')

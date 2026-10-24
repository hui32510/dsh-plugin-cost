// Host-route tests: the last-turn usage route and the daily-spend route.
//
// The daily route reads real session-log artifacts off disk, so the fixture
// writes a tiny multi-frame Zstandard log into a throwaway DSH_HOME first —
// that also exercises the container walker against the real format.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))

// ---- the package manifest must stay BOM-free and parseable ----------------
// A UTF-8 BOM here is fatal and silent: the host loader cannot parse the
// manifest, so the whole package (host routes AND client chip) never loads.
const manifestBytes = readFileSync(join(here, '..', 'package.json'))
assert.notEqual(manifestBytes[0], 0xef, 'package.json starts with a UTF-8 BOM')
const manifest = JSON.parse(manifestBytes.toString('utf8'))
assert.equal(manifest.name, 'dsh-cost')
assert.equal(manifest.dsh.client.platform, 'web')
assert.ok(manifest.exports['./client'], 'the client bundle must stay exported')
console.log('manifest ok:', manifest.name, manifest.version)

// ---- fake DSH_HOME with one two-frame session log -------------------------
const home = mkdtempSync(join(tmpdir(), 'dsh-cost-test-'))
const sessionDir = join(home, 'sessions', 'workspace-slug', 'session-test-1')
mkdirSync(sessionDir, { recursive: true })

const HOUR = 3600_000
const DAY = 24 * HOUR
const now = Date.now()
const isPeak = (ms) => {
  const at = new Date(ms)
  const day = at.getUTCDay()
  if (day === 0 || day === 6) return false
  const hour = at.getUTCHours()
  return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10)
}

// 1M uncached input at ¥2/M = ¥2 peak, ¥1 off-peak; 1M output at ¥3/M = ¥3 / ¥1.5.
const todayCall = now
const yesterdayCall = now - DAY
const createdAt = now - 2 * DAY

const header = JSON.stringify({
  type: 'session', version: 4, id: 'session-test-1',
  createdAt, cwd: 'C:\\workspace', isSeeded: false, delegationDepth: 0, agentPreset: 'standard',
})
const call = (seq, turn, time, usage) => ({
  type: 'assistant/message', seq, time,
  data: { turn, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage },
})
const events = [
  { type: 'turn/start', seq: 1, time: todayCall, data: { turn: 1 } },
  call(2, 1, todayCall, { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  { type: 'turn/end', seq: 3, time: todayCall, data: { turn: 1 } },
  call(4, 2, yesterdayCall, { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }),
  // inherited from a fork: older than the log's own createdAt (2 days ago), already billed
  // in the parent log, so it must not be counted again
  call(5, 0, createdAt - 10 * DAY, { inputTokens: 0, outputTokens: 9_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 }),
]
const logPath = join(sessionDir, 'session.v4.jsonl.zstd')
writeFileSync(logPath, Buffer.concat([
  zstdCompressSync(Buffer.from(header + '\n')),
  zstdCompressSync(Buffer.from(events.map((event) => JSON.stringify(event)).join('\n') + '\n')),
]))

// ---- copy the real host bundle next to the stub packages ------------------
// Bare imports (`@deepseek-ai/dsh-credentials`, …) must resolve.
copyFileSync(join(here, '..', 'lib', 'index.js'), join(here, 'plugin.mjs'))
const { apply } = await import(`./plugin.mjs?revision=${Date.now()}`)

const liveEvents = [
  { type: 'turn/start', data: { turn: 7 } },
  { type: 'step/start', data: { turn: 7, step: 0 } },
  { type: 'assistant/message', data: { turn: 7, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000 } } },
  { type: 'step/end', data: { turn: 7, step: 0 } },
  { type: 'turn/end', data: { turn: 7 } },
]
const session = { seq: liveEvents.length, eventAt: (i) => liveEvents[i] }
const routes = new Map()
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (spec) => { routes.set(spec.path, spec.handler) } },
  get: (name) => (name === 'sessions' ? { get: (id) => (id === 'live-1' ? session : undefined) } : undefined),
}
apply(ctx, {})
console.log('routes:', [...routes.keys()].join(', '))
assert.deepEqual([...routes.keys()].sort(), ['/plugins/balance', '/plugins/balance-history', '/plugins/balance-usage'])

// ---- per-turn usage ------------------------------------------------------
let body
const res = { writeHead: () => {}, end: (text) => { body = JSON.parse(text) } }
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=live-1' }, res)
assert.equal(body.ok, true)
assert.equal(body.usage.turn, 7)
assert.equal(body.usage.tokens.total, 6200)
console.log('turn usage:', body.usage.turn, body.usage.tokens.total, 'tok')

body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=nope' }, res)
assert.equal(body.ok, false)
assert.equal(body.error, 'session-not-found')

// ---- whole-conversation spend --------------------------------------------
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=live-1' }, res)
const peakAtFirstPoll = isPeak(Date.now())
const turnCost = (1000 * 2 + 5000 * 0.2 + 200 * 3) / 1e6
assert.equal(body.session.turns, 1)
assert.equal(body.session.tokens.total, 6200)
assert.ok(
  Math.abs(body.session.estimatedCost - (peakAtFirstPoll ? turnCost : turnCost / 2)) < 1e-9,
  JSON.stringify(body.session),
)
console.log('session spend:', body.session.turns, 'turn(s)', body.session.estimatedCost, 'CNY')

// a later turn extends the cached fold instead of double counting it
liveEvents.push(
  { type: 'turn/start', data: { turn: 8 } },
  { type: 'assistant/message', data: { turn: 8, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 } } },
  { type: 'turn/end', data: { turn: 8 } },
)
session.seq = liveEvents.length
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=live-1' }, res)
assert.equal(body.session.turns, 2)
assert.equal(body.session.tokens.total, 6200 + 1_000_000)
const expectedTotal = (peakAtFirstPoll ? turnCost : turnCost / 2) + (peakAtFirstPoll ? 0.2 : 0.1)
assert.ok(Math.abs(body.session.estimatedCost - expectedTotal) < 1e-6, JSON.stringify(body.session))
console.log('session spend after append:', body.session.estimatedCost)

// a running first turn already has a cost, but is not a completed turn
const runningEvents = [
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'assistant/message', data: { turn: 1, step: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 } } },
]
const runningSession = { seq: runningEvents.length, eventAt: (i) => runningEvents[i] }
ctx.get = (name) => (name === 'sessions'
  ? { get: (id) => (id === 'running-1' ? runningSession : id === 'live-1' ? session : undefined) }
  : undefined)
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=running-1' }, res)
assert.equal(body.usage, null, 'a running turn is not a completed turn')
assert.equal(body.session.turns, 0)
assert.ok(body.session.estimatedCost > 0, 'the in-flight turn still counts toward the conversation total')
console.log('running session spend:', body.session.estimatedCost)

// inherited history (a fork) is billed to the parent, not to this conversation
const forkEvents = [
  { type: 'assistant/message', data: { turn: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 9_000_000 } } },
  { type: 'assistant/message', data: { turn: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 9_000_000 } } },
  { type: 'turn/start', data: { turn: 1 } },
  { type: 'assistant/message', data: { turn: 1, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 1_000_000 } } },
  { type: 'turn/end', data: { turn: 1 } },
]
const forkSession = { seq: forkEvents.length, firstLiveSeq: forkEvents.length, inheritedEventCount: 2, eventAt: (i) => forkEvents[i] }
ctx.get = (name) => (name === 'sessions' ? { get: (id) => (id === 'fork-1' ? forkSession : undefined) } : undefined)
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=fork-1' }, res)
assert.equal(body.session.turns, 1)
assert.equal(body.session.tokens.total, 1_000_000, 'inherited usage must not be billed twice')
assert.ok(body.session.estimatedCost <= 1.000001, JSON.stringify(body.session))
console.log('fork session spend:', body.session.estimatedCost)

// a resumed ordinary session reports firstLiveSeq = its whole seeded log, but
// inheritedEventCount = 0: the total must still cover the whole history
const resumedAt = Date.now() - 60 * 60 * 1000
const resumedEvents = [
  { type: 'turn/start', time: resumedAt, data: { turn: 1 } },
  { type: 'assistant/message', time: resumedAt, data: { turn: 1, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 1_000_000 } } },
  { type: 'turn/end', time: resumedAt, data: { turn: 1 } },
  { type: 'session/end-seed', time: resumedAt + 1000, data: {} },
  { type: 'turn/start', time: resumedAt + 2000, data: { turn: 2 } },
  { type: 'assistant/message', time: resumedAt + 2000, data: { turn: 2, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 1_000_000 } } },
  { type: 'turn/end', time: resumedAt + 2000, data: { turn: 2 } },
]
const resumedSession = {
  seq: resumedEvents.length,
  firstLiveSeq: 4,
  inheritedEventCount: 0,
  header: { createdAt: resumedAt - 10_000 },
  eventAt: (i) => resumedEvents[i],
}
ctx.get = (name) => (name === 'sessions' ? { get: (id) => (id === 'resumed-1' ? resumedSession : undefined) } : undefined)
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=resumed-1' }, res)
assert.equal(body.session.turns, 2, 'both turns of the resumed session must count')
assert.equal(body.session.tokens.total, 2_000_000, 'resuming must not hide the earlier history')
console.log('resumed session spend:', body.session.estimatedCost, 'tokens', body.session.tokens.total)

// events older than the log's own createdAt are inherited (fork) history
const inheritedSession = {
  seq: 3,
  firstLiveSeq: 3,
  inheritedEventCount: 0,
  header: { createdAt: resumedAt },
  eventAt: (i) => [
    { type: 'assistant/message', time: resumedAt - 86_400_000, data: { turn: 0, message: { source: { provider: 'deepseek-account', model: 'deepseek-flash' } }, usage: { inputTokens: 9_000_000 } } },
    { type: 'turn/start', time: resumedAt, data: { turn: 1 } },
    { type: 'turn/end', time: resumedAt, data: { turn: 1 } },
  ][i],
}
ctx.get = (name) => (name === 'sessions' ? { get: (id) => (id === 'inherited-1' ? inheritedSession : undefined) } : undefined)
body = undefined
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=inherited-1' }, res)
assert.equal(body.session.tokens.total, 0, 'pre-createdAt usage must be skipped')
console.log('inherited-only session spend:', body.session.estimatedCost)

// ---- daily spend ---------------------------------------------------------
process.env.DSH_HOME = home
body = undefined
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=7' }, res)
assert.equal(body.ok, true, JSON.stringify(body))
assert.equal(body.days.length, 7)
assert.equal(body.days.at(-1).today, true)
assert.equal(body.days.at(-1).weekday, new Date(now).getDay())
assert.equal(body.files, 1, 'the fixture log must be found and decoded')

const todayExpected = isPeak(todayCall) ? 2 : 1
const yesterdayExpected = isPeak(yesterdayCall) ? 3 : 1.5
assert.equal(body.days.at(-1).cost, todayExpected, JSON.stringify(body.days.at(-1)))
assert.equal(body.days.at(-1).peak + body.days.at(-1).offpeak, todayExpected)
assert.equal(body.days.at(-1).turns, 1)
assert.equal(body.days.at(-2).cost, yesterdayExpected, JSON.stringify(body.days.at(-2)))
assert.equal(body.total, todayExpected + yesterdayExpected)
// the inherited 9M-token call would have been ¥13.5+; it must be ignored
assert.equal(body.days.some((day) => day.cost > 3), false)

console.log('daily:', body.days.map((day) => `${day.date}=${day.cost}`).join(' '), '| total', body.total)
console.log('history ok: files', body.files, 'peak', body.peakTotal, 'offpeak', body.offpeakTotal)

// a shorter window keeps the newest days
body = undefined
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=2' }, res)
assert.equal(body.days.length, 2)
assert.equal(body.total, todayExpected + yesterdayExpected)
console.log('window=2 ok')

// an unknown/invalid window falls back to 7 days
body = undefined
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=abc' }, res)
assert.equal(body.days.length, 7)

console.log('\nall host assertions passed')

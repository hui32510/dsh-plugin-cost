// Dev probe: price one *real* session log through the shipped routes.
//
// Builds a live-style session handle out of the newest log under
// `<DSH_HOME>/sessions`, serves it to `balance-usage`, and — by pointing
// `DSH_HOME` at a throwaway home holding only that log — compares the
// conversation total with the seven-day fold of the same events.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

import { ensureStubs } from './stubs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
ensureStubs()
copyFileSync(join(here, '..', 'lib', 'index.js'), join(here, 'plugin.mjs'))
const { apply } = await import(`./plugin.mjs?probe=${Date.now()}`)

const ZSTD_MAGIC = 0xfd2fb528
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4 || buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) break
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    offset += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag)
    offset += contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    if (offset > buffer.length) break
    let complete = true
    for (;;) {
      if (buffer.length - offset < 3) { complete = false; break }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      if (blockType === 3) { complete = false; break }
      offset += blockType === 1 ? 1 : blockHeader >>> 3
      if (offset > buffer.length) { complete = false; break }
      if (lastBlock) break
    }
    if (!complete) break
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}
const decode = (buffer, compressed) => compressed
  ? Buffer.concat(scanZstdFrames(buffer).map(({ start, end }) => zstdDecompressSync(buffer.subarray(start, end)))).toString('utf8')
  : buffer.toString('utf8')

const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')
const files = []
const walk = (dir, depth) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { if (depth < 3) walk(path, depth + 1); continue }
    if (/^session\..+\.jsonl(?:\.zstd|\.zst)?$/.test(entry.name)) files.push({ path, mtime: statSync(path).mtimeMs })
  }
}
walk(join(home, 'sessions'), 0)
files.sort((a, b) => b.mtime - a.mtime)
const target = files[Number(process.argv[2] ?? 0)]
const compressed = /\.zst(?:d)?$/.test(target.path)
const text = decode(readFileSync(target.path), compressed)
const events = text.split('\n').filter(Boolean).flatMap((line) => {
  try { return [JSON.parse(line)] } catch { return [] }
})
console.log('log:', target.path)
console.log('events:', events.length, '| zstd frames:', compressed ? scanZstdFrames(readFileSync(target.path)).length : 0)

const routes = new Map()
// Mimic a handle resumed from disk: `firstLiveSeq` points past the whole
// seeded log (the bug this probe guards), while `inheritedEventCount` is 0.
const header = events[0]?.type === 'session' ? events[0] : {}
const session = {
  seq: events.length,
  firstLiveSeq: events.length,
  inheritedEventCount: 0,
  header,
  eventAt: (index) => events[index],
}
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (spec) => { routes.set(spec.path, spec.handler) } },
  get: (name) => (name === 'sessions' ? { get: (id) => (id === 'probe-session' ? session : undefined) } : undefined),
}
apply(ctx, {})

let body
const res = { writeHead: () => {}, end: (payload) => { body = JSON.parse(payload) } }
routes.get('/plugins/balance-usage')({ method: 'GET', url: '/plugins/balance-usage?session=probe-session' }, res)
console.log('last turn:', body.usage ? `#${body.usage.turn} ${body.usage.estimatedCost} CNY ${body.usage.tokens.total} tok` : 'none')
const conversationCost = body.session.estimatedCost
console.log('conversation:', JSON.stringify(body.session))

// Same events through the daily fold, in a home holding only this log.
const alone = mkdtempSync(join(tmpdir(), 'dsh-cost-probe-'))
mkdirSync(join(alone, 'sessions', 'probe', 'probe-session'), { recursive: true })
copyFileSync(target.path, join(alone, 'sessions', 'probe', 'probe-session', compressed ? 'session.v4.jsonl.zstd' : 'session.v4.jsonl'))
process.env.DSH_HOME = alone
const since = Date.now()
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=7' }, res)
console.log('history (7d, this log only):', body.total, 'CNY |', Date.now() - since, 'ms')
const delta = Math.abs(body.total - conversationCost)
console.log('delta:', delta, delta < 1e-6 ? '(match)' : '(differs — expected past the 7-day window)')

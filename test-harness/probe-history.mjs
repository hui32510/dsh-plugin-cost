// Dev probe: fold the *real* session logs and print the 7-day series.
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureStubs } from './stubs.mjs'

const here = dirname(fileURLToPath(import.meta.url))
ensureStubs()
copyFileSync(join(here, '..', 'lib', 'index.js'), join(here, 'plugin.mjs'))
const { apply } = await import(`./plugin.mjs?probe=${Date.now()}`)

const routes = new Map()
const ctx = {
  effect: (fn) => fn(),
  webServer: { register: (spec) => { routes.set(spec.path, spec.handler) } },
  get: () => undefined,
}
apply(ctx, {})

process.env.DSH_HOME = process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh')
let body
const started = Date.now()
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=7' }, {
  writeHead: () => {},
  end: (text) => { body = JSON.parse(text) },
})
console.log('first call ms:', Date.now() - started, '| files:', body.files)
for (const day of body.days) {
  console.log(day.date, 'w' + day.weekday, day.today ? '(today)' : '        ', 'cost', String(day.cost).padStart(8), 'peak', String(day.peak).padStart(8), 'off', String(day.offpeak).padStart(8), 'turns', day.turns)
}
console.log('total', body.total, '| peak', body.peakTotal, '| offpeak', body.offpeakTotal)

const again = Date.now()
routes.get('/plugins/balance-history')({ method: 'GET', url: '/plugins/balance-history?days=7' }, {
  writeHead: () => {},
  end: () => {},
})
console.log('cached call ms:', Date.now() - again, '| files:', body.files)

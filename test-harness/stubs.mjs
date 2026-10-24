// Stand-ins for the two host packages the plugin imports.
//
// `lib/index.js` pulls in `@deepseek-ai/dsh-credentials` and
// `@deepseek-ai/dsh-launch-environment`, which are not published to npm. The
// tests run a copy of that file as `test-harness/plugin.mjs`, so Node resolves
// those specifiers from `test-harness/node_modules`; this module writes the
// stand-ins there on demand instead of committing a `node_modules` directory.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const STUBS = {
  '@deepseek-ai/dsh-credentials': 'export const credentialRef = (name) => ({ name })\n',
  '@deepseek-ai/dsh-launch-environment': 'export const launchEnvironmentOf = () => ({ get: () => undefined })\n',
}

export function ensureStubs() {
  for (const [name, source] of Object.entries(STUBS)) {
    const dir = join(here, 'node_modules', ...name.split('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.js'), source)
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, type: 'module', main: 'index.js' })}\n`)
  }
}

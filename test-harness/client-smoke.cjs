const fs = require('fs')
const code = fs.readFileSync(process.argv[2], 'utf8')
const loaders = []
const styles = []
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, set textContent(v) { this._css = v }, get textContent() { return this._css } }),
  head: { appendChild: (el) => styles.push(el) },
}
globalThis.window = { __ModuleLoader__: { load: (d) => loaders.push(d) }, setInterval: () => 0, clearInterval: () => {} }
new Function('window', code)(globalThis.window)
const def = loaders[0]
const react = { useState: () => [], useEffect: () => {}, useCallback: (f) => f, useRef: () => ({}), useLayoutEffect: () => {}, memo: (c) => c, createElement: () => null }
const jsx = { jsx: () => null, jsxs: () => null, Fragment: 'f' }
const mod = def.factory((id) => (id === 'react' ? react : jsx))
console.log('module id:', def.id)
console.log('exports:', Object.keys(mod).join(','))
const registered = {}
const scope = { get: () => undefined, slots: { inject: (n, fn) => fn(), register: (meta, comp) => { registered[meta.name] = meta; return {} } } }
mod.apply({ inject: (deps, fn) => fn(scope) })
console.log('registered:', JSON.stringify(registered))
console.log('style tags:', styles.length)
console.log('has font var:', styles[0].textContent.includes('--dsh-content-font-size-secondary'))
console.log('has pill padding:', styles[0].textContent.includes('padding:1px 8px'))

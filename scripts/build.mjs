import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const lib = join(root, 'lib')
const temp = join(root, '.esbuild')

await rm(lib, { recursive: true, force: true })
await rm(temp, { recursive: true, force: true })
await mkdir(lib, { recursive: true })
await mkdir(temp, { recursive: true })

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(lib, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  external: ['zod', '@deepseek-ai/*'],
  logLevel: 'info',
})

await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(temp, 'client.cjs'),
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2020',
  jsx: 'automatic',
  sourcemap: false,
  external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
  logLevel: 'info',
})

const clientCjs = await readFile(join(temp, 'client.cjs'), 'utf8')
const wrapper = `window.__ModuleLoader__.load({\n  id: "dsh-projectflow",\n  factory: (require) => {\n    var module = { exports: {} };\n    var exports = module.exports;\n${clientCjs}\n    return module.exports;\n  }\n});\n`
await writeFile(join(lib, 'client.js'), wrapper)

execFileSync(process.execPath, [
  join(root, 'node_modules/typescript/bin/tsc'),
  '-p',
  join(root, 'tsconfig.types.json'),
], { stdio: 'inherit', cwd: root })

console.log('built lib/index.js, lib/client.js, lib/types')

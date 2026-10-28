import { ProjectStore, resolveConfig } from '../../lib/index.js'

const [dir, id, prefix, count] = process.argv.slice(2)
const store = new ProjectStore(resolveConfig({ projectsDir: dir }))
for (let index = 0; index < Number(count); index += 1) {
  await store.writeConvention(id, `${prefix} convention ${index}`, `writer-${process.pid}`)
}

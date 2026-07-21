import { dts } from 'bun-plugin-dtsx'
import { frameworkExternal, intro, outro } from '../build/src'

const { startTime } = await intro({
  dir: import.meta.dir,
})

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
  outdir: './dist',
  format: 'esm',
  target: 'bun',
  // sourcemap: 'linked',
  minify: true,

  external: frameworkExternal(),
  plugins: [
    dts({
      root: './src',
      outdir: './dist',
    }),
  ],
})

// dtsx (<= 0.10.8) drops the space between an interface name and its
// `extends` clause inside `declare module` blocks, emitting a d.ts that
// fails to parse (TS1005). Repair the known augmentation until the
// upstream emitter is fixed.
const augmentationDts = `${import.meta.dir}/dist/request-augmentation.d.ts`
const dtsFile = Bun.file(augmentationDts)
if (await dtsFile.exists()) {
  const contents = await dtsFile.text()
  const repaired = contents.replace(/\binterface (\w+)extends /g, 'interface $1 extends ')
  if (repaired !== contents)
    await Bun.write(augmentationDts, repaired)
}

await outro({
  dir: import.meta.dir,
  startTime,
  result,
})

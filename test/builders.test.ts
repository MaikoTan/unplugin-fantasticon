import type { Plugin as VitePluginType } from 'vite'

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rspack } from '@rspack/core'
import { build as esbuildBuild } from 'esbuild'
import { rollup } from 'rollup'
import { build as viteBuild } from 'vite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import webpack from 'webpack'

import EsbuildPlugin from '../src/esbuild'
import RollupPlugin from '../src/rollup'
import RspackPlugin from '../src/rspack'
import VitePlugin from '../src/vite'
import WebpackPlugin from '../src/webpack'

/**
 * End-to-end coverage for every builder unplugin supports.
 *
 * Unlike `index.test.ts` (which injects a fake `generateFonts` to assert
 * builder bookkeeping), these tests run the real pipeline with the real
 * fantasticon output so a hook that only works under Vite -- or an option that
 * silently produces no files -- fails here.
 */

const iconsDir = join(import.meta.dirname, '..', 'playground', 'src', 'icons')

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'fanta-build-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

async function writeEntry(name: string, contents: string): Promise<string> {
  const file = join(workDir, name)
  await writeFile(file, contents, 'utf8')
  return file
}

function options(outputDir: string) {
  return {
    name: 'icons',
    inputDir: iconsDir,
    outputDir,
    // Keep the real font pipeline but limit it to one format so the suite stays
    // fast; the emitted names are still real.
    fontTypes: ['woff2'] as import('fantasticon').FontAssetType[],
    assetTypes: ['css'] as import('fantasticon').OtherAssetType[],
  }
}

/** Run a webpack-family build and return the emitted bundle. */
function compile(
  runner: { (config: any, cb: any): void },
  plugin: unknown,
  workDir: string,
  entry: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    runner({
      mode: 'development',
      devtool: false,
      entry,
      output: { path: join(workDir, 'out'), filename: 'bundle.js' },
      plugins: [plugin as any],
    }, (err: any, stats: any) => {
      if (err)
        return reject(err)
      if (stats?.hasErrors())
        return reject(new Error(stats.toString({ all: false, errors: true })))
      resolve(readFile(join(workDir, 'out', 'bundle.js'), 'utf8'))
    })
  })
}

/** Every builder must end up writing the same set of real font artifacts. */
async function expectFontArtifacts(outputDir: string) {
  const css = await readFile(join(outputDir, 'icons.css'), 'utf8')
  expect(css).toContain('@font-face')
  expect(css).toContain('icons.woff2')

  const font = await readFile(join(outputDir, 'icons.woff2'))
  expect(font.byteLength).toBeGreaterThan(0)
  // woff2 magic number 'wOF2'
  expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2')
}

describe('webpack', () => {
  it('builds and writes real font assets', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'console.log(1)\n')

    await compile(webpack, WebpackPlugin(options(outputDir)), workDir, entry)

    await expectFontArtifacts(outputDir)
  })

  it('resolves the virtual module through the webpack loader', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'import \'fantasticon:icons\'\nconsole.log(1)\n')

    const bundle = await compile(webpack, WebpackPlugin(options(outputDir)), workDir, entry)

    // The <link> that the stub looks up is injected by the transform hook, so
    // the bundle only proves the virtual module resolved and was evaluated.
    expect(bundle).toContain('link[data-id=\'icons\']')
    // Vite-only syntax must not leak into webpack.
    expect(bundle).not.toContain('import.meta.hot')
  })
})

describe('rspack', () => {
  it('builds and writes real font assets', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'console.log(1)\n')

    await compile(rspack, RspackPlugin(options(outputDir)), workDir, entry)

    await expectFontArtifacts(outputDir)
  })

  it('resolves the virtual module to the non-vite HMR stub', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'import \'fantasticon:icons\'\nconsole.log(1)\n')

    const bundle = await compile(rspack, RspackPlugin(options(outputDir)), workDir, entry)

    expect(bundle).toContain('link[data-id=\'icons\']')
    expect(bundle).not.toContain('import.meta.hot')
  })
})

describe('rollup', () => {
  it('builds and writes real font assets', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'console.log(1)\n')

    const bundle = await rollup({ input: entry, plugins: [RollupPlugin(options(outputDir)) as any] })
    try {
      await bundle.write({ dir: join(workDir, 'out'), format: 'es' })
    }
    finally {
      await bundle.close()
    }

    await expectFontArtifacts(outputDir)
  })

  it('resolves the virtual module to the non-vite HMR stub', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'import \'fantasticon:icons\'\nconsole.log(1)\n')

    const bundle = await rollup({ input: entry, plugins: [RollupPlugin(options(outputDir)) as any] })
    let code = ''
    try {
      const { output } = await bundle.generate({ format: 'es' })
      code = output[0].code
    }
    finally {
      await bundle.close()
    }

    expect(code).toContain('link[data-id=\'icons\']')
    // Vite-only syntax must not leak into other builders.
    expect(code).not.toContain('import.meta.hot')
  })
})

describe('esbuild', () => {
  it('builds and writes real font assets', async () => {
    const outputDir = join(workDir, 'fonts')
    const entry = await writeEntry('entry.js', 'console.log(1)\n')

    await esbuildBuild({
      entryPoints: [entry],
      bundle: true,
      write: false,
      outdir: join(workDir, 'out'),
      plugins: [EsbuildPlugin(options(outputDir)) as any],
    })

    await expectFontArtifacts(outputDir)
  })
})

describe('vite', () => {
  it('builds and writes real font assets', async () => {
    const outputDir = join(workDir, 'fonts')
    // Vite computes the emitted `index.html` fileName as
    // `path.relative(config.root, id)`, and rollup rejects that name when it
    // escapes the root. `config.root` is only `path.resolve`d (never
    // realpath'd), whereas the plugin's `id` is canonicalised through
    // realpath -- so on macOS, where `tmpdir()` is a symlink
    // (/var -> /private/var), the relative path is "../../../../...".
    // Realpath the root too so both sides agree.
    const root = join(workDir, 'app')
    await mkdir(join(root, 'src'), { recursive: true })
    const realRoot = await realpath(root)
    await writeFile(join(realRoot, 'index.html'), '<html><head></head><body><script type="module" src="/src/main.js"></script></body></html>', 'utf8')
    await writeFile(join(realRoot, 'src', 'main.js'), 'console.log(1)\n', 'utf8')

    await viteBuild({
      root: realRoot,
      logLevel: 'silent',
      build: { outDir: join(workDir, 'out'), write: true },
      plugins: [VitePlugin(options(outputDir)) as VitePluginType],
    })

    await expectFontArtifacts(outputDir)

    // Vite keeps HTML injection in transformIndexHtml rather than transform().
    const html = await readFile(join(workDir, 'out', 'index.html'), 'utf8')
    // Vite normalises the injected tag, so assert on the attributes rather than
    // an exact tag string.
    expect(html).toMatch(/<link[^>]*href="\/icons\.css"[^>]*data-id="icons"/)
  })
})

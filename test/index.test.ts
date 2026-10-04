import type { Plugin } from 'vite'

import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { unpluginFactory } from '../src'

const meta = { framework: 'vite', mode: 'dev', build: false } as any

function createPlugin(overrides: Record<string, any> = {}) {
  return unpluginFactory({
    inputDir: 'playground/src/icons',
    outputDir: 'dist/fonts',
    ...overrides,
  } as any, meta) as Plugin & Record<string, any>
}

/** Run the `configureServer` middleware against a fake req/res pair. */
async function request(plugin: any, url: string) {
  let handler: any
  const middleware = {
    use(fn: any) {
      handler = fn
    },
  }
  plugin.vite.configureServer({ middlewares: middleware })

  const req = { url }
  let statusCode = 200
  const headers: Record<string, string> = {}
  let body: any
  const setHeader = (k: string, v: string) => {
    headers[k] = v
  }
  const end = (chunk?: any) => {
    body = chunk
  }
  const res = { setHeader, end }
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => {
      statusCode = v
    },
  })

  let nextCalled = false
  await handler(req, res, () => {
    nextCalled = true
  })
  return { statusCode, headers, body, nextCalled }
}

describe('assetBuilder', () => {
  it('recovers after a failed build instead of wedging the flag', async () => {
    const generateFonts = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ assetsOut: { css: '.i{}' } })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const plugin = createPlugin({ generateFonts })
    // A failing build must not reject or wedge the builder.
    await expect(plugin.writeBundle()).resolves.toBeUndefined()
    // A second build must still run rather than short-circuit on a stuck flag.
    await plugin.writeBundle()
    expect(generateFonts).toHaveBeenCalledTimes(2)

    errorSpy.mockRestore()
  })

  it('serves assets from the previous build when a rebuild fails', async () => {
    const generateFonts = vi.fn()
      .mockResolvedValueOnce({ assetsOut: { css: '.ok{}' } })
      .mockRejectedValueOnce(new Error('nope'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const plugin = createPlugin({ generateFonts })
    await plugin.writeBundle()
    await plugin.writeBundle()

    const res = await request(plugin, '/icons.css')
    expect(res.body).toBe('.ok{}')
    expect(res.headers['Content-Type']).toBe('text/css')
    vi.restoreAllMocks()
  })

  it('still writes to disk when a writeToDisk build is coalesced onto an in-flight build', async () => {
    let release!: () => void
    const generateFonts = vi.fn(async (_cfg: any, writeToDisk: boolean) => {
      // Only the first (in-memory) build blocks; that is what makes the second,
      // writeToDisk request get coalesced onto it.
      if (!release) {
        await new Promise<void>((r) => {
          release = r
        })
      }
      return {
        assetsOut: {
          css: writeToDisk ? '/* written */' : '/* in memory */',
          woff2: new Uint8Array([0x77, 0x4F, 0x46, 0x32]),
        },
      }
    })
    const plugin = createPlugin({ generateFonts })

    const devBuild = plugin.buildStart()
    await new Promise(resolve => setTimeout(resolve, 20))
    const prodBuild = plugin.writeBundle()
    release()
    await Promise.all([devBuild, prodBuild])

    // The coalesced request must not be dropped just because a build was
    // already running -- otherwise a slow machine emits no font files at all.
    // A third build must still be able to see the result.
    const res = await request(plugin, '/icons.css')
    expect(res.body).toBe('/* written */')
  })

  it('waitForBuild resolves after the in-flight build settles', async () => {
    let release!: () => void
    const generateFonts = vi.fn(async () => {
      await new Promise<void>((r) => {
        release = r
      })
      return { assetsOut: { css: '.slow{}' } }
    })

    const plugin = createPlugin({ generateFonts })
    const building = plugin.writeBundle()
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    await building

    const res = await request(plugin, '/icons.css')
    expect(res.body).toBe('.slow{}')
  })
})

describe('asset output paths', () => {
  it('never writes to a literal "undefined" directory', async () => {
    const out = await mkdtemp(join(tmpdir(), 'fanta-'))
    const generateFonts = vi.fn(async () => ({
      assetsOut: { css: '.a{}', ts: 'export const icons = {}' },
    }))

    const plugin = createPlugin({ generateFonts, outputDir: join(out, 'fonts') })
    await plugin.writeBundle()

    const entries = await readdir(out)
    expect(entries).toContain('fonts')
    expect(entries.includes('undefined')).toBe(false)

    const written = await readFile(join(out, 'fonts', 'icons.ts'), 'utf8')
    expect(written).toBe('export const icons = {}')
  })

  it('strips the ts asset from what the plugin serves', async () => {
    const generateFonts = vi.fn(async () => ({
      assetsOut: { css: '.a{}', ts: 'export const icons = {}' },
    }))
    const plugin = createPlugin({ generateFonts, outputDir: 'dist/fonts' })
    await plugin.writeBundle()

    const res = await request(plugin, '/icons.ts')
    expect(res.nextCalled).toBe(true)
  })
})

describe('dev middleware', () => {
  const generateFonts = async () => ({
    assetsOut: { css: '.a{}', woff2: Buffer.from('woff2data') },
  })

  it('serves css and font assets with correct content types', async () => {
    const plugin = createPlugin({ generateFonts })
    await plugin.writeBundle()

    const css = await request(plugin, '/icons.css')
    expect(css.headers['Content-Type']).toBe('text/css')

    const font = await request(plugin, '/icons.woff2')
    expect(font.headers['Content-Type']).toBe('font/woff2')
    expect(font.body.toString()).toBe('woff2data')
  })

  it('ignores query strings when matching', async () => {
    const plugin = createPlugin({ generateFonts })
    await plugin.writeBundle()
    const res = await request(plugin, '/icons.css?123456')
    expect(res.body).toBe('.a{}')
  })

  it('passes unrelated requests through', async () => {
    const plugin = createPlugin({ generateFonts })
    await plugin.writeBundle()
    const res = await request(plugin, '/src/main.ts')
    expect(res.nextCalled).toBe(true)
  })

  it('404s an unknown icon asset instead of crashing', async () => {
    const plugin = createPlugin({ generateFonts })
    await plugin.writeBundle()
    const res = await request(plugin, '/icons.woff')
    expect(res.statusCode).toBe(404)
  })

  it('does not treat a regex-special name as a pattern', async () => {
    const plugin = createPlugin({ generateFonts, name: 'ic.ons' })
    await plugin.writeBundle()
    const res = await request(plugin, '/icons.css')
    // `ic.ons` must not match `icons` — the dot is a literal.
    expect(res.nextCalled).toBe(true)
  })
})

describe('virtual module', () => {
  it('resolves the virtual id and its subpaths', () => {
    const plugin = createPlugin()
    expect(plugin.resolveId('fantasticon:icons')).toBe('\0fantasticon:icons')
    expect(plugin.resolveId('fantasticon:icons.css')).toBe('\0fantasticon:icons')
    expect(plugin.resolveId('fantasticon:icons/ts')).toBe('\0fantasticon:icons')
    expect(plugin.resolveId('virtual:fantasticon:icons')).toBe('\0fantasticon:icons')
    expect(plugin.resolveId('./unrelated')).toBeUndefined()
  })

  it('does not hijack ids that merely share the prefix', () => {
    const plugin = createPlugin()
    expect(plugin.resolveId('fantasticon:icons-extra')).toBeUndefined()
    expect(plugin.resolveId('fantasticon:icons_other')).toBeUndefined()
  })

  it('guards against a missing link element in the HMR handler', () => {
    const plugin = createPlugin()
    const code = plugin.load('\0fantasticon:icons') as string
    expect(code).toContain('if (!link) return;')
  })
})

describe('html injection', () => {
  it('emits a stable href', () => {
    const plugin = createPlugin()
    const result = plugin.vite.transformIndexHtml('<html><head></head></html>')
    expect(result.tags[0].attrs.href).toBe('/icons.css')
  })

  it('respects injectHtml: false', () => {
    const plugin = createPlugin({ injectHtml: false })
    const result = plugin.vite.transformIndexHtml('<html><head></head></html>')
    expect(result).toBe('<html><head></head></html>')
  })
})

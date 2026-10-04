import type { RunnerOptions } from 'fantasticon'
import type { Buffer } from 'node:buffer'
import type { FSWatcher } from 'node:fs'

import type { UnpluginFactory } from 'unplugin'
import type { WebSocketServer } from 'vite'
import type { Options } from './types'
import { promises as fs, watch as fsWatch } from 'node:fs'

import { dirname, join, normalize, relative } from 'node:path'
import { generateFonts } from 'fantasticon'
import { createUnplugin } from 'unplugin'
import { findInvalidSvgs } from './validate'

const defaultOptions = {
  generateFonts,
  injectHtml: true,

  // fantasticon options
  name: 'icons',
  inputDir: 'src/icons',
  outputDir: 'dist/fonts',
  fontTypes: ['woff2', 'woff', 'ttf'] as import('fantasticon').FontAssetType[],
  assetTypes: ['css', 'html'] as import('fantasticon').OtherAssetType[],
} satisfies Options

/**
 * Compare a `load` hook id against the virtual module id.
 *
 * webpack-family loaders pass the id through `path.normalize`, which on
 * Windows turns the leading `\0` into `\\\0`. A strict `===` therefore misses
 * the virtual module there and silently emits an empty module, so compare the
 * trailing part instead.
 */
function isVirtualId(id: string, virtualModuleId: string): boolean {
  return id === virtualModuleId || id.endsWith(virtualModuleId)
}

export interface AssetBuilder {
  build: (writeToDisk?: boolean) => Promise<Partial<Record<import('fantasticon').AssetType, string | Buffer>>>
  get: (assetType: string) => string | Buffer | undefined
  watch: (ws: () => WebSocketServer | undefined, event: string) => () => void
  end: () => void
  waitForBuild: () => Promise<void>
}

function assetBuilder(config: RunnerOptions, generateFonts = defaultOptions.generateFonts): AssetBuilder {
  let assets: Partial<Record<import('fantasticon').AssetType, string | Buffer>> = {}
  let watcher: FSWatcher | undefined
  let stopped = false

  // Single source of truth for "is a build in flight". Resolvers are flushed
  // when the current run settles, so waiters never poll or hang.
  let building = false
  let pending: Promise<void> | undefined
  const waiters: (() => void)[] = []

  function settle(): void {
    building = false
    const resolve = waiters.splice(0)
    for (const r of resolve)
      r()
  }

  async function runBuild(writeToDisk: boolean): Promise<void> {
    const cfg = { ...config }
    const outputDir = config.outputDir
    if (writeToDisk && outputDir)
      await fs.mkdir(outputDir, { recursive: true })

    // Pre-flight check. A malformed SVG makes fantasticon crash the whole
    // process (see ./validate.ts), so never hand it a broken input.
    const invalid = await findInvalidSvgs(config.inputDir)
    if (invalid.length) {
      throw new Error(
        `Skipping font generation: ${invalid.length} malformed SVG(s) in '${config.inputDir}':\n${
          invalid.map(f => `  - ${f}`).join('\n')}`,
      )
    }

    cfg.inputDir = relative('.', cfg.inputDir)
    if (!writeToDisk)
      cfg.outputDir = undefined as any
    // eslint-disable-next-line no-console
    console.log(`[fantasticon] Generating fonts from '${cfg.inputDir}'...`)

    const results = await generateFonts(cfg, writeToDisk)
    const generated = { ...results.assetsOut }

    if (generated.ts) {
      const ts = generated.ts
      delete generated.ts
      // Only emit the .ts file on a real (writeToDisk) build. Deriving the path
      // from the mutated cfg would write to "undefined/<name>.ts", and writing
      // during in-memory dev builds would touch dist on every rebuild.
      if (writeToDisk && outputDir) {
        const filePath = join(outputDir, `${config.name}.ts`)
        await fs.mkdir(dirname(filePath), { recursive: true })
        await fs.writeFile(filePath, ts as string)
      }
    }

    assets = generated
  }

  async function build(writeToDisk = false): Promise<Partial<Record<import('fantasticon').AssetType, string | Buffer>>> {
    if (building) {
      console.warn('[fantasticon] Already building, skipping...')
      await pending
      return assets
    }

    building = true
    pending = runBuild(writeToDisk)
      .catch((error) => {
        // Keep the previous assets so a transient failure degrades gracefully
        // instead of wiping the dev server's responses.
        console.error('[fantasticon] Failed to generate fonts:', error)
      })
      .finally(() => {
        pending = undefined
        settle()
      })

    await pending
    return assets
  }

  function debounced(ms: number, fn: () => void | Promise<void>) {
    let timeout: NodeJS.Timeout | undefined
    return () => {
      if (timeout !== undefined)
        clearTimeout(timeout)
      timeout = setTimeout(() => {
        timeout = undefined
        return fn()
      }, ms)
    }
  }

  function watchDebounced(path: string, fn: () => void, ms = 100): FSWatcher {
    return fsWatch(normalize(path), debounced(ms, fn))
  }

  function get(assetType: string): string | Buffer | undefined {
    return assets[assetType as import('fantasticon').AssetType]
  }

  function watch(ws: () => WebSocketServer | undefined, event: string): () => void {
    stopped = false
    const start = build().then(() => {
      // buildEnd() may have run while the first build was in flight; if so,
      // drop the watcher instead of leaking it.
      if (stopped || watcher)
        return
      watcher = watchDebounced(config.inputDir, async () => {
        try {
          await build()
        }
        catch (error) {
          console.error('[fantasticon] Rebuild failed:', error)
        }
        ws()?.send({ type: 'custom', event, data: {} })
      })
    })
    // Swallow here too: runBuild already logs, this just avoids a stray
    // unhandled rejection surfacing as a crash.
    start.catch(() => {})
    return end
  }

  function end(): void {
    stopped = true
    if (watcher) {
      watcher.close()
      watcher = undefined
    }
  }

  function waitForBuild(): Promise<void> {
    if (!building)
      return Promise.resolve()
    return new Promise<void>((resolve) => {
      waiters.push(resolve)
    })
  }

  return {
    build,
    get,
    watch,
    end,
    waitForBuild,
  }
}

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options = {}, meta) => {
  const {
    generateFonts,
    injectHtml,

    ...config
  } = {
    ...defaultOptions,
    ...options,
  }

  const name = `fantasticon:${config.name}`
  const virtualModuleId = `\0${name}`
  const updateEvent = `${name}:update`

  let wss = undefined as WebSocketServer | undefined

  const builder = assetBuilder(config, generateFonts)

  return {
    name,
    resolveId(id) {
      // Subpath imports like `fantasticon:icons.css` are the documented way to
      // pull in the HMR handler, so a prefix match is required. Bound it to a
      // real subpath segment so unrelated ids that merely share the prefix
      // are not hijacked.
      if (id === name || id.startsWith(`${name}.`) || id.startsWith(`${name}/`) || id === `virtual:${name}`)
        return virtualModuleId
    },
    load(id) {
      if (isVirtualId(id, virtualModuleId)) {
        // The injected <link> uses `data-id=config.name`, so the selector must
        // match it -- using the plugin name here would never match anything.
        if (meta.framework === 'vite') {
          return `import.${'meta'}.hot && import.${'meta'}.hot.on("${updateEvent}", () => {
            const link = document.querySelector("link[data-id='${config.name}']");
            if (!link) return;
            const url = new URL(link.href);
            url.searchParams.set("t", Date.now());
            link.setAttribute("href", url.href);
          });`
        }
        else {
          return `(function() {
            const link = document.querySelector("link[data-id='${config.name}']");
            if (link) {
              const url = new URL(link.href);
              url.searchParams.set("t", Date.now());
              link.setAttribute("href", url.href);
            }
          })();`
        }
      }
    },
    async buildStart() {
      if (meta.framework === 'vite') {
        builder.watch(() => wss, updateEvent)
      }
      else {
        await builder.build()
      }
    },
    buildEnd() {
      if (meta.framework === 'vite') {
        builder.end()
      }
    },

    async writeBundle() {
      await builder.build(true)
    },

    vite: {
      handleHotUpdate(ctx) {
        wss = ctx.server.ws
      },
      transformIndexHtml(html) {
        if (!injectHtml)
          return html

        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: {
                'rel': 'stylesheet',
                'type': 'text/css',
                // Stable href; the HMR handler appends a cache-busting
                // timestamp only when icons actually change.
                'href': `/${`${config.name}.css`}`,
                'data-id': config.name,
              },
              injectTo: 'head',
            },
          ],
        }
      },
      configureServer(server) {
        // Escape the configured name so regex metacharacters in it cannot
        // change the match (or throw).
        const escapedName = config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const fontRe = new RegExp(`^/${escapedName}\\.(woff2|woff|ttf|eot|svg)$`)
        const mimeTypes: Record<string, string> = {
          css: 'text/css',
          html: 'text/html',
          json: 'application/json',
          ts: 'text/plain',
          woff2: 'font/woff2',
          woff: 'font/woff',
          ttf: 'font/ttf',
          eot: 'application/vnd.ms-fontobject',
          svg: 'image/svg+xml',
        }

        server.middlewares.use(async (req, res, next) => {
          if (!req.url)
            return next()

          const url = req.url.split('?')[0]
          const fontMatch = fontRe.exec(url)
          const assetType = url === `/${escapedName}.css`
            ? 'css'
            : fontMatch?.[1]

          if (!assetType)
            return next()

          try {
            await builder.waitForBuild()
            const asset = builder.get(assetType)
            if (!asset || (!(asset instanceof Uint8Array) && typeof asset !== 'string')) {
              res.statusCode = 404
              res.end('Not Found')
              return
            }
            res.setHeader('Content-Type', mimeTypes[assetType] ?? 'application/octet-stream')
            res.setHeader('Cache-Control', 'no-cache')
            res.end(asset)
          }
          catch (error) {
            server.config.logger.error(
              `[fantasticon] failed to serve ${url}: ${error instanceof Error ? error.message : String(error)}`,
            )
            res.statusCode = 500
            res.end('Internal Server Error')
          }
        })
      },
    },
    webpack(compiler) {
      // Webpack short-circuits any `scheme:` request into
      // NormalModuleFactory#resolveForScheme before enhanced-resolve (where
      // unplugin installs its resolveId hook) ever sees it, so the virtual
      // module fails with `UnhandledSchemeError` on webpack. Point the scheme at
      // the same virtual file unplugin's resolver would have produced; the load
      // loader then strips the prefix and calls our `load` hook as usual.
      const plugin = this as any
      const virtualPrefix: string | undefined = plugin.__virtualModulePrefix
      const vfs = plugin.__vfs
      if (!virtualPrefix || !vfs)
        return

      compiler.hooks.normalModuleFactory.tap(name, (nmf: any) => {
        nmf.hooks.resolveForScheme.for('fantasticon').tapAsync(name, async (resourceData: any, _data: any, cb: any) => {
          try {
            const file = join(virtualPrefix, encodeURIComponent(virtualModuleId))
            // Register through unplugin's virtual-module store so the directory
            // is removed on compiler shutdown instead of leaking into the repo.
            if (!plugin.__vfsModules.has(file)) {
              plugin.__vfsModules.add(file)
              await vfs.writeModule(file, '')
            }
            resourceData.resource = file
            cb()
          }
          catch (error) {
            cb(error)
          }
        })
      })
    },
    transform: {
      filter: {
        id: 'index.html',
      },
      handler(code) {
        if (!injectHtml || meta.framework === 'vite')
          return code

        return {
          code: code.replace(
            '</head>',
            `<link rel="stylesheet" href="/${config.name}.css" data-id="${config.name}"></head>`,
          ),
          map: null,
        }
      },
    },
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin

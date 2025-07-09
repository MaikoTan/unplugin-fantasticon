import { FSWatcher, watch as fsWatch, promises as fs } from 'fs'
import { dirname, normalize, relative } from 'path'

import { generateFonts, type RunnerOptions } from 'fantasticon'
import { createUnplugin } from 'unplugin'

import type { UnpluginFactory } from 'unplugin'
import type { Options } from './types'
import type { WebSocketServer } from 'vite'

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

function assetBuilder(config: RunnerOptions) {
  let building = false;
  let assets: Partial<Record<import('fantasticon').AssetType, string | Buffer>> = {};
  let watcher: FSWatcher | undefined = undefined;

  async function build(writeToDisk = false) {
    const cfg = { ...config };
    if (building) {
      // eslint-disable-next-line no-console
      console.warn("[fantasticon] Already building, skipping...");
      return assets;
    }
    building = true;
    if (!writeToDisk) cfg.outputDir = undefined as any;
    else await fs.mkdir(cfg.outputDir, { recursive: true });
    cfg.inputDir = relative(".", cfg.inputDir);
    // eslint-disable-next-line no-console
    console.log(`[fantasticon] Generating fonts from '${cfg.inputDir}'...`);

    const results = await generateFonts(cfg, writeToDisk);
    assets = results.assetsOut;
    if (assets.ts) {
      const ts = assets.ts;
      delete assets.ts;
      const filePath = relative(".", `${cfg.outputDir}/${cfg.name}.ts`);
      const dir = dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, ts as string);
    }
    building = false;
    return assets;
  }

  function debounced(ms: number, fn: () => void | Promise<void>) {
    let timeout: number | undefined = undefined;
    return () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = setTimeout(fn, ms) as never;
    };
  }

  function watchDebounced(path: string, fn: () => void, ms = 100) {
    return fsWatch(normalize(path), debounced(ms, fn));
  }

  function get(assetType: string) {
    if (assets[assetType as import('fantasticon').AssetType]) {
      return assets[assetType as import('fantasticon').AssetType];
    }
    return undefined;
  }

  function watch(ws: () => WebSocketServer | undefined, event: string) {
    if (watcher) return end;
    build().then(() => {
      watcher = watchDebounced(config.inputDir, async () => {
        await build();
        ws()?.send({ type: "custom", event, data: {} });
      });
    });
    return end;
  }

  function end() {
    if (watcher) {
      watcher.close();
      watcher = undefined;
    }
  }

  function waitForBuild() {
    return new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (!building) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  return {
    build,
    get,
    watch,
    end,
    waitForBuild,
  };
}

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options = {}, meta) => {
  const {
    generateFonts,
    injectHtml,

    ...config
  } = {
    ...defaultOptions,
    ...options
  }

  const name = `fantasticon:${config.name}`
  const virtualModuleId = `\0${name}`
  const updateEvent = `${name}:update`

  let wss = undefined as WebSocketServer | undefined

  const builder = assetBuilder(config)

  return {
    name,
    resolveId(id) {
      if (id.startsWith(name)) return virtualModuleId
    },
    load(id) {
      if (id === virtualModuleId) {
        if (meta.framework === 'vite') {
          return `import.${"meta"}.hot && import.${"meta"}.hot.on("${updateEvent}", () => {
            const link = document.querySelector("link[data-id='${name}']");
            const href = link.href.slice(0, link.href.indexOf("?")) + "?" + Date.now();
            link.setAttribute("href", href);
          });`
        } else {
          return `(function() {
            const link = document.querySelector("link[data-id='${name}']");
            if (link) {
              const href = link.href.slice(0, link.href.indexOf("?")) + "?" + Date.now();
              link.setAttribute("href", href);
            }
          })();`
        }
      }
    },
    async buildStart() {
      if (meta.framework === 'vite') {
        builder.watch(() => wss, updateEvent)
      } else {
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
      transformIndexHtml(html, ctx) {
        if (!injectHtml) return html

        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: {
                rel: 'stylesheet',
                type: 'text/css',
                href: `/${`${config.name}.css`}?${Date.now()}`,
                'data-id': config.name,
              },
              injectTo: 'head',
            }
          ],
        }
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url) return next()

          const url = req.url.split('?')[0]
          if (url === `/${config.name}.css`) {
            await builder.waitForBuild()
            const asset = builder.get('css');
            console.log(asset)
            if (asset) {
              res.setHeader('Content-Type', 'text/css');
              res.end(asset.toString());
            } else {
              res.statusCode = 404;
              res.end('Not Found');
            }
          } else if (new RegExp(`^/${config.name}\\.(woff2|woff|ttf)$`).test(url)) {
            await builder.waitForBuild()
            const assetType = url.split('.').pop() as import('fantasticon').AssetType;
            const asset = builder.get(url.split('.')[1] as import('fantasticon').AssetType);
            console.log(asset)
            if (asset) {
              res.setHeader('Content-Type', 'font/' + assetType);
              res.end(asset as Buffer);
            } else {
              res.statusCode = 404;
              res.end('Not Found');
            }
          } else {
            next()
          }
        })
      },
    },
    transform: {
      filter: {
        id: 'index.html',
      },
      handler(code) {
        if (!injectHtml || meta.framework === 'vite') return code

        return {
          code: code.replace(
            '</head>',
            `<link rel="stylesheet" href="/${config.name}.css" data-id="${config.name}"></head>`
          ),
          map: null,
        }
      }
    }
  }
}

export const unplugin = /* #__PURE__ */ createUnplugin(unpluginFactory)

export default unplugin

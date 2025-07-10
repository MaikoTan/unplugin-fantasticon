# unplugin-fantasticon

[![NPM version](https://img.shields.io/npm/v/unplugin-fantasticon?color=a1b858&label=)](https://www.npmjs.com/package/unplugin-fantasticon)

A [unplugin](https://github.com/unjs/unplugin) plugin to generate iconfonts from SVGs using [fantasticon](https://github.com/twbs/fantasticon).

## Install

```bash
npm i -D unplugin-fantasticon
```

```bash
yarn add -D unplugin-fantasticon
```

```bash
pnpm add -D unplugin-fantasticon
```

<details>
<summary>Vite</summary><br>

```ts
// vite.config.ts
import Fantasticon from 'unplugin-fantasticon/vite'

export default defineConfig({
  plugins: [
    Fantasticon({ /* options */ }),
  ],
})
```

Example: [`playground/`](./playground/)

<br></details>

<details>
<summary>Rollup</summary><br>

```ts
// rollup.config.js
import Fantasticon from 'unplugin-fantasticon/rollup'

export default {
  plugins: [
    Fantasticon({ /* options */ }),
  ],
}
```

<br></details>

<details>
<summary>Webpack</summary><br>

```ts
// webpack.config.js
module.exports = {
  /* ... */
  plugins: [
    require('unplugin-fantasticon/webpack')({ /* options */ })
  ]
}
```

<br></details>

<details>
<summary>Nuxt</summary><br>

```ts
// nuxt.config.js
export default defineNuxtConfig({
  modules: [
    ['unplugin-fantasticon/nuxt', { /* options */ }],
  ],
})
```

> This module works for both Nuxt 2 and [Nuxt Vite](https://github.com/nuxt/vite)

<br></details>

<details>
<summary>Vue CLI</summary><br>

```ts
// vue.config.js
module.exports = {
  configureWebpack: {
    plugins: [
      require('unplugin-fantasticon/webpack')({ /* options */ }),
    ],
  },
}
```

<br></details>

<details>
<summary>esbuild</summary><br>

```ts
// esbuild.config.js
import { build } from 'esbuild'
import Fantasticon from 'unplugin-fantasticon/esbuild'

build({
  plugins: [Fantasticon()],
})
```

<br></details>

## Configuration

This plugin uses the same options as [fantasticon](https://github.com/twbs/fantasticon#options).

There are some additional options that can be used to configure the plugin:

### `generateFonts`

- Type: `(userOptions: RunnerOptions, mustWrite?: boolean) => Promise<RunnerResults>`
- Default: `generateFonts` from [`@twbs/fantasticon`](https://github.com/twbs/fantasticon#options)

This option allows you to provide a custom function to generate the icon fonts. The function should return a promise that resolves to the results of the font generation.

### `injectHtml`

- Type: `boolean`
- Default: `true`

If set to `true`, the plugin will inject a `<link>` tag into the HTML files to load the generated CSS file. This is useful for development, but you may want to disable it in production.

## Related Projects

- [@twbs/fantasticon](https://www.npmjs.com/package/@twbs/fantasticon): The underlying library used to generate the icon fonts. It is a fork of the original [fantasticon](https://github.com/tancredi/fantasticon) library with some improvements and bug fixes.
- [@varlet/unplugin-icon-builder](https://www.npmjs.com/package/@varlet/unplugin-icon-builder): A similar unplugin that generates icon fonts from SVGs, but uses [@varlet/icon-builder](https://www.npmjs.com/package/@varlet/icon-builder) instead of fantasticon. It is designed to work with the Varlet UI library, but can be used independently as well.
- [unplugin-icons](https://github.com/unplugin/unplugin-icons): A unplugin that provides a collection of popular icon sets as Vue components, React components, and SVGs. It supports various icon sets like FontAwesome, Material Icons, and more.

This plugin is inspired by [vite-plugin-fantasticon](https://www.npmjs.com/package/vite-plugin-fantasticon), which is a Vite plugin that does the same thing.

## License

This project is licensed under [MIT](https://opensource.org/license/MIT).

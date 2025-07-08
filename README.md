# unplugin-fantasticon

[![NPM version](https://img.shields.io/npm/v/unplugin-fantasticon?color=a1b858&label=)](https://www.npmjs.com/package/unplugin-fantasticon)

A [unplugin](https://github.com/unjs/unplugin) plugin to generate iconfonts from SVGs using [fantasticon](https://github.com/twbs/fantasticon).

## Install

```bash
npm i unplugin-fantasticon
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

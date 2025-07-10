import { defineConfig } from 'vite'
import Inspect from 'vite-plugin-inspect'
import Fantasticon from '../src/vite'

export default defineConfig({
  plugins: [
    Inspect(),
    Fantasticon({
      name: 'iconfont',
      inputDir: 'src/icons',
      outputDir: 'dist/fonts',
      fontTypes: ['woff2', 'woff', 'ttf'],
      assetTypes: ['css', 'html'],
      injectHtml: true,
    }),
  ],
})

import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import livereload from 'rollup-plugin-livereload'
import serve from 'rollup-plugin-serve'
// eslint-disable-next-line antfu/no-import-dist
import Fantasticon from '../dist/rollup'

export default {
  input: 'main.ts',
  output: {
    dir: 'dist',
    format: 'es',
    sourcemap: true,
  },
  plugins: [
    resolve(),
    commonjs({ extensions: ['.js', '.ts'] }),
    typescript({
      sourceMap: true,
      inlineSources: true,
    }),
    Fantasticon({
      name: 'iconfont',
      inputDir: 'src/icons',
      outputDir: 'dist/fonts',
      fontTypes: ['woff2', 'woff', 'ttf'] as import('fantasticon').FontAssetType[],
      assetTypes: ['css', 'html'] as import('fantasticon').OtherAssetType[],
      injectHtml: true,
    }),
    serve({
      open: true,
      contentBase: ['dist', '.'],
      port: 3000,
    }),
    livereload('dist'),
  ],
}

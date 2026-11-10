// rollup-plugin-serve 的 package.json exports 未声明 types，在 bundler 解析模式下
// 找不到自带声明文件，这里手动补一个最小类型。
declare module 'rollup-plugin-serve' {
  import type { Plugin } from 'rollup'

  export default function serve(options?: Record<string, unknown>): Plugin
}

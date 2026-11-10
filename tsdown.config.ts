import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/*.ts'],
  outputOptions: {
    // 声明文件的 chunk 名去掉哈希，保证产物与 package.json 中的 types/exports 路径一致
    chunkFileNames: chunk =>
      chunk.name.endsWith('.d') ? `${chunk.name.slice(0, -2)}.d.ts` : '[name]-[hash].js',
  },
})

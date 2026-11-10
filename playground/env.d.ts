// unplugin-fantasticon 在构建时注入的虚拟模块，如 `fantasticon:iconfont.css`。
declare module 'fantasticon:*' {
  const asset: string
  export default asset
}

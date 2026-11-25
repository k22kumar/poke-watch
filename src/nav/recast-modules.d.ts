// Types for the package file the page loader imports that ships no declaration of its own (scripts/lib/navwasm.mjs turns
// it into the URL of the fetched side file dist/nav/).
declare module '@recast-navigation/wasm/recast-navigation.wasm.wasm' {
  const url: string;
  export default url;
}

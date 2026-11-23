// S1 spike: types for the two package files the loaders import that ship no declarations of their own.
declare module '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.js' {
  export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
declare module '@dimforge/rapier3d-deterministic/rapier_wasm3d_bg.wasm' {
  const url: string;
  export default url;
}

// Types for the dependency-free PNG codec (png.mjs) so TypeScript scripts and tests can import it.
export function decodePng(buf: Uint8Array | ArrayBuffer): { width: number; height: number; data: Uint8Array };
export function encodePng(width: number, height: number, data: Uint8Array): Buffer;

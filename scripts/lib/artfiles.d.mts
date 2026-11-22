// Types for scripts/lib/artfiles.mjs so TypeScript tests can import it.
export function writeArt(outDir: string, bundlePath?: string): Promise<{ manifest: string; heroes: string; files: number; bytes: number }>;

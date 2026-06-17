import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  // No sourcemaps in the published package: they would embed the full .ts source (comments and all).
  // The source is on GitHub for anyone who wants to debug against it.
  sourcemap: false,
  // The core (index) is universal: it touches only `fetch` and Web Crypto, so it runs on Node 18+,
  // Cloudflare Workers, Deno, Bun, and browsers. `node` is the only entry that imports node:fs.
  target: 'es2021',
  treeshake: true,
});

import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

// Tomato Tracker SPA — deployed to GitHub Pages at
// https://jedwood.github.io/tomato-tracker/. Pages serves from master branch
// root, so deploy-ghpages.mjs copies dist/* into the repo root after build.
//
// Multi-page inputs: index.html (harvest) is the canonical bookmarked URL;
// claim.html (added in a later task) will be the family-facing claim form.
export default defineConfig(({ command }) => ({
  // Pages site is served at /tomato-tracker/. Setting base ensures asset
  // paths resolve under that subpath in the built HTML.
  base: command === 'build' ? '/tomato-tracker/' : '/',
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
      },
    },
  },
  server: { port: 5275 },
}));

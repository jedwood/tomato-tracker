#!/usr/bin/env node
/**
 * GitHub Pages deploy for the tomato-tracker SPA.
 *
 * Pages serves https://jedwood.github.io/tomato-tracker/ from the master
 * branch root, so this script:
 *   1. Builds spa/ → spa/dist/.
 *   2. Greps the build for canary strings (catch leaked dev tokens).
 *   3. Copies dist/* into the repo root.
 *   4. Stages the copied files + commits + pushes.
 *
 * The committed assets (root index.html, claim.html, assets/) are the
 * deployed site. **Don't hand-edit the root files** — always re-run the
 * deploy. Source of truth is spa/src/.
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const spaDir = join(repoRoot, 'spa');
const distDir = join(spaDir, 'dist');

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

// --- preflight ---
const envPath = join(spaDir, '.env');
if (!existsSync(envPath)) {
  console.error('\n✗ spa/.env missing. Copy spa/.env.example and fill it in.');
  process.exit(1);
}
const envText = readFileSync(envPath, 'utf8');
const required = ['VITE_GAS_API_URL', 'VITE_HARVEST_TOKEN'];
const missing = required.filter((k) => !new RegExp(`^${k}=.+`, 'm').test(envText));
if (missing.length) {
  console.error(`\n✗ spa/.env missing keys: ${missing.join(', ')}`);
  process.exit(1);
}

// --- build ---
if (existsSync(distDir)) rmSync(distDir, { recursive: true });
run('npm run build', { cwd: spaDir });

// --- post-build canary scan ---
// Be paranoid about anything dev-only ending up in the bundle.
const canaries = [
  'localhost', '127.0.0.1', '5275',
  // Smoke for any DEV_BYPASS leak. The harvest + claims tokens *are* embedded
  // by design, so they're allowed.
  process.env.DEV_BYPASS_TOKEN,
].filter(Boolean);
const suspects = [];
walk(distDir, (p) => {
  if (!/\.(js|mjs|css|html|json|map)$/.test(p)) return;
  const txt = readFileSync(p, 'utf8');
  for (const c of canaries) if (txt.includes(c)) suspects.push({ p, c });
});
if (suspects.length) {
  console.error('\n✗ Canary matched in build output — refusing to deploy.');
  for (const s of suspects) console.error(`  ${s.c}  →  ${relative(repoRoot, s.p)}`);
  process.exit(2);
}

// --- copy dist/* into repo root ---
// The list of root-managed files is exactly what was in dist/. Track them so
// the next deploy can overwrite cleanly.
const distFiles = readdirSync(distDir);
for (const name of distFiles) {
  const src = join(distDir, name);
  const dst = join(repoRoot, name);
  // Wipe existing copy so renamed assets don't leave orphans.
  if (existsSync(dst)) rmSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`  copy  ${name}`);
}

// --- commit + push ---
// Stage exactly the copied paths (don't sweep up unrelated working changes).
const paths = distFiles.map((n) => `'${n}'`).join(' ');
run(`git add ${paths}`, { cwd: repoRoot });

// Skip if nothing changed.
let changed = '';
try { changed = execSync('git diff --cached --name-only', { cwd: repoRoot }).toString().trim(); }
catch { /* ignore */ }
if (!changed) {
  console.log('\n✓ No changes to deploy.');
  process.exit(0);
}

const ts = new Date().toISOString();
run(`git commit -m "spa: deploy ${ts}"`, { cwd: repoRoot });
run('git push origin master', { cwd: repoRoot });

console.log('\n✓ Deployed. https://jedwood.github.io/tomato-tracker/ should update within ~1 min.');

function walk(dir, cb) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, cb);
    else cb(p);
  }
}

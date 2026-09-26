#!/usr/bin/env node
// scripts/mint-licence.mjs — mints a License to the WIF key in a file, from that key's own
// testnet balance (mw-f758y.22.5). Usage:
//   node scripts/mint-licence.mjs --key-file <path> [--dry-run]
// A thin launcher: the real implementation lives under scripts/mint/, its own
// package.json/node_modules, so a fresh host can `npm install` there without the whole PWA's
// dependencies (vite, react, playwright — see scripts/mint/package.json).
await import('./mint/cli.mjs');

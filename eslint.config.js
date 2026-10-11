import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import noOneshotFindAssert from './eslint-rules/no-oneshot-find-assert.js';

// The chain files: the code that talks to the chain (WhatsOnChain, the backend's coin and
// broadcast routes, spell-forge-bsv's chain provider). Everything else under src reaches the
// chain through src/chain.ts (mw-e6e8f2.2, mw-e6e8f2.3), so none of it may import one of the
// chain modules directly. The chain files are exempt, and they are:
//   src/chain.ts
//   src/services/{send,spendable,chainRead,whatsonchain,confirmedHistory,chainPacer,sharedChainReads,stamp,licence,mint,issue}.ts
//   the chain-only components src/key/IssueLicences.tsx, src/licence/LicenceExplainer.tsx and
//   src/cockpit/StampSection.tsx (src/chain.ts offers them as `chain.screens`).
const CHAIN_MODULES = ['send', 'spendable', 'chainRead', 'whatsonchain', 'confirmedHistory', 'chainPacer', 'sharedChainReads', 'stamp', 'licence', 'mint', 'issue'];
const CHAIN_COMPONENTS = ['src/key/IssueLicences.tsx', 'src/licence/LicenceExplainer.tsx', 'src/cockpit/StampSection.tsx'];

const refuseChainModules = (group) => ({
  'no-restricted-imports': ['error', { patterns: [{ group, message: 'Reach the chain through src/chain.ts, not a chain module directly.' }] }],
});

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // inside src/services a chain module is './name'; elsewhere './send' may be some other module's own
    files: ['src/services/**/*.{ts,tsx}'],
    ignores: CHAIN_MODULES.map((name) => `src/services/${name}.ts`),
    rules: refuseChainModules(CHAIN_MODULES.flatMap((name) => [`./${name}`, `../services/${name}`])),
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/chain.ts', 'src/services/**', ...CHAIN_COMPONENTS],
    rules: refuseChainModules(CHAIN_MODULES.map((name) => `**/services/${name}`)),
  },
  {
    // mw-gq6.362: findBy* resolves when the element exists, so a text or state matcher asserted once on its
    // result races the effect (mw-tfne4.38); wait for the text, or put the assert in a waitFor.
    files: ['tests/**/*.{ts,tsx}', 'features/**/*.{ts,tsx}'],
    plugins: { postern: { rules: { 'no-oneshot-find-assert': noOneshotFindAssert } } },
    rules: { 'postern/no-oneshot-find-assert': 'error' },
  },
]);

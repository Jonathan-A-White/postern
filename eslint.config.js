import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

// The chain modules: the code that talks to the chain (WhatsOnChain, the backend's coin and
// broadcast routes, spell-forge-bsv's chain provider). Every other service reaches the chain
// through src/chain.ts (mw-e6e8f2.2), so none of them may import one of these directly.
// src/chain.ts and the modules themselves are exempt. src/key, src/licence and src/cockpit
// are not covered yet: their screens move to src/chain.ts in the next story.
const CHAIN_MODULES = ['send', 'spendable', 'chainRead', 'whatsonchain', 'confirmedHistory', 'stamp', 'licence', 'mint', 'issue'];

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
    files: ['src/services/**/*.{ts,tsx}'],
    ignores: CHAIN_MODULES.map((name) => `src/services/${name}.ts`),
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: CHAIN_MODULES.flatMap((name) => [`./${name}`, `../services/${name}`]),
              message: 'Reach the chain through src/chain.ts, not a chain module directly.',
            },
          ],
        },
      ],
    },
  },
]);

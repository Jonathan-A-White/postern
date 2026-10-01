import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
// Not '@testing-library/react': importing it here would register its auto-unmount before
// the step files' dont-cleanup-after-each import can switch that off.
import { configure } from '@testing-library/dom';

// waitFor/findBy default to 1 s, which the landing gate's loaded host outruns
// (mw-gq6.204, .199, .205). vitest's testTimeout (20 s) stays well above this.
configure({ asyncUtilTimeout: 5000 });

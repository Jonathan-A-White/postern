// tests/e2e/stored-draft.ts — mw-gq6.684: whether a composer's words have reached the phone (src/cockpit/useDraft.ts
// writes them DRAFT_SAVE_MS after the last keystroke), so a spec waits on that and not on a fixed pause.
import type { Page } from '@playwright/test';

/** True once some draft row in the settings store holds exactly `words`. */
export async function draftIsStored(page: Page, words: string): Promise<boolean> {
  return page.evaluate(
    (wanted) =>
      new Promise<boolean>((resolve, reject) => {
        const open = indexedDB.open('PosternDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction(['settings']).objectStore('settings').getAll();
          all.onsuccess = () => {
            db.close();
            resolve((all.result as Array<{ key: string; value: unknown }>).some((row) => row.key.startsWith('draft:') && row.value === wanted));
          };
          all.onerror = () => reject(all.error);
        };
      }),
    words,
  );
}

// src/ui/toastStore.ts — the toasts waiting to be shown; src/ui/toast.tsx draws them.
export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
  /** One optional tap beside the words (the Needs card's "Open"); the toast leaves when it is tapped. */
  action?: { label: string; onClick: () => void };
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentToasts(): Toast[] {
  return toasts;
}

export function toast(text: string, tone: Toast['tone'] = 'ok', ms = 3500, action?: Toast['action']): void {
  const id = nextId++;
  const dismiss = () => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  };
  toasts = [...toasts, { id, text, tone, action: action && { label: action.label, onClick: () => { action.onClick(); dismiss(); } } }];
  emit();
  setTimeout(dismiss, ms);
}


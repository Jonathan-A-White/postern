// src/ui/toastStore.ts — the toasts waiting to be shown; src/ui/toast.tsx draws them.
export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error';
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

export function toast(text: string, tone: Toast['tone'] = 'ok', ms = 3500): void {
  const id = nextId++;
  toasts = [...toasts, { id, text, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, ms);
}


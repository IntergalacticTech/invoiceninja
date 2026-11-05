import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  message: string;
  kind: 'error' | 'info';
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function notify(message: string, kind: Toast['kind'] = 'error'): void {
  // Collapse repeats of the same message.
  if (toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, message, kind }];
  emit();
  setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4000);
}

export function dismiss(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function clearToasts(): void {
  toasts = [];
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => toasts;

export const useToasts = () => useSyncExternalStore(subscribe, snapshot, snapshot);

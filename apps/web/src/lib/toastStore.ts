// Toast store: a tiny ring buffer of vote/credit events for the
// Live Ticker page. The SSE consumer pushes events here; the right
// rail subscribes and animates them in. Entries auto-dismiss after
// 6 s (AC-7).
import { create } from "zustand";

export type ToastKind = "delta" | "credits-blocked" | "credits-recovered";

export interface Toast {
  id: number;
  kind: ToastKind;
  delta?: number;
  credits?: number;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "createdAt">) => void;
  dismiss: (id: number) => void;
}

const MAX_TOASTS = 5;
const TOAST_TTL_MS = 6_000;

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => {
    const id = nextId++;
    const entry: Toast = { ...t, id, createdAt: Date.now() };
    set((s) => ({
      toasts: [...s.toasts, entry].slice(-MAX_TOASTS),
    }));
    // Auto-dismiss after TTL. setTimeout is fine here because the
    // store is a single-process zustand instance per browser tab.
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, TOAST_TTL_MS);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

import { create } from "zustand";

export type ToastTone = "info" | "success" | "error";

export interface Toast {
  id: number;
  text: string;
  tone: ToastTone;
}

/** How long a toast stays up. */
export const TOAST_MS = 4_000;

interface UiState {
  /** The node shown in the details drawer, if any. */
  selectedNode: number | null;
  toasts: Toast[];
  openNode: (num: number) => void;
  closeNode: () => void;
  toast: (text: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
}

let nextToast = 1;

/** UI-only state shared across pages: the node details drawer and toasts. */
export const useUiStore = create<UiState>()((set, get) => ({
  selectedNode: null,
  toasts: [],
  openNode: (selectedNode) => {
    set({ selectedNode });
  },
  closeNode: () => {
    set({ selectedNode: null });
  },
  toast: (text, tone = "info") => {
    const id = nextToast++;
    // Newest last; at most three at once.
    set({ toasts: [...get().toasts, { id, text, tone }].slice(-3) });
    setTimeout(() => {
      get().dismissToast(id);
    }, TOAST_MS);
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** Opens the node details drawer (for event handlers outside React). */
export function openNodeDetails(num: number): void {
  useUiStore.getState().openNode(num);
}

export function resetUiStore(): void {
  useUiStore.setState({ selectedNode: null, toasts: [] });
}

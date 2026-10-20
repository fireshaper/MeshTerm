import { X } from "lucide-react";
import { useUiStore } from "../data/ui-store.js";

/** Short confirmations of things the user did (reconnect, favorite, copy). */
export function Toaster() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div data-mt="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} data-mt="toast" data-mt-state={t.tone}>
          <span data-mt="toast-text">{t.text}</span>
          <button
            type="button"
            data-mt="icon-button"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(t.id);
            }}
          >
            <X data-mt="icon" aria-hidden focusable={false} />
          </button>
        </div>
      ))}
    </div>
  );
}

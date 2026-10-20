import type { ReactNode } from "react";

interface PanelProps {
  /** `data-mt-variant`, e.g. `pinned` or `attention`. */
  variant: string;
  title: ReactNode;
  /** Shown next to the title, e.g. a count. */
  count?: number;
  /** Links or buttons at the right of the header. */
  actions?: ReactNode;
  children: ReactNode;
}

/** A titled dashboard section. */
export function Panel({ variant, title, count, actions, children }: PanelProps) {
  return (
    <section data-mt="panel" data-mt-variant={variant}>
      <header data-mt="panel-header">
        <h2 data-mt="panel-title">
          {title}
          {count !== undefined && <span data-mt="panel-count">{count}</span>}
        </h2>
        {actions !== undefined && <div data-mt="panel-actions">{actions}</div>}
      </header>
      <div data-mt="panel-body">{children}</div>
    </section>
  );
}

/** A themed placeholder for "nothing here (yet)". */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div data-mt="empty-state">
      <p data-mt="empty-state-title">{title}</p>
      {children !== undefined && <p data-mt="empty-state-text">{children}</p>}
    </div>
  );
}

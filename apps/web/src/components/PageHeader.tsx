import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Right-hand side: status details or actions. */
  children?: ReactNode;
}

/** The same title block on every page. */
export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <header data-mt="page-header">
      <div data-mt="page-heading">
        <h1 data-mt="page-title">{title}</h1>
        {subtitle !== undefined && <p data-mt="page-subtitle">{subtitle}</p>}
      </div>
      {children !== undefined && <div data-mt="page-header-meta">{children}</div>}
    </header>
  );
}

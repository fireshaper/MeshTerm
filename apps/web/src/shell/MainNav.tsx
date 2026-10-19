import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, MessagesSquare, Radio } from "lucide-react";

interface MainNavProps {
  /** `sidebar` at 768 px and up, `tab-bar` below; also the element's data-mt. */
  variant: "sidebar" | "tab-bar";
}

const ICON = { "aria-hidden": true, focusable: false } as const;

export function MainNav({ variant }: MainNavProps) {
  const { pathname } = useLocation();
  const state = (prefix: string) => (pathname.startsWith(prefix) ? "active" : "inactive");

  return (
    <nav data-mt={variant} aria-label="Main">
      <Link
        to="/dashboard"
        data-mt="nav-item"
        data-mt-state={state("/dashboard")}
        aria-current={state("/dashboard") === "active" ? "page" : undefined}
      >
        <LayoutGrid data-mt="icon" {...ICON} />
        <span data-mt="nav-label">Dashboard</span>
      </Link>
      <Link
        to="/channels/$index"
        params={{ index: "0" }}
        data-mt="nav-item"
        data-mt-state={state("/channels")}
        aria-current={state("/channels") === "active" ? "page" : undefined}
      >
        <MessagesSquare data-mt="icon" {...ICON} />
        <span data-mt="nav-label">Channels</span>
      </Link>
      <Link
        to="/nodes"
        data-mt="nav-item"
        data-mt-state={state("/nodes")}
        aria-current={state("/nodes") === "active" ? "page" : undefined}
      >
        <Radio data-mt="icon" {...ICON} />
        <span data-mt="nav-label">Nodes</span>
      </Link>
    </nav>
  );
}

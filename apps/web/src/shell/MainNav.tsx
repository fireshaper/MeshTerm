import { Link, useLocation } from "@tanstack/react-router";
import { LayoutGrid, Map as MapIcon, MessagesSquare, Radio, type LucideIcon } from "lucide-react";

interface MainNavProps {
  /** `sidebar` from 768 px, `drawer` (the mobile menu) below; also the element's data-mt. */
  variant: "sidebar" | "drawer";
  /** Called after a link is chosen, e.g. to close the drawer. */
  onNavigate?: () => void;
}

const ICON = { "aria-hidden": true, focusable: false } as const;

interface Item {
  prefix: string;
  label: string;
  Icon: LucideIcon;
  link:
    | { to: "/dashboard" }
    | { to: "/map" }
    | { to: "/channels/$index"; params: { index: string } }
    | { to: "/nodes" };
}

const ITEMS: Item[] = [
  { prefix: "/dashboard", label: "Dashboard", Icon: LayoutGrid, link: { to: "/dashboard" } },
  { prefix: "/map", label: "Map", Icon: MapIcon, link: { to: "/map" } },
  {
    prefix: "/channels",
    label: "Channels",
    Icon: MessagesSquare,
    link: { to: "/channels/$index", params: { index: "0" } },
  },
  { prefix: "/nodes", label: "Nodes", Icon: Radio, link: { to: "/nodes" } },
];

export function MainNav({ variant, onNavigate }: MainNavProps) {
  const { pathname } = useLocation();

  return (
    <nav data-mt={variant === "sidebar" ? "sidebar-nav" : "drawer-nav"} aria-label="Main">
      {ITEMS.map(({ prefix, label, Icon, link }) => {
        const active = pathname.startsWith(prefix);
        return (
          <Link
            key={prefix}
            {...link}
            data-mt="nav-item"
            data-mt-state={active ? "active" : "inactive"}
            aria-current={active ? "page" : undefined}
            title={label}
            onClick={onNavigate}
          >
            <Icon data-mt="icon" {...ICON} />
            <span data-mt="nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

import { Link, useLocation } from "@tanstack/react-router";
import { badgeText } from "../data/conversations-cache.js";
import { useUnreadTotals } from "../messages/unread.js";
import {
  LayoutGrid,
  Map as MapIcon,
  MessagesSquare,
  Radio,
  Settings,
  type LucideIcon,
} from "lucide-react";

const ICON = { "aria-hidden": true, focusable: false } as const;

interface Item {
  prefix: string;
  label: string;
  Icon: LucideIcon;
  link:
    | { to: "/dashboard" }
    | { to: "/map" }
    | { to: "/messages" }
    | { to: "/nodes" }
    | { to: "/settings" };
}

const ITEMS: Item[] = [
  { prefix: "/dashboard", label: "Dashboard", Icon: LayoutGrid, link: { to: "/dashboard" } },
  { prefix: "/messages", label: "Messages", Icon: MessagesSquare, link: { to: "/messages" } },
  { prefix: "/map", label: "Map", Icon: MapIcon, link: { to: "/map" } },
  { prefix: "/nodes", label: "Nodes", Icon: Radio, link: { to: "/nodes" } },
  { prefix: "/settings", label: "Settings", Icon: Settings, link: { to: "/settings" } },
];

/**
 * The main navigation as header tabs (CR-005 §6.1). Below 768 px CSS moves the row under
 * the header and lets it scroll sideways.
 */
export function MainNav() {
  const { pathname } = useLocation();
  const unread = useUnreadTotals();

  return (
    <nav data-mt="tab-nav" aria-label="Main">
      {ITEMS.map(({ prefix, label, Icon, link }) => {
        const active = pathname.startsWith(prefix);
        return (
          <Link
            key={prefix}
            {...link}
            data-mt="nav-item"
            data-mt-variant="tab"
            data-mt-state={active ? "active" : "inactive"}
            aria-current={active ? "page" : undefined}
          >
            <Icon data-mt="icon" {...ICON} />
            <span data-mt="nav-label">{label}</span>
            {prefix === "/messages" && unread.total > 0 && (
              <span
                data-mt="nav-badge"
                data-mt-state={unread.dm ? "priority" : undefined}
                aria-label={`${unread.total} unread`}
              >
                {badgeText(unread.total)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

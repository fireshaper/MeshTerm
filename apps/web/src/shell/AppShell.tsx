import { nodeIdFromNum } from "@meshterm/shared";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { RadioTower } from "lucide-react";
import { useEffect } from "react";
import { UserMenu } from "../auth/UserMenu.js";
import { NodeDrawer } from "../node-drawer/NodeDrawer.js";
import { useUnreadTotals } from "../messages/unread.js";
import { useNotificationRuntime } from "../notifications/runtime.js";
import { registerOpener } from "../notifications/center.js";
import { NotificationBell } from "../notifications/NotificationBell.js";
import { NotificationToasts } from "../notifications/NotificationToasts.js";
import { ModeToggle, StationPill } from "./HeaderControls.js";
import { MainNav } from "./MainNav.js";
import { StatusBand } from "./StatusBand.js";
import { Toaster } from "./Toaster.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

function Brand() {
  return (
    <span data-mt="brand">
      <RadioTower data-mt="brand-icon" {...ICON} />
      <span data-mt="brand-name">MeshTerm</span>
    </span>
  );
}

/**
 * Header (brand, tabs, mode, bell, my node, user menu), the radio status band under it,
 * and the content area (CR-005 §6.1). Below 768 px the tabs get their own row.
 */
export function AppShell() {
  const unread = useUnreadTotals();
  useNotificationRuntime(unread.total, unread.dm);
  const navigate = useNavigate();
  useEffect(() => {
    registerOpener((target) => {
      if (!target) void navigate({ to: "/messages" });
      else if (target.kind === "channel") {
        void navigate({ to: "/messages/channel/$index", params: { index: String(target.key) } });
      } else {
        void navigate({
          to: "/messages/dm/$nodeId",
          params: { nodeId: nodeIdFromNum(target.key) },
        });
      }
    });
    return () => {
      registerOpener(null);
    };
  }, [navigate]);

  return (
    <div data-mt="app-shell">
      <header data-mt="header">
        <Brand />
        <MainNav />
        <div data-mt="header-actions">
          <ModeToggle />
          <NotificationBell />
          <StationPill />
          <UserMenu />
        </div>
      </header>
      <StatusBand />
      <main data-mt="main">
        <Outlet />
      </main>
      <NodeDrawer />
      <Toaster />
      <NotificationToasts />
    </div>
  );
}

import * as Dialog from "@radix-ui/react-dialog";
import { Outlet } from "@tanstack/react-router";
import { Menu, PanelLeftClose, PanelLeftOpen, RadioTower, X } from "lucide-react";
import { useState } from "react";
import { NodeDrawer } from "../node-drawer/NodeDrawer.js";
import { ConnectionIndicator, useDeviceInfo } from "./ConnectionIndicator.js";
import { MainNav } from "./MainNav.js";
import { Toaster } from "./Toaster.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

/** Desktop sidebar: null follows the width (icons only 768–1023 px), else the user's choice. */
type SidebarPref = "expanded" | "collapsed" | null;
const SIDEBAR_KEY = "meshterm.sidebar";

function readSidebarPref(): SidebarPref {
  try {
    const value = localStorage.getItem(SIDEBAR_KEY);
    return value === "expanded" || value === "collapsed" ? value : null;
  } catch {
    return null;
  }
}

function Brand() {
  return (
    <span data-mt="brand">
      <RadioTower data-mt="brand-icon" {...ICON} />
      <span data-mt="brand-name">MeshTerm</span>
    </span>
  );
}

/** Device name and link at the bottom of the sidebar and drawer. */
function NavFooter() {
  const { name, link } = useDeviceInfo();
  if (name === null && link === null) return null;
  return (
    <div data-mt="nav-footer">
      {name !== null && <span data-mt="nav-footer-device">{name}</span>}
      {link !== null && <span data-mt="nav-footer-link">{link}</span>}
    </div>
  );
}

/**
 * Header (brand, connection status, and a menu button below 768 px), a collapsible
 * sidebar from 768 px, a navigation drawer below it, and the content area.
 */
export function AppShell() {
  const [sidebar, setSidebar] = useState<SidebarPref>(readSidebarPref);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Toggling from "auto" flips what the width currently shows.
  const toggleSidebar = () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- missing in jsdom
    const wide = window.matchMedia?.("(width >= 1024px)").matches ?? false;
    const shownExpanded = sidebar === null ? wide : sidebar === "expanded";
    const next = shownExpanded ? "collapsed" : "expanded";
    setSidebar(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next);
    } catch {
      // Not remembered; still applied.
    }
  };
  const collapsed = sidebar === "collapsed";

  return (
    <div data-mt="app-shell" data-mt-state={sidebar ?? "auto"}>
      <header data-mt="header">
        <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Dialog.Trigger asChild>
            <button type="button" data-mt="menu-button" aria-label="Open navigation">
              <Menu data-mt="icon" {...ICON} />
            </button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay data-mt="drawer-overlay" />
            <Dialog.Content data-mt="nav-drawer" aria-describedby={undefined}>
              <div data-mt="nav-drawer-header">
                <Dialog.Title asChild>
                  <span>
                    <Brand />
                  </span>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button type="button" data-mt="icon-button" aria-label="Close navigation">
                    <X data-mt="icon" {...ICON} />
                  </button>
                </Dialog.Close>
              </div>
              <MainNav
                variant="drawer"
                onNavigate={() => {
                  setDrawerOpen(false);
                }}
              />
              <NavFooter />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Brand />
        <ConnectionIndicator />
      </header>
      <aside data-mt="sidebar" aria-label="Sidebar">
        <MainNav variant="sidebar" />
        <div data-mt="sidebar-footer">
          <button
            type="button"
            data-mt="sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={toggleSidebar}
          >
            {collapsed ? (
              <PanelLeftOpen data-mt="icon" {...ICON} />
            ) : (
              <PanelLeftClose data-mt="icon" {...ICON} />
            )}
          </button>
        </div>
      </aside>
      <main data-mt="main">
        <Outlet />
      </main>
      <NodeDrawer />
      <Toaster />
    </div>
  );
}

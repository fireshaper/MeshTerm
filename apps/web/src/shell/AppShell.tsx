import { Outlet } from "@tanstack/react-router";
import { MainNav } from "./MainNav.js";
import { StatusPill } from "./StatusPill.js";

/**
 * Header, navigation and content area. The navigation renders twice, as the
 * sidebar (≥ 768 px) and as the bottom tab bar (< 768 px); CSS shows one.
 */
export function AppShell() {
  return (
    <div data-mt="app-shell">
      <header data-mt="header">
        <span data-mt="brand">MeshTerm</span>
        <StatusPill />
      </header>
      <MainNav variant="sidebar" />
      <main data-mt="main">
        <Outlet />
      </main>
      <MainNav variant="tab-bar" />
    </div>
  );
}

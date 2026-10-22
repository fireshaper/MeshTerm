import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { nodeIdFromNum } from "@meshterm/shared";

import { ChannelThread, DmThread, MessagesIndex, MessagesPage } from "./messages/MessagesPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { AccountPage, AuditPage, SettingsPage, UsersPage } from "./settings/SettingsPages.js";
import { DeviceSettingsPage } from "./settings/device/DeviceSettings.js";
import { NotificationSettingsPage } from "./settings/NotificationSettings.js";
import { AppearanceSettingsPage } from "./settings/AppearanceSettings.js";
import { isSectionId } from "./settings/device/registry.js";
import { NodesPage } from "./pages/NodesPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { AppShell } from "./shell/AppShell.js";

/** A node ID as the apps show it: `!` and 8 hex digits. */
const NODE_PARAM = /^![0-9a-f]{8}$/i;

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
  // `?node=!a1b2c3d4` on any route opens the node drawer over it (CR-001 §5.1).
  validateSearch: (search: Record<string, unknown>): { node?: string } =>
    typeof search.node === "string" && NODE_PARAM.test(search.node)
      ? { node: search.node.toLowerCase() }
      : {},
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/dashboard" });
  },
});

export const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardPage,
});

export const messagesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/messages",
  component: MessagesPage,
});

const messagesIndexRoute = createRoute({
  getParentRoute: () => messagesRoute,
  path: "/",
  component: MessagesIndex,
});

export const channelThreadRoute = createRoute({
  getParentRoute: () => messagesRoute,
  path: "/channel/$index",
  component: ChannelThread,
});

/** `nodeId` is the node ID as the apps show it, e.g. `/messages/dm/!a1b2c3d4`. */
export const dmThreadRoute = createRoute({
  getParentRoute: () => messagesRoute,
  path: "/dm/$nodeId",
  component: DmThread,
});

/** Old links (bookmarks, before the Messages view) keep working. */
const legacyChannelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/channels/$index",
  beforeLoad: ({ params }) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/messages/channel/$index", params: { index: params.index } });
  },
});

export const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nodes",
  component: NodesPage,
});

/** Old DM links used the decimal node number: `/dm/195939070`. */
const legacyDmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dm/$nodeNum",
  beforeLoad: ({ params }) => {
    const num = /^\d{1,10}$/.test(params.nodeNum) ? Number(params.nodeNum) : 0;
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw num > 0 && num < 0xffff_ffff
      ? redirect({ to: "/messages/dm/$nodeId", params: { nodeId: nodeIdFromNum(num) } })
      : redirect({ to: "/messages" });
  },
});

/**
 * `/map?focus=!a1b2c3d4` opens the map centered on that node with its popup (`?node=`
 * is the drawer everywhere). Old links' decimal `?node=<num>` still focus. Code-split:
 * MapLibre loads here only.
 */
export const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  validateSearch: (search: Record<string, unknown>): { focus?: string } => {
    if (typeof search.focus === "string" && NODE_PARAM.test(search.focus)) {
      return { focus: search.focus.toLowerCase() };
    }
    const legacy = typeof search.node === "number" ? search.node : NaN;
    return Number.isInteger(legacy) && legacy > 0 && legacy < 0xffff_ffff
      ? { focus: nodeIdFromNum(legacy) }
      : {};
  },
  component: lazyRouteComponent(() => import("./map/MapPage.js"), "MapPage"),
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack Router's redirect API
    throw redirect({ to: "/settings/device" });
  },
});
/** `?section=lora` picks the section (CR-002 §5.1). */
export const deviceSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/device",
  validateSearch: (search: Record<string, unknown>): { section?: string } =>
    typeof search.section === "string" && isSectionId(search.section)
      ? { section: search.section }
      : {},
  component: DeviceSettingsPage,
});
const notificationSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/notifications",
  component: NotificationSettingsPage,
});
const appearanceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/appearance",
  component: AppearanceSettingsPage,
});
const accountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/account",
  component: AccountPage,
});
const usersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/users",
  component: UsersPage,
});
const auditRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/audit",
  component: AuditPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  mapRoute,
  messagesRoute.addChildren([messagesIndexRoute, channelThreadRoute, dmThreadRoute]),
  legacyChannelRoute,
  nodesRoute,
  legacyDmRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    deviceSettingsRoute,
    notificationSettingsRoute,
    appearanceRoute,
    accountRoute,
    usersRoute,
    auditRoute,
  ]),
]);

/** The app's router; tests pass a memory history starting at a given path. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

export function createTestRouter(path: string) {
  return createAppRouter(createMemoryHistory({ initialEntries: [path] }));
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

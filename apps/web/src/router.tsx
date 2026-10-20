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
import { NodesPage } from "./pages/NodesPage.js";
import { NotFoundPage } from "./pages/NotFoundPage.js";
import { AppShell } from "./shell/AppShell.js";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
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

/** `/map?node=<num>` opens the map centered on that node. Code-split: MapLibre loads here only. */
export const mapRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/map",
  validateSearch: (search: Record<string, unknown>): { node?: number } => {
    const node = Number(search.node);
    return Number.isInteger(node) && node > 0 ? { node } : {};
  },
  component: lazyRouteComponent(() => import("./map/MapPage.js"), "MapPage"),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  mapRoute,
  messagesRoute.addChildren([messagesIndexRoute, channelThreadRoute, dmThreadRoute]),
  legacyChannelRoute,
  nodesRoute,
  legacyDmRoute,
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

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { ChannelPage } from "./pages/ChannelPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { DmPage } from "./pages/DmPage.js";
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

export const channelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/channels/$index",
  component: ChannelPage,
});

export const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/nodes",
  component: NodesPage,
});

export const dmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dm/$nodeNum",
  component: DmPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  channelRoute,
  nodesRoute,
  dmRoute,
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

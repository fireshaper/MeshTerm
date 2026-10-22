import {
  channelDisplayName,
  type Channel,
  type ConversationsDTO,
  type DashboardDTO,
  type MeDTO,
  type MeshNode,
  type NotificationPrefsDTO,
} from "@meshterm/shared";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { App } from "../App.js";
import { queryKeys, type ConversationData } from "../data/keys.js";
import { createQueryClient } from "../data/queries.js";
import { resetLiveStore, useLiveStore } from "../data/store.js";
import { resetUiStore } from "../data/ui-store.js";
import { createTestRouter } from "../router.js";
import { TEST_ADMIN } from "./me.js";

export interface Seed {
  channels?: Channel[];
  nodes?: MeshNode[];
  dashboard?: DashboardDTO;
  /** Any other cached query, e.g. `[queryKeys.traffic(1, "24h"), data]`. */
  queries?: [readonly unknown[], unknown][];
  conversations?: [ReturnType<typeof queryKeys.messages>, ConversationData][];
  /** The conversation list; by default the seeded channels (preset LongFast) and no DMs. */
  conversationList?: ConversationsDTO;
  /** Who is signed in; an admin with accounts off by default. */
  me?: MeDTO;
  myNodeNum?: number | null;
  nodeState?: Parameters<ReturnType<typeof useLiveStore.getState>["setNodeState"]>[0];
}

/** The whole app at `path` with no live socket: connection 1, cache seeded as a snapshot would. */
export async function renderApp(path: string, seed: Seed = {}) {
  resetLiveStore();
  resetUiStore();
  const store = useLiveStore.getState();
  store.setConnectionId(1);
  store.setSocketStatus("open");
  store.setNodeState(seed.nodeState ?? "connected");
  store.setMyNodeNum(seed.myNodeNum ?? null);

  const queryClient: QueryClient = createQueryClient();
  if (seed.channels) queryClient.setQueryData(queryKeys.channels(1), seed.channels);
  // What LiveConnection and the snapshot would have loaded: the connection list and nodes.
  queryClient.setQueryData(queryKeys.connections, [
    {
      id: 1,
      name: "Test node",
      host: "192.0.2.1",
      port: 4403,
      transport: "tcp",
      enabled: true,
      state: seed.nodeState ?? "connected",
      myNodeNum: seed.myNodeNum ?? null,
    },
  ]);
  queryClient.setQueryData(queryKeys.nodes(1), seed.nodes ?? []);
  // The user's notification settings, as the app loads them at start (CR-003).
  queryClient.setQueryData<NotificationPrefsDTO>(queryKeys.notificationPrefs, {
    dndUntil: null,
    quietHours: null,
    quietAllowDms: false,
    mentionKeywords: [],
    reactionsMode: "in-app",
    matchShortName: true,
    serverUtcOffsetMinutes: 0,
  });
  if (seed.dashboard) queryClient.setQueryData(queryKeys.dashboard(1), seed.dashboard);
  queryClient.setQueryData<ConversationsDTO>(
    queryKeys.conversations(1),
    seed.conversationList ?? {
      channels: (seed.channels ?? [])
        .filter((c) => c.role !== "DISABLED")
        .map((c) => ({
          index: c.index,
          name: channelDisplayName(c, "LONG_FAST"),
          role: c.role,
          encryption: c.encryption,
          lastMessage: null,
          unread: 0,
          unreadMentions: 0,
          state: { lastReadRxTime: 0, muted: false, favorite: false, notifyLevel: "all" },
        })),
      dms: [],
    },
  );
  for (const [key, data] of seed.queries ?? []) queryClient.setQueryData(key, data);
  for (const [key, data] of seed.conversations ?? []) queryClient.setQueryData(key, data);

  const router = createTestRouter(path);
  const utils = render(
    <App router={router} queryClient={queryClient} live={false} me={seed.me ?? TEST_ADMIN} />,
  );
  // `hidden`: a deep-linked drawer opens at once and hides the page from the a11y tree.
  await screen.findByRole("heading", { level: 1, hidden: true });
  return { ...utils, router, queryClient };
}

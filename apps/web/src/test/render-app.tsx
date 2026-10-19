import type { Channel, MeshNode } from "@meshterm/shared";
import type { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { App } from "../App.js";
import { queryKeys, type ConversationData } from "../data/keys.js";
import { createQueryClient } from "../data/queries.js";
import { resetLiveStore, useLiveStore } from "../data/store.js";
import { createTestRouter } from "../router.js";

export interface Seed {
  channels?: Channel[];
  nodes?: MeshNode[];
  conversations?: [ReturnType<typeof queryKeys.messages>, ConversationData][];
  myNodeNum?: number | null;
  nodeState?: Parameters<ReturnType<typeof useLiveStore.getState>["setNodeState"]>[0];
}

/** The whole app at `path` with no live socket: connection 1, cache seeded as a snapshot would. */
export async function renderApp(path: string, seed: Seed = {}) {
  resetLiveStore();
  const store = useLiveStore.getState();
  store.setConnectionId(1);
  store.setSocketStatus("open");
  store.setNodeState(seed.nodeState ?? "connected");
  store.setMyNodeNum(seed.myNodeNum ?? null);

  const queryClient: QueryClient = createQueryClient();
  if (seed.channels) queryClient.setQueryData(queryKeys.channels(1), seed.channels);
  if (seed.nodes) queryClient.setQueryData(queryKeys.nodes(1), seed.nodes);
  for (const [key, data] of seed.conversations ?? []) queryClient.setQueryData(key, data);

  const router = createTestRouter(path);
  const utils = render(<App router={router} queryClient={queryClient} live={false} />);
  await screen.findByRole("heading", { level: 1 });
  return { ...utils, router, queryClient };
}

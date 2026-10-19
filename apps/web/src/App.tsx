import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { LiveConnection } from "./data/LiveConnection.js";
import { createQueryClient } from "./data/queries.js";
import { createAppRouter } from "./router.js";

export interface AppProps {
  router?: ReturnType<typeof createAppRouter>;
  queryClient?: QueryClient;
  /** Open the live WebSocket; tests turn it off and seed the cache themselves. */
  live?: boolean;
}

export function App({ router, queryClient, live = true }: AppProps) {
  const [appRouter] = useState(() => router ?? createAppRouter());
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      {live && <LiveConnection />}
      <RouterProvider router={appRouter} />
    </QueryClientProvider>
  );
}

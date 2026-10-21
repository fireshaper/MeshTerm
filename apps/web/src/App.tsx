import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import type { MeDTO } from "@meshterm/shared";
import { AuthGate } from "./auth/AuthGate.js";
import { NowProvider } from "./components/useNow.js";
import { LiveConnection } from "./data/LiveConnection.js";
import { createQueryClient } from "./data/queries.js";
import { createAppRouter } from "./router.js";

export interface AppProps {
  router?: ReturnType<typeof createAppRouter>;
  queryClient?: QueryClient;
  /** Open the live WebSocket; tests turn it off and seed the cache themselves. */
  live?: boolean;
  /** Who is signed in, if already known (tests); otherwise asked from the server. */
  me?: MeDTO;
}

export function App({ router, queryClient, live = true, me }: AppProps) {
  const [appRouter] = useState(() => router ?? createAppRouter());
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <AuthGate {...(me ? { me } : {})}>
        {live && <LiveConnection />}
        <NowProvider>
          <RouterProvider router={appRouter} />
        </NowProvider>
      </AuthGate>
    </QueryClientProvider>
  );
}

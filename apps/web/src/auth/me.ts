import type { MeDTO } from "@meshterm/shared";
import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api, setCsrfToken } from "../data/api.js";
import { queryKeys } from "../data/keys.js";

/**
 * Who is signed in, mirrored from `GET /api/auth/me` so any component can ask without
 * a query (the gate loads it before the app renders).
 */
export const useAuthStore = create<{ me: MeDTO | null }>()(() => ({ me: null }));

/** Records who is signed in: the store and the CSRF token for API requests. */
export function setMe(me: MeDTO | null): void {
  useAuthStore.setState({ me });
  setCsrfToken(me?.csrfToken ?? "");
}

/** `GET /api/auth/me` (the gate's query). */
export function useMeQuery() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      const me = await api.me();
      setMe(me);
      return me;
    },
    retry: 1,
  });
}

export function useMe(): MeDTO | undefined {
  return useAuthStore((s) => s.me) ?? undefined;
}

/** Admins change things; viewers only look. (The server enforces this too.) */
export function useIsAdmin(): boolean {
  return useAuthStore((s) => s.me?.user?.role === "admin");
}

/** Shown on controls a viewer can't use. */
export const VIEWER_HINT = "Viewers can look but not change anything; ask an admin.";

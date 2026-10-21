import type { MeDTO } from "@meshterm/shared";

/** Accounts off: everyone is this admin (what most component tests assume). */
export const TEST_ADMIN: MeDTO = {
  mode: "none",
  user: { id: 0, username: "admin", role: "admin" },
  csrfToken: "",
  setupRequired: false,
};

/** A signed-in viewer (read-only). */
export const TEST_VIEWER: MeDTO = {
  mode: "local",
  user: { id: 2, username: "vic", role: "viewer" },
  csrfToken: "csrf-test-token",
  setupRequired: false,
};

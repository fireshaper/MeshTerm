import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleUser } from "lucide-react";
import { api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useThemeStore } from "../theme/store.js";
import { useActiveTheme, useThemes } from "../theme/ThemeRuntime.js";
import { useMe } from "./me.js";

const ICON = { "aria-hidden": true, focusable: false } as const;
const ROLE_LABELS = { admin: "Admin", viewer: "Viewer" } as const;

/** Who is signed in, a theme shortcut (CR-004 §4.7), account links and (admins) users; sign out. */
export function UserMenu() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = me?.user;
  if (!me || !user) return null;
  const local = me.mode === "local";

  async function signOut() {
    await api.logout().catch(() => undefined);
    // Drop everything cached for this user, then ask again who we are: the gate (still
    // observing `me`) shows the sign-in form.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== queryKeys.me[0] });
    await qc.refetchQueries({ queryKey: queryKeys.me });
  }

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          data-mt="user-menu"
          data-mt-variant={user.role}
          aria-label={`Account: ${user.username} (${ROLE_LABELS[user.role]})`}
        >
          <CircleUser data-mt="icon" {...ICON} />
          <span data-mt="user-menu-name">{local ? user.username : "Accounts off"}</span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content data-mt="node-drawer-menu" align="end" sideOffset={4}>
          <Menu.Label data-mt="menu-label">
            {local
              ? `${user.username} · ${ROLE_LABELS[user.role]}`
              : "Accounts are off (MESHTERM_AUTH=none)"}
          </Menu.Label>
          <ThemeItems />
          {local && (
            <Menu.Item
              data-mt="menu-item"
              onSelect={() => {
                void navigate({ to: "/settings/account" });
              }}
            >
              Account
            </Menu.Item>
          )}
          {local && user.role === "admin" && (
            <>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  void navigate({ to: "/settings/users" });
                }}
              >
                Users
              </Menu.Item>
              <Menu.Item
                data-mt="menu-item"
                onSelect={() => {
                  void navigate({ to: "/settings/audit" });
                }}
              >
                Audit log
              </Menu.Item>
            </>
          )}
          {local && (
            <Menu.Item
              data-mt="menu-item"
              data-mt-variant="sign-out"
              onSelect={() => {
                void signOut();
              }}
            >
              Sign out
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Theme shortcut: pick any working theme, or open Settings → Appearance. */
function ThemeItems() {
  const navigate = useNavigate();
  const { data } = useThemes();
  const active = useActiveTheme();
  const choose = useThemeStore((s) => s.choose);
  const themes = data?.themes.filter((t) => t.valid && t.manifest) ?? [];
  return (
    <>
      <Menu.Separator data-mt="menu-separator" />
      <Menu.Label data-mt="menu-label">Theme</Menu.Label>
      {themes.length > 0 && (
        <Menu.RadioGroup value={active?.id ?? ""} onValueChange={choose}>
          {themes.map((t) => (
            <Menu.RadioItem key={t.id} value={t.id} data-mt="menu-item" data-mt-variant="radio">
              <Menu.ItemIndicator data-mt="menu-check">✓</Menu.ItemIndicator>
              {t.manifest?.name ?? t.id}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      )}
      <Menu.Item
        data-mt="menu-item"
        onSelect={() => {
          void navigate({ to: "/settings/appearance" });
        }}
      >
        Appearance settings
      </Menu.Item>
      <Menu.Separator data-mt="menu-separator" />
    </>
  );
}

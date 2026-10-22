import type { AuditEntryDTO, Role, UserDTO } from "@meshterm/shared";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { useIsAdmin, useMe } from "../auth/me.js";
import { PageHeader } from "../components/PageHeader.js";
import { formatAbsolute } from "../dashboard/format.js";
import { ApiError, api } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { useUiStore } from "../data/ui-store.js";

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : "Couldn't reach MeshTerm. Try again.";

/** Settings layout: section links (Device, Account; Users and Audit log for admins). */
export function SettingsPage() {
  const me = useMe();
  const admin = useIsAdmin();
  const { pathname } = useLocation();
  const local = me?.mode === "local";
  const items = [
    { to: "/settings/device" as const, label: "Device" },
    { to: "/settings/notifications" as const, label: "Notifications" },
    ...(local ? [{ to: "/settings/account" as const, label: "Account" }] : []),
    ...(admin ? [{ to: "/settings/users" as const, label: "Users" }] : []),
    ...(admin ? [{ to: "/settings/audit" as const, label: "Audit log" }] : []),
  ];
  return (
    <section data-mt="settings-view">
      <PageHeader title="Settings" />
      <nav data-mt="settings-nav" aria-label="Settings">
        {items.map((item) => {
          const active = pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              data-mt="settings-nav-item"
              data-mt-state={active ? "active" : "inactive"}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div data-mt="settings-body">
        <Outlet />
      </div>
    </section>
  );
}

export function AccountPage() {
  const me = useMe();
  const toast = useUiStore((s) => s.toast);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalid = next.length > 0 && next.length < 8;
  const mismatch = repeat.length > 0 && repeat !== next;

  async function submit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      toast("Password changed. Other sessions were signed out.", "success");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-mt="settings-section" data-mt-variant="account">
      <h2 data-mt="settings-title">Account</h2>
      <p data-mt="detail-note">
        Signed in as <strong>{me?.user?.username}</strong> ({me?.user?.role}).
      </p>
      <form data-mt="settings-form" onSubmit={(e) => void submit(e)}>
        <h3 data-mt="settings-subtitle">Change password</h3>
        <label data-mt="settings-field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(e) => {
              setCurrent(e.target.value);
            }}
          />
        </label>
        <label data-mt="settings-field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            aria-invalid={invalid}
            aria-describedby={invalid ? "account-password-hint" : undefined}
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
            }}
          />
        </label>
        {invalid && (
          <small data-mt="auth-hint" id="account-password-hint">
            At least 8 characters.
          </small>
        )}
        <label data-mt="settings-field">
          <span>Repeat new password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={mismatch}
            aria-describedby={mismatch ? "account-repeat-hint" : undefined}
            value={repeat}
            onChange={(e) => {
              setRepeat(e.target.value);
            }}
          />
        </label>
        {mismatch && (
          <small data-mt="auth-hint" id="account-repeat-hint">
            The passwords don&apos;t match.
          </small>
        )}
        {error && (
          <p data-mt="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" data-mt="button" disabled={busy || invalid || mismatch}>
          Change password
        </button>
      </form>
    </section>
  );
}

function UserRow({ user, self }: { user: UserDTO; self: boolean }) {
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.users });
  const act = async (what: () => Promise<unknown>, done: string) => {
    try {
      await what();
      toast(done, "success");
      await refresh();
    } catch (err) {
      toast(errorText(err), "error");
    }
  };
  return (
    <tr data-mt="user-row" data-mt-variant={user.role} data-user-id={user.id}>
      <th scope="row">
        {user.username}
        {self && <span data-mt="user-self"> (you)</span>}
      </th>
      <td>
        <select
          aria-label={`Role of ${user.username}`}
          value={user.role}
          onChange={(e) => {
            const role = e.target.value as Role;
            void act(
              () => api.updateUser(user.id, { role }),
              `${user.username} is now ${role === "admin" ? "an admin" : "a viewer"}.`,
            );
          }}
        >
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
      </td>
      <td>{user.lastLoginAt === null ? "Never" : formatAbsolute(user.lastLoginAt)}</td>
      <td data-mt="user-actions">
        <button
          type="button"
          data-mt="button"
          onClick={() => {
            const password = window.prompt(
              `New password for ${user.username} (at least 8 characters):`,
            );
            if (password) {
              void act(
                () => api.updateUser(user.id, { password }),
                `Password of ${user.username} reset; they were signed out.`,
              );
            }
          }}
        >
          Reset password
        </button>
        {!self && (
          <button
            type="button"
            data-mt="button"
            data-mt-variant="danger"
            onClick={() => {
              if (window.confirm(`Delete ${user.username}? They'll be signed out.`)) {
                void act(() => api.deleteUser(user.id), `${user.username} deleted.`);
              }
            }}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  );
}

export function UsersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useUiStore((s) => s.toast);
  const {
    data: users,
    isPending,
    isError,
  } = useQuery({
    queryKey: queryKeys.users,
    queryFn: api.users,
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [error, setError] = useState<string | null>(null);

  async function add(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({ username, password, role });
      toast(`${username} added.`, "success");
      setUsername("");
      setPassword("");
      await qc.invalidateQueries({ queryKey: queryKeys.users });
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section data-mt="settings-section" data-mt-variant="users">
      <h2 data-mt="settings-title">Users</h2>
      <p data-mt="detail-note">
        Admins can send messages and change settings. Viewers can look at everything except secrets,
        but can&apos;t change anything.
      </p>
      {isPending ? (
        <div data-mt="skeleton" aria-hidden />
      ) : isError ? (
        <p role="alert">Users couldn&apos;t be loaded.</p>
      ) : (
        <table data-mt="users-table">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign-in</th>
              <th scope="col">
                <span data-mt="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} self={u.id === me?.user?.id} />
            ))}
          </tbody>
        </table>
      )}
      <form data-mt="settings-form" onSubmit={(e) => void add(e)}>
        <h3 data-mt="settings-subtitle">Add a user</h3>
        <label data-mt="settings-field">
          <span>Username</span>
          <input
            required
            maxLength={32}
            autoComplete="off"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
        </label>
        <label data-mt="settings-field">
          <span>Password</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        <label data-mt="settings-field">
          <span>Role</span>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as Role);
            }}
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        {error && (
          <p data-mt="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" data-mt="button">
          Add user
        </button>
      </form>
    </section>
  );
}

const describe = (e: AuditEntryDTO) =>
  e.details
    ? Object.entries(e.details)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(", ")
    : "";

export function AuditPage() {
  const { data, isPending, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: queryKeys.audit,
      queryFn: ({ pageParam }) => api.audit(pageParam),
      initialPageParam: null as number | null,
      getNextPageParam: (last) => last.nextBefore,
      staleTime: 0,
    });
  const entries = data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <section data-mt="settings-section" data-mt-variant="audit">
      <h2 data-mt="settings-title">Audit log</h2>
      <p data-mt="detail-note">
        Sign-ins, user changes and actions that change the node. Newest first; secrets are never
        recorded.
      </p>
      {isPending ? (
        <div data-mt="skeleton" aria-hidden />
      ) : isError ? (
        <p role="alert">The audit log couldn&apos;t be loaded.</p>
      ) : (
        <>
          <table data-mt="audit-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">User</th>
                <th scope="col">Action</th>
                <th scope="col">Target</th>
                <th scope="col">Result</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} data-mt="audit-row" data-mt-state={e.result}>
                  <td>{formatAbsolute(e.time)}</td>
                  <td>{e.username ?? "—"}</td>
                  <td>{e.action}</td>
                  <td>{e.target ?? ""}</td>
                  <td>{e.result}</td>
                  <td>
                    {describe(e)}
                    {e.ip ? ` (${e.ip})` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {hasNextPage && (
            <button
              type="button"
              data-mt="button"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Load older
            </button>
          )}
        </>
      )}
    </section>
  );
}

import type { MeDTO } from "@meshterm/shared";
import { useQueryClient } from "@tanstack/react-query";
import { RadioTower } from "lucide-react";
import { useEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { ApiError, api, setUnauthorizedHandler } from "../data/api.js";
import { queryKeys } from "../data/keys.js";
import { setMe, useMeQuery } from "./me.js";

const ICON = { "aria-hidden": true, focusable: false } as const;

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Wrong username or password.";
    if (err.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (err.status === 409) return "Setup is already done. Sign in instead.";
    return err.message;
  }
  return "Couldn't reach MeshTerm. Check your connection and try again.";
}

/** Sign-in and first-run setup share one form; `setup` also asks to repeat the password. */
function AuthForm({ setup }: { setup: boolean }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = setup && repeat.length > 0 && repeat !== password;
  const tooShort = setup && password.length > 0 && password.length < 8;

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mismatch || tooShort) return;
    setBusy(true);
    setError(null);
    try {
      await (setup ? api.setup(username, password) : api.login(username, password));
      await qc.invalidateQueries({ queryKey: queryKeys.me });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main data-mt="auth-screen" data-mt-variant={setup ? "setup" : "login"}>
      <form data-mt="auth-card" onSubmit={(e) => void submit(e)}>
        <h1 data-mt="auth-title">
          <RadioTower data-mt="brand-icon" {...ICON} />
          {setup ? "Welcome to MeshTerm" : "Sign in to MeshTerm"}
        </h1>
        {setup && (
          <p data-mt="auth-note">
            Create the first admin account. Admins can send messages, change settings and add other
            users.
          </p>
        )}
        <label data-mt="auth-field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            required
            maxLength={32}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
            }}
          />
        </label>
        <label data-mt="auth-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={setup ? 8 : 1}
            maxLength={256}
            value={password}
            aria-invalid={tooShort}
            aria-describedby={tooShort ? "auth-password-hint" : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {tooShort && (
          <small data-mt="auth-hint" id="auth-password-hint">
            At least 8 characters.
          </small>
        )}
        {setup && (
          <label data-mt="auth-field">
            <span>Repeat password</span>
            <input
              name="repeat"
              type="password"
              autoComplete="new-password"
              required
              value={repeat}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "auth-repeat-hint" : undefined}
              onChange={(e) => {
                setRepeat(e.target.value);
              }}
            />
          </label>
        )}
        {mismatch && (
          <small data-mt="auth-hint" id="auth-repeat-hint">
            The passwords don&apos;t match.
          </small>
        )}
        {error && (
          <p data-mt="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" data-mt="auth-submit" disabled={busy || mismatch || tooShort}>
          {busy ? "One moment…" : setup ? "Create admin account" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

/**
 * Renders the app only for a signed-in user (or with accounts off). Otherwise shows
 * the sign-in form, or first-run setup when no account exists. The URL is left alone,
 * so a deep link opens once signed in.
 */
export function AuthGate({ me, children }: { me?: MeDTO; children: ReactNode }) {
  const qc = useQueryClient();
  const [seeded] = useState(() => {
    if (me) {
      qc.setQueryData(queryKeys.me, me);
      setMe(me);
    }
    return true;
  });
  const { data, isPending, isError, refetch } = useMeQuery();

  // A 401 from any request means the session ended: ask again who we are.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      void qc.invalidateQueries({ queryKey: queryKeys.me });
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, [qc]);

  if (!seeded || isPending) return <div data-mt="auth-loading" aria-busy="true" />;
  if (isError) {
    return (
      <main data-mt="auth-screen" data-mt-variant="error">
        <div data-mt="auth-card">
          <h1 data-mt="auth-title">MeshTerm isn&apos;t answering</h1>
          <p data-mt="auth-note">Check that the server is running, then try again.</p>
          <button type="button" data-mt="auth-submit" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      </main>
    );
  }
  if (!data.user) return <AuthForm key={String(data.setupRequired)} setup={data.setupRequired} />;
  return <>{children}</>;
}

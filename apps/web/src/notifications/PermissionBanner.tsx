import { BellRing, X } from "lucide-react";
import { useState } from "react";
import { useNotifyCenter } from "./center.js";
import { desktopSupport, requestDesktopPermission } from "./desktop.js";
import { useBrowserNotifySettings } from "./settings.js";

export const BANNER_DISMISSED_KEY = "meshterm.notifications.bannerDismissed";

const ICON = { "aria-hidden": true, focusable: false } as const;

function dismissedBefore(): boolean {
  try {
    return localStorage.getItem(BANNER_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Get desktop notifications for DMs and mentions?" on the Messages page, after the
 * first DM or mention (CR-003 §8): never a prompt on page load, only on the user's click.
 */
export function PermissionBanner() {
  const desktop = useBrowserNotifySettings((s) => s.settings.desktop);
  const update = useBrowserNotifySettings((s) => s.update);
  const hadPriority = useNotifyCenter((s) =>
    s.events.some((e) => e.variant === "dm" || e.variant === "mention"),
  );
  const [hidden, setHidden] = useState(dismissedBefore);
  const support = desktopSupport();
  if (
    hidden ||
    desktop ||
    !hadPriority ||
    support.state !== "ready" ||
    support.permission !== "default"
  ) {
    return null;
  }
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(BANNER_DISMISSED_KEY, "1");
    } catch {
      // Shown again next time.
    }
  };
  return (
    <div data-mt="permission-banner" role="region" aria-label="Desktop notifications">
      <BellRing data-mt="icon" {...ICON} />
      <span data-mt="permission-banner-text">Get desktop notifications for DMs and mentions?</span>
      <button
        type="button"
        data-mt="button"
        data-mt-variant="primary"
        onClick={() => {
          void requestDesktopPermission().then((granted) => {
            if (granted) update({ desktop: true });
            setHidden(true);
          });
        }}
      >
        Enable
      </button>
      <button type="button" data-mt="icon-button" aria-label="Not now" onClick={dismiss}>
        <X data-mt="icon" {...ICON} />
      </button>
    </div>
  );
}

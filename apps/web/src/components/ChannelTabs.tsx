import type { Channel } from "@meshterm/shared";
import { Link } from "@tanstack/react-router";
import { useChannels } from "../data/queries.js";
import { useLiveStore } from "../data/store.js";

/** What a channel is called in the UI. The primary channel's name is often empty. */
export function channelLabel(channel: Channel): string {
  if (channel.name) return channel.name;
  return channel.role === "PRIMARY" ? "Primary" : `Channel ${channel.index}`;
}

/** One tab per enabled channel; each tab is a link to its route. */
export function ChannelTabs({ activeIndex }: { activeIndex: number }) {
  const connectionId = useLiveStore((s) => s.connectionId);
  const { data: channels = [] } = useChannels(connectionId);
  const visible = channels.filter((c) => c.role !== "DISABLED");

  return (
    <nav data-mt="channel-tabs" aria-label="Channels">
      {visible.map((channel) => {
        const active = channel.index === activeIndex;
        return (
          <Link
            key={channel.index}
            to="/channels/$index"
            params={{ index: String(channel.index) }}
            data-mt="channel-tab"
            data-mt-state={active ? "active" : "inactive"}
            data-mt-variant={channel.role.toLowerCase()}
            aria-current={active ? "page" : undefined}
          >
            {channelLabel(channel)}
          </Link>
        );
      })}
    </nav>
  );
}

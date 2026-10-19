import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { ChannelTabs } from "../components/ChannelTabs.js";
import { ConversationView } from "../components/ConversationView.js";

export function ChannelPage() {
  const { index } = useParams({ from: "/channels/$index" });
  const channelIndex = Number(index);
  const conversation = useMemo(() => ({ channel: channelIndex }), [channelIndex]);
  return (
    <section data-mt="channel-view" data-mt-variant={`channel-${index}`}>
      <h1 data-mt="page-title">Channel {index}</h1>
      <ChannelTabs activeIndex={channelIndex} />
      <ConversationView conversation={conversation} />
    </section>
  );
}

"use client";

import {
  FullPageConstellations,
  FullPageConstellationsHostLoading,
  newChannelFromGraphNode,
  useFullPageConstellationsHost,
} from "@johndimm/constellations/host";
import {
  persistWindowConstellationsHandoffToSession,
  takeEmbedHandoffForInitialState,
} from "@johndimm/constellations/sessionHandoff";
import type { GraphNode } from "@johndimm/constellations/types";
import AppHeader from "@/app/components/AppHeader";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const PENDING_CHANNEL_KEY = "earprint-pending-constellations-new-channel";

export default function ConstellationsClient() {
  const router = useRouter();
  const [embedHandoff] = useState(() => takeEmbedHandoffForInitialState());
  const sp = useSearchParams();
  const qParam = (sp.get("q") ?? "").trim();
  const expandParam = (sp.get("expand") ?? "").trim();

  const { ready, externalSearch, autoExpandTitles, nowPlayingKey } = useFullPageConstellationsHost({
    qParam,
    expandParam,
    skipUrlAndPlayerBridge: Boolean(embedHandoff),
  });

  if (!ready) {
    return <FullPageConstellationsHostLoading surface="overlay" />;
  }

  return (
    <FullPageConstellations
      layout="fixed-overlay"
      hideHeader
      chromeSlot={<AppHeader />}
      settingsHref="/constellations/settings"
      onClose={() => {
        persistWindowConstellationsHandoffToSession();
        router.push("/player");
      }}
      externalSearch={externalSearch}
      onExternalSearchConsumed={() => {}}
      autoExpandMatchTitles={autoExpandTitles}
      nowPlayingKey={nowPlayingKey}
      initialSession={embedHandoff}
      onNewChannelFromNode={(node: GraphNode) =>
        newChannelFromGraphNode(node, {
          sessionStorageKey: PENDING_CHANNEL_KEY,
          navigate: (path) => router.push(path),
          path: "/player",
          logLabel: "soundings-constellations",
        })
      }
    />
  );
}

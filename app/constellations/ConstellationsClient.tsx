"use client";

import {
  FullPageConstellations,
  FullPageConstellationsHostLoading,
  newChannelFromGraphNode,
  useFullPageConstellationsHost,
} from "@johndimm/constellations/host";
import {
  takeEmbedHandoffForInitialState,
  SOUNDINGS_CONSTELLATIONS_HANDOFF_KEY,
} from "@johndimm/constellations/sessionHandoff";

function persistWindowConstellationsHandoffToSession(): void {
  if (typeof window === "undefined") return;
  try {
    const fn = (window as any).__soundingsConstellationsGetHandoff;
    if (typeof fn !== "function") return;
    const payload = fn();
    if (!payload || typeof payload !== "object") return;
    const p = payload as { v?: number; graph?: { nodes?: unknown[] } };
    if (p.v !== 1 || !p.graph?.nodes?.length) return;
    sessionStorage.setItem(SOUNDINGS_CONSTELLATIONS_HANDOFF_KEY, JSON.stringify(payload));
  } catch { /* empty */ }
}
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

/*
Reveal newly earned skins on the dive results screen.
Edit this file to change the reward presentation or when it replays.
*/

import { useEffect, useState, type CSSProperties } from "react";
import type { Skin } from "../shared/types";
import { KrillSkin } from "./KrillSkin";
import "./skin-unlock.css";

function seenDives(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function SkinUnlockReveal({ matchId, playerId, skins }: { matchId: string; playerId: number; skins: Skin[] }) {
  const key = `krillion-seen-unlocks:${playerId}`;
  const [reveal] = useState(() => !seenDives(key).includes(matchId));

  useEffect(() => {
    if (!reveal) return;
    try {
      const previous = seenDives(key).filter((id) => id !== matchId);
      localStorage.setItem(key, JSON.stringify([...previous.slice(-63), matchId]));
    } catch {
      // The reveal still works when browser storage is unavailable.
    }
  }, [key, matchId, reveal]);

  return (
    <section className="skin-unlocks" aria-label="Skin rewards" data-reveal={reveal}>
      <h3 role={reveal ? "status" : undefined}>
        {skins.length === 1 ? "Skin unlocked" : "Skins unlocked"}
        {reveal && <span className="sr-only"> · {skins.map((skin) => skin.name).join(", ")}</span>}
      </h3>
      <ul className="skin-unlock-list">
        {skins.map((skin, index) => (
          <li key={skin.id} className="skin-unlock-card" style={{ "--skin-delay": `${Math.min(index, 6) * 140}ms` } as CSSProperties}>
            <div className="skin-unlock-stage" aria-hidden="true">
              <span className="skin-unlock-sparks" />
              <KrillSkin skin={skin} />
            </div>
            <strong>{skin.name}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

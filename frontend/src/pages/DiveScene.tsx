/*
This component draws the full-screen ocean and follows the local player through it.
Edit it to change depth landmarks, camera movement, or player sprites. Copy it for another scrolling scene.
*/

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { OnlineMode, WsMessage } from "../shared/types";
import { ReefScenery, SkyScenery } from "./PixelScenery";
import { OceanWildlife, type Habitat } from "./OceanWildlife";
import "./dive-scene.css";
import { KrillSkin } from "./KrillSkin";

type Players = Extract<WsMessage, { type: "game.room" }>["players"];
const MAX_DEPTH = 7000;
const SEA_LEVEL = 1200;
const WATER_HEIGHT = 6300;
const SHALLOW_DEPTH = 500;
const SHALLOW_HEIGHT = 1360;
const DEPTH_MARKS = [
  0, 100, 200, 300, 400, 500, 600, 700, 800, 900,
  1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000,
];
const HABITATS: { depth: number; habitat: Habitat }[] = [
  { depth: 20, habitat: "reef" },
  { depth: 100, habitat: "reef" },
  { depth: 220, habitat: "twilight" },
  { depth: 355, habitat: "twilight" },
  { depth: 520, habitat: "twilight" },
  { depth: 870, habitat: "twilight" },
  { depth: 1350, habitat: "midnight" },
  { depth: 1850, habitat: "midnight" },
  { depth: 2450, habitat: "midnight" },
  { depth: 2950, habitat: "crystal" },
  { depth: 3520, habitat: "crystal" },
  { depth: 4100, habitat: "abyss" },
  { depth: 4650, habitat: "ruins" },
  { depth: 5200, habitat: "abyss" },
  { depth: 5750, habitat: "vents" },
  { depth: 6300, habitat: "vents" },
  { depth: 6790, habitat: "abyss" },
];
const DEEP_SECTION_METRES = 1400;
const DEEP_TERRAIN = ["vents", "crystal", "ruins"] as const;

function worldY(metres: number) {
  // Give the shallow reef more vertical space so the shoreline passes early in the dive.
  if (metres <= SHALLOW_DEPTH) return SEA_LEVEL + (metres / SHALLOW_DEPTH) * SHALLOW_HEIGHT;
  const deepFraction = (metres - SHALLOW_DEPTH) / (MAX_DEPTH - SHALLOW_DEPTH);
  return SEA_LEVEL + SHALLOW_HEIGHT + deepFraction * (WATER_HEIGHT - SHALLOW_HEIGHT);
}

export function DiveScene({
  players,
  userId,
  score,
  round,
  roundCount,
  callout,
  hud,
  controls,
  finished = false,
  onFinish,
  online,
}: {
  players: Players;
  userId: number;
  score: number;
  round: number;
  roundCount: number | null;
  callout: { tier: string; answer: string } | null;
  hud: ReactNode;
  controls: ReactNode;
  finished?: boolean;
  onFinish?: () => void;
  online?: OnlineMode | null;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const [field, setField] = useState({ top: 0, height: 0, cameraAnchor: 0 });
  const [diving, setDiving] = useState(false);
  const lastScore = useRef(score);

  useEffect(() => {
    if (score <= lastScore.current) {
      lastScore.current = score;
      return;
    }
    lastScore.current = score;
    const start = window.setTimeout(() => setDiving(true), 0);
    const stop = window.setTimeout(() => setDiving(false), 1900);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [score]);

  useEffect(() => {
    const element = fieldRef.current;
    const world = worldRef.current;
    if (!element || !world) return;
    const observer = new ResizeObserver(() => {
      setField({ top: element.offsetTop, height: element.clientHeight, cameraAnchor: world.offsetTop });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const metres = score * 10;
  const playerY = worldY(metres);
  const deepBand = Math.max(MAX_DEPTH + 500, Math.floor(metres / 500) * 500 - 1000);
  const marks = roundCount === null
    ? [...DEPTH_MARKS, ...Array.from({ length: 7 }, (_, index) => deepBand + index * 500)]
    : DEPTH_MARKS;
  const activeSection = Math.max(0, Math.floor((metres - MAX_DEPTH) / DEEP_SECTION_METRES));
  const firstSection = Math.max(0, activeSection - 1);
  const deepSections = roundCount === null && metres >= MAX_DEPTH - 1800
    ? Array.from({ length: 4 }, (_, offset) => firstSection + offset)
    : [];
  const cameraTop = playerY - field.cameraAnchor;
  const opponents = players.filter((player) => player.id !== userId);
  const above = opponents.filter((player) => worldY(player.score * 10) - cameraTop < field.top);
  const below = opponents.filter((player) => worldY(player.score * 10) - cameraTop > field.top + field.height);
  const zone = metres >= 6000 ? "Hadal" : metres >= 4000 ? "Abyss" : metres >= 1000 ? "Midnight" : metres >= 200 ? "Twilight" : "Sunlit";

  return (
    <section className={`play-layout${finished ? " dive-finished" : ""}`} aria-label={finished ? "Dive results" : "Live dive"}>
      <div className="descent-scene" aria-label="Ocean scenery">
        {diving && <div className="descent-motion" aria-hidden="true" />}
        <div ref={worldRef} className="depth-world" style={{ transform: `translateY(${-playerY}px)` }}>
          <div className="ocean-sky" style={{ height: SEA_LEVEL }} aria-hidden="true">
            <SkyScenery />
          </div>
          <div className="ocean-water" style={{ top: SEA_LEVEL, height: WATER_HEIGHT }} aria-hidden="true">
            <ReefScenery />
            <div className="descent-waterline" />
            {roundCount !== null && <div className="ocean-seabed" />}
          </div>
          {deepSections.map((section) => {
            const depth = MAX_DEPTH + section * DEEP_SECTION_METRES;
            const start = worldY(depth);
            const height = worldY(depth + DEEP_SECTION_METRES) - start;
            const terrain = DEEP_TERRAIN[(section + Math.floor(section / 3)) % DEEP_TERRAIN.length];
            return (
              <div
                className="ocean-water deep-ocean-section"
                data-terrain={terrain}
                key={section}
                style={{ top: start, height: Math.ceil(height) + 1 }}
                aria-hidden="true"
              >
                <ReefScenery terrain={terrain} seed={section * 59} />
                {[.13, .43, .72].map((fraction, index) => (
                  <div className="ocean-habitat" style={{ top: height * fraction }} key={fraction}>
                    <OceanWildlife habitat={terrain} seed={section * 37 + index * 11} />
                  </div>
                ))}
              </div>
            );
          })}
          {marks.map((mark) => (
            <div className="depth-marker" key={mark} style={{ top: worldY(mark) }} aria-hidden="true">
              {mark.toLocaleString()} m
            </div>
          ))}
          {HABITATS.map(({ depth, habitat }) => (
            <div className="ocean-habitat" key={depth} style={{ top: worldY(depth) }} aria-hidden="true">
              <OceanWildlife habitat={habitat} seed={depth} />
            </div>
          ))}
          {players.map((player) => {
            const local = player.id === userId;
            const lane = players.findIndex((candidate) => candidate.id === player.id);
            const left = lane === 0 ? 50 : (lane % 2 === 1 ? 1 : -1) * (18 + (Math.floor((lane - 1) / 2) % 3) * 8) + 50;
            return (
              <div
                className={`diving-krill${local ? " my-krill" : ""}${local && diving ? " krill-descending" : ""}`}
                key={player.id}
                style={{ top: worldY(player.score * 10), left: `${left}%` }}
              >
                <span className="krill-name">
                  {player.username}
                  {(player.rank || player.admin_rank) && <small className="rank-badge" data-rank={(player.rank || player.admin_rank)!.minimum} style={{ color: (player.rank || player.admin_rank)!.color }}>{(player.rank || player.admin_rank)!.name}</small>}
                </span>
                <KrillSkin skin={player.skin} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="dive-hud">
        <div className="depth-bar">
          <span>Depth</span>
          <strong>{metres.toLocaleString()} m</strong>
          <small>{zone}</small>
        </div>
        {!finished && <div className="dive-progress">
          {online && <span>{online === "ranked" ? "Ranked 1v1" : "Casual Online"}</span>}
          {roundCount !== null && <div className="dive-progress-pips" aria-hidden="true">
            {Array.from({ length: roundCount }, (_, index) => (
              <span key={index} className={index + 1 === round ? "current" : index < round ? "complete" : undefined} />
            ))}
          </div>}
          <span>{roundCount === null ? `Endless · Prompt ${round}` : `Prompt ${round} of ${roundCount}`}</span>
          {onFinish && <button className="secondary-button finish-dive" onClick={onFinish}>Finish dive</button>}
        </div>}
      </div>
      {hud}
      <div className="dive-field" ref={fieldRef}>
        {field.height > 0 && (
          <>
            <DepthIndicators players={above} direction="above" />
            <DepthIndicators players={below} direction="below" />
          </>
        )}
        {!finished && callout && (
          <div className={`answer-callout tier-${callout.tier}`} role="status">
            <strong>{callout.tier === "krillion" ? "One in a Krillion" : callout.tier.replaceAll("_", " ")}</strong>
            <span>“{callout.answer}”</span>
          </div>
        )}
      </div>
      <div className="dive-controls">{controls}</div>
    </section>
  );
}

function DepthIndicators({ players, direction }: { players: Players; direction: "above" | "below" }) {
  if (!players.length) return null;
  return (
    <ul className={`dive-indicators indicators-${direction}`} aria-label={`Divers ${direction}`}>
      {players.map((player) => (
        <li key={player.id}>{direction === "above" ? "↑" : "↓"} {player.username} · {(player.score * 10).toLocaleString()} m</li>
      ))}
    </ul>
  );
}

/*
Show the Ranked queue controls, rank boundaries, and Elo history.
Edit this file to change the Ranked lobby or its history display.
*/

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { postJson } from "../shared/api";
import type { RankedOverview } from "../shared/types";
import "./ranked-menu.css";

export function RankedMenu({ connected, queueing, join, queueStatus, error }: {
  connected: boolean;
  queueing: boolean;
  join: (anyElo: boolean) => void;
  queueStatus: ReactNode;
  error: string;
}) {
  const [overview, setOverview] = useState<RankedOverview>();
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let active = true;
    postJson<RankedOverview>("/game/ranked").then(
      (result) => { if (active) setOverview(result); },
      (failure: Error) => { if (active) setLoadError(failure.message); },
    );
    return () => { active = false; };
  }, []);

  return (
    <section className="ranked-menu">
      <Link className="text-button ranked-back" to="/">← Dive lobby</Link>
      <header className="ranked-header">
        <div>
          <h2>Ranked 1v1</h2>
          <p>Seven prompts. The deepest diver wins.</p>
        </div>
        {overview && <div className="ranked-current">
          <strong className="rank-badge" data-rank={overview.rank.minimum} style={{ color: overview.rank.color }}>{overview.rank.name}</strong>
          <span>{overview.elo.toLocaleString()} Elo</span>
        </div>}
      </header>

      <div className="ranked-queue">
        <div className="queue-actions">
          <button className="primary-button" disabled={queueing || !connected} onClick={() => join(false)}>Find a Ranked match</button>
          <button className="secondary-button" disabled={queueing || !connected} onClick={() => join(true)}>Queue at any Elo</button>
        </div>
        {!connected && !queueing && <p role="status">Connecting to matchmaking…</p>}
        {queueStatus}
        {error && <p role="alert" className="game-alert">{error}</p>}
      </div>

      {loadError && <p role="alert">{loadError}</p>}
      {!overview && !loadError && <p role="status">Loading Ranked stats…</p>}
      {overview && <div className="ranked-panels">
        <section className="ranked-panel" aria-label="Elo history">
          <h3>Elo history</h3>
          {overview.history.length ? <EloGraph history={overview.history} /> : <p>Finish a Ranked match to start your Elo history.</p>}
          <p className="ranked-note">Bigger upsets can move up to {overview.max_swing} Elo.</p>
        </section>
        <section className="ranked-panel">
          <h3>Rank boundaries</h3>
          <table className="rank-boundaries">
            <thead><tr><th scope="col">Rank</th><th scope="col">Minimum Elo</th></tr></thead>
            <tbody>
              {overview.ranks.map((rank) => <tr key={rank.minimum}>
                <th scope="row" style={{ color: rank.color }}>{rank.name}</th>
                <td>{rank.minimum.toLocaleString()}</td>
              </tr>)}
            </tbody>
          </table>
          <p className="ranked-note"><span className="admin-rank-text">{overview.admin_rank.name}</span> is reserved for admins, who start at {overview.admin_rank.minimum.toLocaleString()} Elo.</p>
        </section>
      </div>}
    </section>
  );
}

function EloGraph({ history }: { history: RankedOverview["history"] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const position = Math.min(selected ?? history.length, history.length);
  const points = [history[0].before, ...history.map((match) => match.elo)];
  const top = Math.max(...points) + 8;
  const bottom = Math.max(0, Math.min(...points) - 8);
  const middle = Math.round((top + bottom) / 2);
  const rating = points[position];
  const match = history[position - 1];
  const change = match ? match.elo - match.before : 0;
  const summary = match
    ? `Match ${position} · ${match.outcome === 1 ? "Win" : match.outcome === 0 ? "Loss" : "Draw"} · ${rating.toLocaleString()} Elo (${change > 0 ? "+" : ""}${change})`
    : `Before first shown match · ${rating.toLocaleString()} Elo`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratings = [history[0].before, ...history.map((entry) => entry.elo)];
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);
      const x = (index: number) => 5 + index * (width - 10) / (ratings.length - 1);
      const y = (elo: number) => 5 + (top - elo) / (top - bottom) * (height - 10);
      ctx.strokeStyle = "#355a70";
      for (const level of [top, middle, bottom]) {
        ctx.beginPath();
        ctx.moveTo(0, y(level));
        ctx.lineTo(width, y(level));
        ctx.stroke();
      }
      ctx.beginPath();
      ratings.forEach((elo, index) => {
        if (index === 0) ctx.moveTo(x(index), y(elo));
        else ctx.lineTo(x(index), y(elo));
      });
      ctx.strokeStyle = "#67e8f9";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "#fff3ce";
      ctx.fillRect(x(position) - 3, y(ratings[position]) - 3, 6, 6);
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [history, position, top, middle, bottom]);

  return (
    <figure className="elo-graph">
      <figcaption>Last {history.length} Ranked {history.length === 1 ? "match" : "matches"}</figcaption>
      <div className="elo-plot">
        <div className="elo-axis" aria-hidden="true">
          {[top, middle, bottom].map((value) => <span key={value}>{value.toLocaleString()}</span>)}
        </div>
        <canvas ref={canvasRef} role="img" aria-label="Elo by Ranked match. Use the history slider to inspect each result." />
      </div>
      <label className="elo-scrubber">
        Inspect match history
        <input type="range" min={0} max={history.length} value={position} aria-valuetext={summary} onChange={(event) => setSelected(Number(event.target.value))} />
      </label>
      <output className="elo-reading">{summary}</output>
    </figure>
  );
}

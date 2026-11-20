/*
This page lets signed-in players create or join a Krillion-style room and play seven rounds.
Edit it when lobby, live question, scoring, or results behavior changes; copy its state pattern for another game mode.
*/

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../app/auth";
import { clearSavedRoomCode, getSavedRoomCode, saveRoomCode } from "../shared/gameSession";
import { createUserSocket, type SocketStatus } from "../shared/socket";
import type { OnlineMode, WsMessage } from "../shared/types";
import { DiveScene } from "./DiveScene";
import { AnswerReview } from "./AnswerReview";
import { SurfaceMenu } from "./SurfaceMenu";

type RoomMessage = Extract<WsMessage, { type: "game.room" }>;

export function HomePage({ onConnectionStatus }: { onConnectionStatus?: (status: SocketStatus) => void } = {}) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SocketStatus>("idle");
  const [room, setRoom] = useState<RoomMessage | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
  const [answer, setAnswer] = useState("");
  const [seconds, setSeconds] = useState(25);
  const [answerCallout, setAnswerCallout] = useState<{ tier: string; answer: string } | null>(null);
  const [error, setError] = useState("");
  const [queue, setQueue] = useState<{ mode: OnlineMode; since: number; openAfter: number | null } | null>(null);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const socketRef = useRef<ReturnType<typeof createUserSocket> | null>(null);
  const roomCodeRef = useRef("");
  const roundRef = useRef<number | undefined>(undefined);
  const me = room?.players.find((player) => player.id === user?.id);
  const lastAnswer = me?.last_answer;
  const lastTier = me?.last_tier;
  const currentRound = room?.round;

  useEffect(() => {
    if (!user) return;
    const savedCode = getSavedRoomCode();
    roomCodeRef.current = savedCode;
    const connection = createUserSocket({
      onMessage(message: WsMessage) {
        if (message.type === "ws.ready") {
          connection.send({ type: "game.categories" });
          connection.send({ type: "game.online_status", code: roomCodeRef.current || null });
        } else if (message.type === "game.categories") {
          setCategories(message.categories);
        } else if (message.type === "game.queue") {
          setWaitSeconds(message.elapsed);
          setQueue(message.mode ? {
            mode: message.mode,
            since: Date.now() - message.elapsed * 1000,
            openAfter: message.open_after ?? null,
          } : null);
          if (message.mode) setRoom(null);
        } else if (message.type === "game.room") {
          setQueue(null);
          if (message.status === "playing" && (message.code !== roomCodeRef.current || message.round !== roundRef.current)) {
            roundRef.current = message.round;
            setAnswer("");
          }
          roomCodeRef.current = message.code;
          saveRoomCode(message.code);
          setRoom(message);
          setError("");
        } else if (message.type === "game.error") {
          if (message.code === "room_not_found" || message.code === "room_started") {
            roomCodeRef.current = "";
            clearSavedRoomCode();
          }
          setError(message.message);
        }
      },
      onStatus: (nextStatus) => {
        setStatus(nextStatus);
        onConnectionStatus?.(nextStatus);
      },
    });
    socketRef.current = connection;
    return () => {
      connection.stop();
      socketRef.current = null;
      onConnectionStatus?.("idle");
    };
  }, [user, onConnectionStatus]);

  useEffect(() => {
    if (room?.status !== "playing") return;
    if (room.paused) {
      const timer = window.setTimeout(() => setSeconds(Math.ceil(room.remaining_seconds ?? 0)), 0);
      return () => window.clearTimeout(timer);
    }
    if (!room.deadline) return;
    const update = () => setSeconds(Math.max(0, Math.ceil(room.deadline! - Date.now() / 1000)));
    update();
    const timer = window.setInterval(update, 200);
    return () => window.clearInterval(timer);
  }, [room?.deadline, room?.paused, room?.remaining_seconds, room?.status]);

  useEffect(() => {
    if (!me?.answered || !lastAnswer || !lastTier) {
      const clear = window.setTimeout(() => setAnswerCallout(null), 0);
      return () => window.clearTimeout(clear);
    }
    const show = window.setTimeout(() => setAnswerCallout({ tier: lastTier, answer: lastAnswer }), 0);
    const timeout = window.setTimeout(() => setAnswerCallout(null), 2200);
    return () => { window.clearTimeout(show); window.clearTimeout(timeout); };
  }, [me?.answered, lastAnswer, lastTier, currentRound]);

  useEffect(() => {
    if (!queue) return;
    const tick = () => setWaitSeconds(Math.floor((Date.now() - queue.since) / 1000));
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [queue]);

  const send = (message: object) => {
    setError("");
    if (!socketRef.current?.send(message)) setError("Connecting to the game server. Try again in a moment.");
  };

  const leaveRoom = () => {
    if (room?.online && room.status === "playing") {
      if (room.online !== "ranked" || window.confirm("Leave this Ranked match and take a loss?")) {
        send({ type: "game.leave", code: room.code });
      }
      return;
    }
    if (room) send({ type: "game.leave", code: room.code });
    roomCodeRef.current = "";
    clearSavedRoomCode();
    setRoom(null);
  };

  if (!user) {
    return (
      <SurfaceMenu
        title={
          <>
            <h2>
              Think deeper<span>.</span>
            </h2>
            <p>A deep dive for one or more players</p>
          </>
        }
      >
        <p className="surface-intro">Seven prompts. Twenty-five seconds each. Rarer answers take you deeper.</p>
        <Link className="primary-button" to="/login">
          Sign in to dive <span aria-hidden="true">↓</span>
        </Link>
        <Link className="primary-button" to="/register">Create account</Link>
      </SurfaceMenu>
    );
  }

  const answered = Boolean(me?.answered);
  const orderedPlayers = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);

  if (room?.status === "settling") return <p role="status">Saving dive results…</p>;

  if (room?.status === "playing" || room?.status === "finished") {
    return (
      <DiveScene
        players={room.players}
        userId={user.id}
        score={me?.score ?? 0}
        round={room.round ?? 1}
        roundCount={room.mode === "endless" ? null : (room.round_count ?? 7)}
        onFinish={room.mode === "endless" && room.status === "playing"
          ? () => send({ type: "game.finish", code: room.code })
          : undefined}
        callout={answerCallout}
        finished={room.status === "finished"}
        online={room.online}
        hud={room.status === "playing" && room.question ? (
          <article className="question-panel">
            <p className="question-category">{room.question.category}</p>
            <h2>{room.question.prompt}</h2>
            {room.question.hint && <p className="question-hint">Hint: {room.question.hint}</p>}
          </article>
        ) : (
          <article className="results-panel">
            <p className="eyebrow">Dive complete</p>
            <h2>{room.timed_out ? "Time’s up." : room.mode === "multiplayer" ? "The crew reached the deep." : "You reached the deep."}</h2>
            <div className="results-list">
              {(room.rankings ?? []).map((player, index) => (
                <div className={`result-row ${index === 0 ? "winner" : ""}`} key={player.id}>
                  <span className="rank">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{player.username}</strong>
                  <span>{player.depth.toLocaleString()} m</span>
                  <small>{player.score} pts · {player.answer_time.toFixed(1)} sec</small>
                </div>
              ))}
            </div>
            {Boolean(room.review?.length) && <AnswerReview questions={room.review!} />}
            {room.void && <p>{room.online === "ranked" ? "Match void. Elo was unchanged." : "Match ended without a winner."}</p>}
            {room.online === "ranked" && !!room.rewards?.length && (
              <ul className="ranked-results" aria-label="Ranked Elo changes">
                {room.rewards.map((reward) => (
                  <li key={reward.id}>
                    <strong>{room.players.find((player) => player.id === reward.id)?.username} · {reward.outcome === 1 ? "Win" : reward.outcome === .5 ? "Draw" : "Loss"}</strong>
                    <span>{reward.before} → {reward.elo} Elo ({reward.change > 0 ? "+" : ""}{reward.change})</span>
                    <span className="rank-badge" data-rank={reward.rank.minimum} style={{ color: reward.rank.color }}>{reward.rank.name}</span>
                  </li>
                ))}
              </ul>
            )}
            {!!room.rewards?.find((reward) => reward.id === user.id)?.unlocked.length && (
              <p role="status">Skins unlocked: {room.rewards.find((reward) => reward.id === user.id)?.unlocked.join(", ")}</p>
            )}
            <button className="primary-button" onClick={leaveRoom}>Back to lobby</button>
          </article>
        )}
        controls={room.status === "playing" ? (
          <>
            {error && <p role="alert" className="game-alert">{error}</p>}
            {room.online && !me?.forfeited && <button className="text-button online-quit" onClick={leaveRoom}>Leave match</button>}
            <div className="answer-dock">
              <span
                className="timer"
                role="timer"
                data-urgent={seconds <= 10 && !room.paused}
                style={{ "--time-left": `${Math.min(100, (seconds / 25) * 100)}%` } as CSSProperties}
                aria-label={room.paused ? "Timer paused" : `${seconds} seconds remaining`}
              >
                <strong>{room.paused ? "Ⅱ" : seconds}</strong>
              </span>
              <article className="answer-panel">
                {me?.forfeited ? (
                  <p className="answered-state">You left the match. The remaining divers are still playing.</p>
                ) : answered ? (
                  <div className="answered-state">
                    <strong>Dive recorded</strong>
                    <span>
                      {me?.last_answer} · {me?.last_tier?.replaceAll("_", " ")}
                    </span>
                    <small>{room.mode === "multiplayer" ? "Waiting for the other divers…" : "Preparing the next prompt…"}</small>
                  </div>
                ) : me?.checking ? (
                  <div className="answered-state">
                    <strong>Checking with web sources…</strong>
                    <span>{answer}</span>
                    <small>This can take a few seconds. The round timer is paused while answers are checked.</small>
                  </div>
                ) : (
                  <form
                    className="answer-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      send({ type: "game.answer", code: room.code, answer });
                    }}
                  >
                    <input
                      autoComplete="off"
                      aria-label="Your answer"
                      maxLength={120}
                      placeholder="Type one answer…"
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                    />
                    <button className="primary-button" disabled={!answer.trim()}>
                      Dive <span>↵</span>
                    </button>
                  </form>
                )}
              </article>
            </div>
            {room.mode === "multiplayer" && <details className="dive-crew">
              <summary>{room.players.length} divers{status !== "connected" && ` · ${status}`}</summary>
              <PlayerList players={orderedPlayers} hostId={room.host_id} compact />
            </details>}
          </>
        ) : null}
      />
    );
  }

  if (!room) {
    return (
      <SurfaceMenu
        title={
          <>
            <h2>Ready to dive, {user.is_admin ? <span className="admin-rank-text">{user.username}</span> : user.username}?</h2>
          </>
        }
      >
        {error && <p role="alert" className="game-alert">{error}</p>}
        <div className="online-options">
          <button className="primary-button" disabled={!!queue || status !== "connected"} onClick={() => send({ type: "game.queue", mode: "casual" })}>
            Casual Online
          </button>
          <button className="secondary-button" disabled={!!queue || status !== "connected"} onClick={() => send({ type: "game.queue", mode: "ranked" })}>
            Ranked 1v1
          </button>
        </div>
        {queue && (
          <div className="queue-status">
            <p role="status">Searching for a {queue.mode === "ranked" ? "Ranked" : "Casual"} match · {waitSeconds}s</p>
            {status !== "connected" ? <p>Reconnecting to matchmaking…</p> : queue.openAfter !== null && (
              <p>{waitSeconds < queue.openAfter ? `Any Elo after ${queue.openAfter - waitSeconds}s` : "Waiting for an opponent at any Elo"}</p>
            )}
            <button className="text-button" onClick={() => send({ type: "game.queue_cancel" })}>Cancel queue</button>
          </div>
        )}
        <label className="surface-category">
          Dive category
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.count} prompts</option>)}
          </select>
        </label>
        <button className="primary-button" onClick={() => send({ type: "game.create_solo", category })}>
          Play solo <span aria-hidden="true">↓</span>
        </button>
        <button className="secondary-button" onClick={() => send({ type: "game.create_endless", category })}>
          Play endless <span aria-hidden="true">∞</span>
        </button>
        <button className="primary-button" onClick={() => send({ type: "game.create", category })}>
          Create room <span aria-hidden="true">↓</span>
        </button>
        <form
          className="surface-join"
          onSubmit={(event) => {
            event.preventDefault();
            const code = roomInput.trim().toUpperCase();
            if (code.length !== 6) {
              setError("Room codes have six characters.");
              return;
            }
            roomCodeRef.current = code;
            send({ type: "game.join", code });
          }}
        >
          <input
            aria-label="Room code"
            maxLength={6}
            placeholder="Room code"
            value={roomInput}
            onChange={(event) => setRoomInput(event.target.value.toUpperCase())}
          />
          <button className="secondary-button" type="submit">Join room</button>
        </form>
      </SurfaceMenu>
    );
  }

  if (room.status === "lobby") {
    return (
      <SurfaceMenu
        lobby
        title={
          <>
            <h2 className="eyebrow">Private room</h2>
            <div className="room-code">{room.code}</div>
          </>
        }
      >
        {error && <p role="alert" className="game-alert">{error}</p>}
        <p className="surface-intro">Category: {room.category || "All categories"}</p>
        {room.host_id === user.id ? (
          <p className="surface-intro">
            {room.players.length < 2 ? "Share the code with a friend to start your dive." : "Your crew is ready to dive."}
          </p>
        ) : null}
        <PlayerList players={room.players} hostId={room.host_id} />
        {room.host_id === user.id ? (
          <button className="primary-button" disabled={room.players.length < 2} onClick={() => send({ type: "game.start", code: room.code })}>
            Begin descent <span aria-hidden="true">↓</span>
          </button>
        ) : (
          <span className="waiting-label">
            <i /> Waiting for host to begin
          </span>
        )}
        <button className="text-button" onClick={leaveRoom}>Leave room</button>
      </SurfaceMenu>
    );
  }

  return (
    <section className="game-shell">
      <div className="game-topline">
        <div>
          <p className="eyebrow">The endless dive</p>
          <h2>Ready to dive, {user.username}?</h2>
        </div>
      </div>
      {error && (
        <p role="alert" className="game-alert">
          {error}
        </p>
      )}
    </section>
  );
}

function PlayerList({ players, hostId, compact = false }: { players: RoomMessage["players"]; hostId: number; compact?: boolean }) {
  return (
    <article className={`players-card ${compact ? "compact" : ""}`}>
      <p className="eyebrow">On this dive · {players.length}</p>
      {players.map((player) => (
        <div className="player-row" key={player.id}>
          <span className="player-avatar">{player.username.slice(0, 1).toUpperCase()}</span>
          <span className="player-name">
            {player.username}
            {player.admin_rank && <small className="rank-badge" data-rank={player.admin_rank.minimum}>{player.admin_rank.name}</small>}
            {player.id === hostId && <small>Host</small>}
            {player.checking && <small className="ready-tag">Checking</small>}
            {player.answered && <small className="ready-tag">Ready</small>}
          </span>
          {compact && <strong>{player.score}</strong>}
        </div>
      ))}
    </article>
  );
}

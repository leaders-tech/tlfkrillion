/*
This file keeps the small shared TypeScript types for users, game rooms, API results, and websocket messages.
Edit this file when backend JSON shapes or websocket message shapes change.
Copy a type pattern here when you add another shared API or websocket type.
*/

export type User = {
  id: number;
  username: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type ApiOk<T> = {
  ok: true;
  data: T;
};

export type ApiFail = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiOk<T> | ApiFail;

export type ReviewQuestion = {
  prompt: string;
  category: string;
  answers: { answer: string; tier: string; points: number }[];
};

export type Skin = {
  id: string;
  name: string;
};

export type Rank = { name: string; color: string; minimum: number };
export type RankedOverview = {
  elo: number;
  rank: Rank;
  ranks: Rank[];
  admin_rank: Rank;
  history: { before: number; elo: number; outcome: number }[];
  max_swing: number;
};
export type Profile = {
  elo: number;
  rank: Rank;
  skin: string;
  dives: number;
  best_depth: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  skins: (Skin & {
    requirement: string;
    unlocked: boolean;
    progress?: { label: string; value: number; target: number };
  })[];
};

export type OnlineMode = "casual" | "ranked";

export type WsMessage =
  | { type: "ws.ready"; user_id: number; connections: number }
  | { type: "pong" }
  | { type: "game.queue"; mode: OnlineMode | null; elapsed: number; open_after?: number | null }
  | { type: "game.categories"; categories: { name: string; count: number }[] }
  | {
      type: "game.room";
      code: string;
      match_id?: string;
      mode: "solo" | "multiplayer" | "endless";
      category: string;
      online?: OnlineMode | null;
      status: "lobby" | "playing" | "finished" | "settling";
      host_id: number;
      players: { id: number; username: string; score: number; answered: boolean; checking: boolean; last_answer: string | null; last_tier: string | null; skin?: Skin | null; admin_rank?: Rank | null; forfeited?: boolean }[];
      question?: { prompt: string; hint: string; category: string; use_model?: boolean };
      round?: number;
      round_count?: number | null;
      deadline?: number | null;
      paused?: boolean;
      remaining_seconds?: number;
      timed_out?: boolean;
      void?: boolean;
      rewards?: { id: number; before: number; elo: number; change: number; rank: Rank; unlocked: string[]; unlocked_skins?: Skin[]; outcome: number }[];
      review?: ReviewQuestion[];
      rankings?: { id: number; username: string; score: number; depth: number; answer_time: number }[];
    }
  | { type: "game.error"; code: string; message: string };

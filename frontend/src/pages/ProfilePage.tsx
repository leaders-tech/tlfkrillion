/*
Show a player's Elo, dive stats, and achievement skins.
Edit this page when profile progression or equipment changes.
*/
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../app/auth";
import { postJson } from "../shared/api";
import type { Rank, Skin } from "../shared/types";
import { KrillSkin } from "./KrillSkin";
import "./profile.css";

type Profile = {
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

export function ProfilePage() {
  const { user, loading } = useAuth();
  const [profile, setProfile] = useState<Profile>();
  const [error, setError] = useState("");
  const [equipping, setEquipping] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    postJson<Profile>("/game/profile", {}).then(
      (result) => { if (active) setProfile(result); },
      (failure: Error) => { if (active) setError(failure.message); },
    );
    return () => { active = false; };
  }, [userId]);

  async function equip(skin: string) {
    setEquipping(true);
    setError("");
    try {
      setProfile(await postJson<Profile>("/game/profile/equip", { skin }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not equip this skin.");
    } finally {
      setEquipping(false);
    }
  }

  if (loading) return <p>Loading profile…</p>;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <section className="profile-page">
      <p className="eyebrow">Player profile</p>
      <h2>{user.username}</h2>
      {error && <p role="alert">{error}</p>}
      {profile && (
        <>
          <div className="profile-sections">
            <article>
              <h3>Elo</h3>
              <strong className="rank-badge" data-rank={profile.rank.minimum} style={{ color: profile.rank.color }}>{profile.rank.name}</strong>
              <p>{profile.elo.toLocaleString()} Elo</p>
            </article>
            <article>
              <h3>Stats</h3>
              <p>{profile.dives} completed dives · Best depth {profile.best_depth.toLocaleString()} m</p>
              <p>Ranked: {profile.wins} wins · {profile.losses} losses · {profile.draws} draws · {profile.streak} win streak</p>
            </article>
          </div>
          <h3>Skins</h3>
          <p>{profile.skins.filter((skin) => skin.unlocked).length} of {profile.skins.length} unlocked</p>
          <div className="skin-grid">
            {profile.skins.map((skin) => (
              <article className="skin-card" key={skin.id} data-locked={!skin.unlocked}>
                <KrillSkin skin={skin} />
                <h4>{skin.name}</h4>
                <p>{skin.requirement}</p>
                {skin.progress && <progress aria-label={skin.progress.label} value={skin.progress.value} max={skin.progress.target} />}
                {profile.skin === skin.id ? <strong>Equipped</strong> : skin.unlocked
                  ? <button className="secondary-button" disabled={equipping} onClick={() => void equip(skin.id)} aria-label={`Equip ${skin.name}`}>Equip</button>
                  : <small>Locked</small>}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

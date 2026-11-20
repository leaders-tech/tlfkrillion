/*
This admin page creates and edits game prompts and accepted rarity answers.
Edit it when question bank fields or admin editing behavior changes; copy it for another small admin editor.
*/

import { useEffect, useMemo, useState } from "react";
import { postJson } from "../shared/api";
import { matchesQuestionSearch, searchWords } from "../shared/questionSearch";
import type { Profile } from "../shared/types";
import { ProfileDetails } from "./ProfilePage";

type Tier = "plankton" | "too_clever" | "schooler" | "rare" | "deep_cut" | "krillion";
type Answer = { answer: string; aliases: string[]; tier: Tier };
type Question = { id: number; prompt: string; hint: string; category: string; use_model: boolean; answers: Answer[] };
type Player = { id: number; username: string; is_admin: boolean };
const tiers: Tier[] = ["plankton", "too_clever", "schooler", "rare", "deep_cut", "krillion"];
const tierNames: Record<Tier, string> = {
  plankton: "Plankton · 10",
  too_clever: "Too Clever · 15",
  schooler: "Schooler · 30",
  rare: "Rare · 60",
  deep_cut: "Deep Cut · 85",
  krillion: "One in a Krillion · 100",
};

export function AdminPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState("");
  const [category, setCategory] = useState("General");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [search, setSearch] = useState("");
  const [useModel, setUseModel] = useState(true);
  const [answerLines, setAnswerLines] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [playerPassword, setPlayerPassword] = useState("");
  const [playerMessage, setPlayerMessage] = useState("");
  const [profileId, setProfileId] = useState<number | null>(null);
  const categories = [...new Set(["General", ...questions.map((question) => question.category)])].sort();
  const selectedCategory = categories.includes(categoryFilter) ? categoryFilter : "";
  const questionIndex = useMemo(() => questions.map((question) => ({
    question,
    words: searchWords([
      question.prompt, question.hint, question.category,
      ...question.answers.flatMap(({ answer, aliases }) => [answer, ...aliases]),
    ].join(" ")),
  })), [questions]);
  const query = searchWords(search);
  const visibleQuestions = questionIndex
    .filter(({ question, words }) => (!selectedCategory || question.category === selectedCategory) && matchesQuestionSearch(query, words))
    .map(({ question }) => question);

  const loadQuestions = () => postJson<{ questions: Question[] }>("/game/questions/list").then((data) => setQuestions(data.questions));
  const loadPlayers = () => postJson<{ users: Player[] }>("/admin/users/list").then((data) => setPlayers(data.users));
  useEffect(() => {
    Promise.all([loadQuestions(), loadPlayers()]).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load admin data."));
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setPrompt("");
    setHint("");
    setCategory("General");
    setUseModel(true);
    setAnswerLines("");
  };
  const editQuestion = (question: Question) => {
    setEditingId(question.id);
    setPrompt(question.prompt);
    setHint(question.hint);
    setCategory(question.category);
    setUseModel(question.use_model);
    setAnswerLines(question.answers.map(({ tier, answer, aliases }) => `${tier} | ${answer}${aliases.length ? ` | ${aliases.join(", ")}` : ""}`).join("\n"));
    setError("");
    setSaved("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSaved("");
    try {
      const answers = answerLines
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [tier, text, aliases = ""] = line.split("|").map((part) => part.trim());
          if (!tiers.includes(tier as Tier) || !text) throw new Error("Use: tier | answer | optional aliases");
          return {
            tier,
            answer: text,
            aliases: aliases
              ? aliases
                  .split(",")
                  .map((alias) => alias.trim())
                  .filter(Boolean)
              : [],
          };
        });
      if (answers.length < 15) throw new Error("Add at least 15 distinct accepted answers.");
      await postJson<{ question: Question }>("/game/questions/save", { id: editingId ?? undefined, prompt, hint, category, answers, use_model: useModel });
      await loadQuestions();
      resetForm();
      setSaved("Question saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save question.");
    }
  };

  const remove = async (question: Question) => {
    if (!window.confirm(`Delete “${question.prompt}”?`)) return;
    try {
      await postJson("/game/questions/delete", { id: question.id });
      await loadQuestions();
      if (editingId === question.id) resetForm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete question.");
    }
  };

  const createPlayer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setPlayerMessage("");
    try {
      await postJson("/admin/users/create", { username: playerName, password: playerPassword });
      await loadPlayers();
      setPlayerName("");
      setPlayerPassword("");
      setPlayerMessage("Player account created. Share the username and password with them.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create player account.");
    }
  };

  return (
    <section className="admin-shell">
      <div className="game-topline">
        <div>
          <p className="eyebrow">The question bank</p>
          <h2>Set the next dive.</h2>
        </div>
        <span className="question-count">{questions.length} prompts</span>
      </div>
      <div className="admin-layout">
        <form className="question-editor" onSubmit={(event) => void save(event)}>
          <p className="eyebrow">{editingId ? "Edit prompt" : "New prompt"}</p>
          <label>
            Question prompt
            <input required maxLength={240} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Name a moon of Jupiter." />
          </label>
          <label>
            Category
            <input required maxLength={60} list="question-categories" value={category} onChange={(event) => setCategory(event.target.value)} />
            <datalist id="question-categories">
              {categories.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          <label>
            Optional hint
            <input maxLength={240} value={hint} onChange={(event) => setHint(event.target.value)} placeholder="Think beyond the largest moons." />
          </label>
          <label className="check-label">
            <input type="checkbox" checked={useModel} onChange={(event) => setUseModel(event.target.checked)} />
            Use AI to check unknown answers
          </label>
          <label>
            Accepted answers
            <textarea
              required
              rows={8}
              value={answerLines}
              onChange={(event) => setAnswerLines(event.target.value)}
              placeholder={"plankton | Io\nschooler | Europa\nrare | Callisto\ndeep_cut | Carme"}
            />
          </label>
          <p className="editor-help">
            Add at least 15 distinct answers, one per line: <code>tier | answer | optional aliases</code>. Tiers: {tiers.map((tier) => tierNames[tier]).join(" · ")}.
          </p>
          {error && (
            <p role="alert" className="game-alert">
              {error}
            </p>
          )}
          {saved && <p className="saved-message">{saved}</p>}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {editingId ? "Save changes" : "Add question"}
            </button>
            {editingId && (
              <button className="text-button" type="button" onClick={resetForm}>
                Cancel
              </button>
            )}
          </div>
          <p className="editor-note">Classic dives pick seven prompts at random. Endless dives use the full playable bank.</p>
        </form>
        <div className="admin-side">
          <div className="question-list">
            <p className="eyebrow">Saved prompts</p>
            <label className="question-filter">
              Search questions
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Prompt, hint, answer, or alias" />
            </label>
            <label className="question-filter">
              Filter by category
              <select value={selectedCategory} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((name) => <option key={name}>{name}</option>)}
              </select>
            </label>
            {(query.length > 0 || selectedCategory) && <p role="status">{visibleQuestions.length} of {questions.length} prompts</p>}
            {visibleQuestions.length === 0 && <p>{query.length > 0 ? "No matching prompts." : "No prompts in this category."}</p>}
            {visibleQuestions.map((question) => (
              <article className="question-card" key={question.id}>
                <div>
                  <h3>{question.prompt}</h3>
                  <p>
                    {question.category} · {question.answers.length} accepted answers {question.hint && "· hint included"} · AI {question.use_model ? "on" : "off"}
                    {question.answers.length < 15 && " · Needs 15 answers to appear in play"}
                  </p>
                </div>
                <div className="question-actions">
                  <button onClick={() => editQuestion(question)}>Edit</button>
                  <button className="delete-action" onClick={() => void remove(question)}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          <section className="player-admin">
            <p className="eyebrow">Accounts · {players.length}</p>
            <h3>Invite your crew</h3>
            <p>Create a player account or open an existing profile.</p>
            <form onSubmit={(event) => void createPlayer(event)}>
              <label>
                Username
                <input
                  required
                  minLength={3}
                  maxLength={24}
                  pattern="[A-Za-z0-9_-]+"
                  value={playerName}
                  onChange={(event) => setPlayerName(event.target.value)}
                  placeholder="oceanfriend"
                />
              </label>
              <label>
                Temporary password
                <input
                  required
                  minLength={8}
                  type="password"
                  value={playerPassword}
                  onChange={(event) => setPlayerPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </label>
              <button className="secondary-button" type="submit">
                Create player account
              </button>
            </form>
            {playerMessage && <p className="saved-message">{playerMessage}</p>}
            {players.map((player) => (
              <div key={player.id}>
                <button
                  className="account-row"
                  type="button"
                  aria-expanded={profileId === player.id}
                  onClick={() => setProfileId(profileId === player.id ? null : player.id)}
                >
                  <span>{player.username}</span>
                  <small>{player.is_admin ? "Admin" : "Player"}</small>
                </button>
                {profileId === player.id && <AccountProfile key={player.id} player={player} />}
              </div>
            ))}
          </section>
        </div>
      </div>
    </section>
  );
}

function AccountProfile({ player }: { player: Player }) {
  const [profile, setProfile] = useState<Profile>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    postJson<Profile>("/admin/users/profile", { id: player.id }).then(
      (result) => { if (active) setProfile(result); },
      (failure: Error) => { if (active) setError(failure.message); },
    );
    return () => { active = false; };
  }, [player.id]);

  return (
    <section className="admin-account-profile" aria-label={`${player.username}'s profile`}>
      {error && <p role="alert">{error}</p>}
      {profile ? <ProfileDetails profile={profile} /> : !error && <p role="status">Loading profile…</p>}
    </section>
  );
}

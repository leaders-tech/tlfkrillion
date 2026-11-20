# Krillion · The Deep Dive

A rare-answer game with solo dives, private rooms, and online matchmaking. Players sign in with an existing account. Each round lasts 25 seconds. Rarer accepted answers earn more points and send your krill deeper.

## Run locally

Install the project tools once with `make setup`, then start the backend and frontend in separate terminals:

```bash
make back
make front
```

Open `http://localhost:5101`. In development, sign in as `user` / `user` or `admin` / `admin`.

## Play and manage questions

Create a private room and share its six-character code. At least two signed-in players are needed to start a dive. The game chooses seven prompts at random from the question bank. Each accepted answer earns its rarity tier score; the total score is shown as depth, and answer time breaks ties.

Choose **Casual Online** for a match of two to four players or **Ranked 1v1** for head-to-head Elo. Every player starts at 1,000 Elo. Completing dives and scoring specific answers can unlock new krill skins. Open your profile to see achievements and equip a skin.

Admins can edit the question bank at `/admin`. Each accepted answer line uses `tier | answer | optional aliases`; aliases are comma-separated. The supported tiers are `plankton`, `too_clever`, `schooler`, `rare`, `deep_cut`, and `krillion`. Eight starter questions are added if the bank is empty.

Admins can also create player accounts from the question bank page. This is needed in production, where only the admin account is created automatically. Give each player their own username and password.

Unknown answers can be checked against web sources during a round and, when confirmed, saved to the question bank with an estimated rarity tier. To enable this locally, add `OPENAI_API_KEY` to `.env` (or `.docker.env` for Docker). The app uses OpenAI's GPT-6 Luna model with built-in web search. Without the key, saved answers still work and unknown answers show a setup message.

## Checks

Run the full backend, frontend, and browser checks with:

```bash
make test
```

This runs Ruff, pytest, frontend lint/build/unit tests, and Playwright browser tests.

## Deployment

The app uses the existing tlfpaas setup. Configure `COOKIE_SECRET` and `ADMIN_PASSWORD` in the tlfpaas Secrets page, then redeploy. Add `OPENAI_API_KEY` there to enable web-based checking for unknown answers. The platform sends `/api` and `/ws` to the backend and serves the frontend at the project URL.

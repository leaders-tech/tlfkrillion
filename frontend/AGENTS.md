# Frontend Agent Notes

## Template lifecycle and current ownership

- This frontend is a starter template. Nothing in its demo pages, features, design, branding, assets, dependencies, or tooling must be preserved for its own sake.
- Replace or remove starter UI and flows to build what the user requests. The defaults below do not require retaining the template's product or architecture.
- With every application feature request, update this file and the root `AGENTS.md` in the same change. Identify remaining template pages/features and the parts that now belong to the user's application.
- User application: popup navigation and connection status in `src/app/App.tsx`, progression and cosmetics in `src/pages/ProfilePage.tsx`, coastal menu and room-code lobby in `src/pages/SurfaceMenu.tsx`, shared scenery in `src/pages/PixelScenery.tsx` and animated habitats in `src/pages/OceanWildlife.tsx`, solo and multiplayer dives in `src/pages/HomePage.tsx` and `src/pages/DiveScene.tsx`, the default pixel krill sprite in `public/krill.png`, the question and player editor in `src/pages/AdminPage.tsx`, and room resume in `src/shared/gameSession.ts`.
- The admin question bank has editable categories, a category filter, and a 15-answer minimum. The active question shows its category during a dive. The home menu offers Endless solo play, and `src/pages/AnswerReview.tsx` shows the rarity table for each finished prompt.
- The admin question bank searches prompts, categories, hints, accepted answers, and aliases with typo tolerance. Each account opens a read-only view of the player profile.
- The home menu selects a category for solo, Endless, or a new multiplayer room.
- Classic solo dives offer a Stop dive button. Endless dives have a Finish dive button that shows results.
- The home screen supports Casual and Ranked queues. Profile shows progression and achievement skins, and the profile and dive scene share a dedicated pixel sprite from `public/skins/<skin-id>.png` for each unlocked cosmetic. Keep skin IDs aligned with the backend reward catalog. Sprites use a 52×40 pixel canvas with a thin outline in each sprite's own dark color and no enclosed transparency. Show the name and artwork for locked secret skins. Keep their answer masked until unlock.
- `src/pages/RankedMenu.tsx` shows Ranked queue choices, an Elo chart with a match slider, and rank boundaries. It shares the lobby WebSocket with `HomePage.tsx`.
- Sevenfold Prism rewards a single classic dive with all six scored rarities and one round that expires without a submission.
- `src/pages/SkinUnlockReveal.tsx` animates new rewards in the dive results and keeps their cards visible when a result is reopened.
- The admin role displays the Abyss Architect rank and grants the Aurora Regent sprite.
- Usernames use their rank colours in the main menu and matches. The highest ranks have gradient and glow effects, and rank labels appear in profiles and dives.
- The home and login pages link to public registration at `/register`. `src/pages/LoginPage.tsx` renders both forms, and the auth provider signs in new players on success.
- Reused foundation: periodic cookie refresh in `src/app/auth.tsx` and shared WebSocket reconnect helper.
- Remaining starter material: none in active frontend code; the dashboard and notes demo have been removed.
- When the transition is complete, remove template inventories and all template-specific wording and instructions here. Keep instructions that describe the user's frontend.

## Working defaults

- This frontend is for students, so keep flows obvious and easy to inspect in a browser.
- Keep components small and readable — one file, one job.
- Use plain React state and small hooks. Do not add state managers (no Redux, Zustand, Jotai, etc.).
- Do not add a UI component library (no MUI, Ant Design, etc.). Tailwind CSS is already here.
- Keep all user-facing text in simple English.
- Keep browser API calls POST-based in this template — that is a deliberate teaching choice.
- Student-facing frontend config belongs in the root `.env` and `.docker.env` files, not in frontend-only env files.
- Keep frontend JSON calls on `/api/...` and keep websocket on `/ws` so same-origin production routing stays simple.
- Keep the production Docker build same-origin for tlfpaas: `VITE_BACKEND_URL` is the only current frontend build-time
  env var and should remain `/api` for production.
- If you add another public frontend build-time env var, use a `VITE_*` key and document it in `.docker.env.example`.
- Keep `frontend/Dockerfile` serving nginx on `8080` and keep the final runtime stage non-root with `USER nginx`.
- Hidden frontend agent commands:
  - `make afront`, `make aopen`, `make astop`
  - `make abrowser SCRIPT=path/to/scenario.mjs`
- Hidden frontend browser checks should prefer the agent frontend on `.agent.env` ports instead of the student-facing local ports when both may be active.

## File layout

- Pages live in `src/pages/`. Each page file should have a matching `.test.tsx` next to it.
- Reusable UI pieces used by more than one page go in `src/features/<feature>/` or `src/shared/`.
- TypeScript types shared across files belong in `src/shared/types.ts` — add new types there.
- Register a new page route in `src/app/App.tsx` whenever you add a new page file. Keep the catch-all
  `<Route path="*">` with `NotFoundPage` as the last route.
- The app icon source is `public/icon.svg`; see `icon/AGENTS.md` before changing icons or the app name.

## Forms

- Use the React 19 form pattern from `src/pages/LoginPage.tsx` and `src/pages/AdminPage.tsx`:
  `useActionState` + `<form action={...}>`. The action returns the error text to show, and the hook gives a `pending`
  flag for disabling the submit button.
- Keep inputs controlled with `useState` (`value` + `onChange`), so a failed submit keeps what the user typed.

## How to call the backend

- Import `postJson` from `src/shared/api.ts` and call it with the route path and a plain object.
- Never write a raw `fetch` for backend routes — `postJson` handles cookie auth, error wrapping, and one automatic
  `/api/auth/refresh` retry when the short-lived login cookie has expired.
- If the server is not running or returns an error, `postJson` throws an `ApiError`.
  Catch it and show `error.message` to the user so they know what went wrong.

## How to use authentication

- Call `useAuth()` from `src/app/auth.tsx` to read the current logged-in user and the logout function.
- A protected page should redirect to `/login` when `useAuth().user` is `null`.
- Do not call `/api/auth/me` yourself — `AuthProvider` from `src/app/auth.tsx` (wrapped around the app in `src/main.tsx`)
  loads the session on startup automatically.

## Real-time updates (WebSocket)

- WebSocket connection logic lives in `src/shared/socket.ts`.
- `src/pages/HomePage.tsx` shows the pattern: call `createUserSocket()` inside a `useEffect` while a user is
  logged in and call `socket.stop()` in the cleanup. The helper reconnects by itself.
- Check the browser console for WebSocket errors after any auth or routing change.

## Tests — always keep them green

- Lint with Oxlint (`npm run lint`). Its built-in React rules check Hooks and Fast Refresh; TypeScript checks app and unit-test types during `npm run build`.
- Keep `.oxlintrc.json` small and keep both Hooks rules enabled when updating tools.
- Unit tests use Vitest + React Testing Library.
  Run: `cd frontend && npm test`
- End-to-end tests use Playwright and live in `frontend/tests/e2e/`.
  Run: `cd frontend && npm run test:e2e`
- Every new page needs at least one unit test.
- Every new user flow (login, join a room, edit a question, etc.) needs an e2e test.
- **Always run `npm test` before calling a task done. Fix broken tests before moving on.**
- Do not delete a test just to make the suite pass — update it to match the new correct behavior.

## Normal growth pattern for a new feature

1. Add or update the TypeScript type in `src/shared/types.ts` if the data shape changed.
2. Add the API call inside the page or feature component.
3. Add or update the React component or page.
4. Add or copy a unit test (`.test.tsx` right next to the component file).
5. Open the feature in a live browser and check that it looks and works correctly.
6. Check the browser console for errors and the network tab for failed requests.
7. Add or update a Playwright e2e test if the change involves a full user flow.

## Other rules

- Copy an existing page file when you add another page with a similar shape.
- Copy an existing feature panel or test when you add another small feature block.
- Extend an existing file only when the new code still belongs to the same page, feature, or helper.
- Do not use deep relative imports like `../../../shared/...`. Keep files close to where they are used.
- Add runtime packages with `npm install <name>` and dev-only packages with `npm install -D <name>`.
- Start each file with a short comment block (2–4 lines): what this file does, when to edit it, and whether it can be copied as a starting point for a similar file.

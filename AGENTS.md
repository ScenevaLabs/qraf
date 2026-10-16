# For AI agents

**If asked to install qRaf:** follow the *Setup* section of README.md step by step. Put only
the publishable key in config files, never the secret key.

## Project

- `backend/supabase/migrations/`: schema and RLS. Roles are `admin` and `standart` (shown as
  "User" in the app); every row belongs to an organization. Tests: `backend/tests` (PGlite).
- `desktop/`: Electron without a bundler. `main.js` handles drive detection, scanning (folder
  tree, 4 levels) and the speed test; `renderer/` is the UI. To drive the UI against a fake
  Supabase: `desktop/.claude/skills/run-qraf-desktop/`.
- `mobile/`: React Native (Android). Screens in `src/screens/`, shared logic in `src/utils.ts`,
  tests in `__tests__/` (`npm test`).

## Rules

- Nothing may modify user files on a drive; scanning is read-only.
- No real people, companies or drive data in code, tests or screenshots.
- Desktop and mobile behave the same; a rule changed in one is carried over to the other.
- Code comments are partly in Turkish (the project started in Turkish); new comments in
  English are welcome.

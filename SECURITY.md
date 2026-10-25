# Security / Güvenlik

qRaf is self-hosted: each company keeps its drive inventory in its own Supabase project, and
none of it reaches us. A flaw in the app could still affect those installations, so please
**do not open public issues for security problems**. Report them privately through GitHub's
**Security → Report a vulnerability** on this repository. We aim to respond within 7 days.

## Keeping your installation safe

- Put only the **publishable** key in the apps. The secret key gives full access to your
  database; it must never go into a file, an APK or a repository.
- Accounts are invite-only (migration `20261013120000_user_management.sql`). Removing a user
  cuts their access immediately; review users and pending invitations now and then.
- Access requires a session opened with the emailed code and a confirmed email address
  (migration `20261025120000_otp_only_sessions.sql`). Keep **Confirm email** enabled in
  Supabase Auth.
- The desktop app loads its libraries from `desktop/renderer/vendor/` (copied from
  `node_modules` with `npm run vendor`) under a strict Content-Security-Policy. If you
  self-host Supabase on your own domain, add it to `connect-src` and `img-src` in
  `desktop/renderer/index.html`.
- Sign the desktop installers and the Android APK with your own keys before distributing
  them. The Android configuration in this repository uses React Native's public debug key.
- If you add a table, enable RLS and scope it to the organization (`public.current_org_id()`).

---

*Güvenlik açığı bulursan lütfen herkese açık issue açma; bu deponun Security → Report a
vulnerability bölümünden gizli bildir. 7 gün içinde dönüş yapılır.*

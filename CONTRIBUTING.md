# Contributing / Katkı

Thanks for contributing. A few rules:

- **Database:** schema changes go in a new migration file
  (`backend/supabase/migrations/<timestamp>_description.sql`). Never edit an existing
  migration. If you add a table, enable RLS, protect it with `public.is_admin()` and
  `public.current_org_id()`, and add a scenario to `backend/tests/migrations.test.mjs`.
- **No real data:** examples, tests and screenshots use only fictional company, drive and
  project names and `example.com` addresses.
- **Tone:** interface text is short, calm and clear. An error message says what happened and
  how to fix it.
- **Hands off the drives:** qRaf only reads drives (folder listing, sizes) and writes one
  temporary file for the speed test, which it deletes. Nothing may change a user's files.
- Desktop and mobile behave the same; a rule changed in one is carried over to the other.
- Before opening a pull request: `cd backend/tests && npm test` and
  `cd mobile && npm test && npm run lint`.

---

*Katkılar memnuniyetle karşılanır. Şema değişikliği yeni migration dosyasıyla, RLS ve testle;
örnek ve ekran görüntülerinde gerçek veri yok; qRaf kullanıcının dosyalarını asla değiştirmez.
Göndermeden önce backend ve mobil testleri çalıştır.*

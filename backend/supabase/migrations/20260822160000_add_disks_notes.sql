-- Faz 7: Excel'den geçiş — Excel'deki "Durum" sütunu (disk nerede/kimde,
-- arızalı, başka diske kopyalanmış gibi notlar) için şemada bir alan
-- yoktu. Bu bilgi kaybolmasın diye eklendi.
alter table public.disks add column notes text;

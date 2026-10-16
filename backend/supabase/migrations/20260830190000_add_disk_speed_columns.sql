-- Faz 11: disk ilk sisteme tanıtılırken bir kerelik ölçülen okuma/yazma
-- hızı (MB/s). Periyodik taramaya eklenmedi, yalnızca disk kaydı ilk
-- oluşturulduğunda masaüstü uygulaması tarafından yazılır.
alter table public.disks
  add column read_speed_mbps numeric,
  add column write_speed_mbps numeric,
  add column speed_tested_at timestamptz;

// Renderer'ın kullandığı tarayıcı kütüphanelerini node_modules'tan
// renderer/vendor/'a kopyalar. Uygulama bunları CDN'den değil yerelden
// yükler: sürüm package-lock.json'da sabit, internetsiz de açılır ve
// CSP `script-src 'self'` ile dışarıdan betik yüklenemez.
// Kütüphane sürümü değişince: npm install, sonra `npm run vendor`.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const out = join(here, 'renderer', 'vendor');
const files = {
  'supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'qrcode.js': 'node_modules/qrcode-generator/qrcode.js',
};

mkdirSync(out, { recursive: true });
for (const [name, src] of Object.entries(files)) {
  copyFileSync(join(here, src), join(out, name));
  console.log(`${src} → renderer/vendor/${name}`);
}

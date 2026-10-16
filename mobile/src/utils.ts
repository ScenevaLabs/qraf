export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  const tb = 1e12;
  const gb = 1e9;
  const mb = 1e6;
  if (bytes >= tb * 0.1) return `${(bytes / tb).toFixed(1)}TB`;
  if (bytes >= gb * 0.1) return `${(bytes / gb).toFixed(0)}GB`;
  return `${(bytes / mb).toFixed(0)}MB`;
}

// Boş alan yüzdesini gösterir (doluluk değil) — çok boş alan varken
// çubuk dolu görünür, azaldıkça boşalır. Bkz. DESIGN.md → Boş alan
// göstergesi.
export function meterText(freeBytes: number | null, totalBytes: number | null): string {
  if (!totalBytes) return `${'·'.repeat(10)} —`;
  const freePct = Math.round(((freeBytes ?? 0) / totalBytes) * 100);
  const blocks = 10;
  const filled = Math.round((freePct / 100) * blocks);
  return `${'█'.repeat(filled)}${'·'.repeat(blocks - filled)} ${freePct}% FREE`;
}

// Liste satırları için kısa tarih: "12.10.2026 14:05".
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatSpeed(mbps: number | null | undefined): string {
  return mbps ? `${mbps.toFixed(0)} MB/s` : '—';
}

// Arama büyük/küçük harfe VE Türkçe aksanlara duyarsız olsun diye
// ("GUNES"/"güneş"/"GÜNEŞ" hepsi aynı sonucu bulmalı) —
// önce Türkçe kurallarıyla küçük harfe çevrilir (İ/I doğru ayrılsın),
// sonra NFD ile ayrıştırılıp aksan işaretleri (ç,ş,ğ,ü,ö) atılır. Tek
// istisna "ı" (noktasız i) — Unicode'da ayrıştırılabilir bir aksan
// işareti değil, elle 'i'ye çevriliyor. Masaüstündeki normalizeForSearch
// ile aynı mantık, bkz. desktop/renderer/app.js.
export function normalizeForSearch(text: string | null | undefined): string {
  return (text || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .split('')
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return !(code >= 0x0300 && code <= 0x036f); // NFD aksan işaretleri bloğu
    })
    .join('')
    .replace(/ı/g, 'i');
}

// `children`: taramada kaydedilen alt klasörler (masaüstü → main.js
// FOLDER_TREE_DEPTH). Eski taramalarda yok.
export type DiskFolder = { name: string; sizeBytes: number; children?: DiskFolder[] };

export type FolderMatch = { path: string[]; folder: DiskFolder; episode: boolean };

export type DiskRow = {
  id: string;
  name: string;
  qr_code_value: string | null;
  top_level_folders: DiskFolder[] | null;
  total_bytes: number | null;
  free_bytes: number | null;
  last_scanned_at: string | null;
  read_speed_mbps: number | null;
  write_speed_mbps: number | null;
  speed_tested_at: string | null;
  // 'inactive': kayıp/bozuk/başka yere gönderilmiş — listede ayrı,
  // katlanmış bölümde durur (masaüstündeki gibi). `notes` nedenini taşır.
  status?: 'active' | 'inactive' | null;
  notes?: string | null;
};

export function isInactive(disk: DiskRow): boolean {
  return disk.status === 'inactive';
}

// Eski taramalarda kaydedilmiş sistem klasörleri (.Spotlight-V100,
// .fseventsd, $RECYCLE.BIN ...) gösterilmez. Arama ve klasör ağacı
// mantığı masaüstündekiyle aynı — bkz. desktop/renderer/app.js
// (isHiddenFolder … matchingFolders).
function isHiddenFolder(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return lower.startsWith('.') || lower === '$recycle.bin' || lower === 'system volume information';
}

export function visibleFolders(folders: DiskFolder[] | null | undefined): DiskFolder[] {
  return (folders ?? []).filter((f) => !isHiddenFolder(f.name));
}

function flattenFolderTree(folders: DiskFolder[] | null | undefined, parentPath: string[] = []) {
  const out: { path: string[]; folder: DiskFolder }[] = [];
  for (const folder of visibleFolders(folders)) {
    const folderPath = [...parentPath, folder.name];
    out.push({ path: folderPath, folder });
    out.push(...flattenFolderTree(folder.children, folderPath));
  }
  return out;
}

function searchTokens(q: string): string[] {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
}

function pathMatchesTokens(folderPath: string[], tokens: string[]): boolean {
  const haystack = normalizeForSearch(folderPath.join(' / '));
  const numbers = new Set((haystack.match(/\d+/g) ?? []).map((n) => parseInt(n, 10)));
  return tokens.every((token) => (/^\d+$/.test(token) ? numbers.has(parseInt(token, 10)) : haystack.includes(token)));
}

function isEpisodeMatch(folderName: string, tokens: string[]): boolean {
  const name = normalizeForSearch(folderName);
  return tokens
    .filter((t) => /^\d+$/.test(t))
    .some((t) => {
      const n = String(parseInt(t, 10));
      return (
        new RegExp(`(bolum|bol|ep|episode)[\\s._-]*0*${n}(?!\\d)`).test(name) ||
        new RegExp(`(?<!\\d)0*${n}[\\s._-]*(bolum|bol)`).test(name)
      );
    });
}

// Diskin klasör ağacında ("NIGHT SHIFT › 2026.08.25 › BOLUM_13")
// sorguyla eşleşen klasörleri bulur; eşleşen bir klasörün altındakiler
// ayrıca listelenmez, sorgudaki sayı bölüm numarası olarak geçiyorsa
// yalnız o klasörler döner.
export function matchingFolders(disk: DiskRow, q: string): FolderMatch[] {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return [];
  const matches: FolderMatch[] = [];
  const matchedKeys = new Set<string>();
  for (const entry of flattenFolderTree(disk.top_level_folders)) {
    const coveredByParent = entry.path.some((_, i) => i > 0 && matchedKeys.has(entry.path.slice(0, i).join('\u0000')));
    if (coveredByParent) continue;
    if (pathMatchesTokens(entry.path, tokens)) {
      matchedKeys.add(entry.path.join('\u0000'));
      matches.push({ ...entry, episode: isEpisodeMatch(entry.folder.name, tokens) });
    }
  }
  const episodes = matches.filter((m) => m.episode);
  return episodes.length > 0 ? episodes : matches;
}

// Disk adları "1. Disk".."40. Disk" gibi sayısal ama string sıralamada
// "1, 10, 11, 2, …" şeklinde yanlış sıralanıyor (Supabase'in `.order('name')`'ı
// düz string sıralaması yapıyor). Yalnız adın BAŞINDAKİ sayıya bakılır —
// içteki sayı ("ARC MASTER2") sıra numarası değil, eskiden "2. Disk"in
// hemen ardına düşüyordu (13 Ekim 2026). Numarasız diskler listenin
// sonunda, kendi aralarında doğal sıralı. Masaüstündeki naturalDiskCompare
// ile aynı mantık, bkz. desktop/renderer/app.js.
export function naturalDiskCompare(a: DiskRow, b: DiskRow): number {
  const numA = parseInt((a.name || '').match(/^\s*(\d+)/)?.[1] ?? '', 10);
  const numB = parseInt((b.name || '').match(/^\s*(\d+)/)?.[1] ?? '', 10);
  const hasA = !Number.isNaN(numA);
  const hasB = !Number.isNaN(numB);
  if (hasA && hasB && numA !== numB) return numA - numB;
  if (hasA !== hasB) return hasA ? -1 : 1;
  return (a.name || '').localeCompare(b.name || '', 'tr', { numeric: true });
}

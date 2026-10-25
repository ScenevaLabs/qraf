const supabaseClient = window.supabase.createClient(
  window.QRAF_CONFIG.SUPABASE_URL,
  window.QRAF_CONFIG.SUPABASE_PUBLISHABLE_KEY
);

const viewLogin = document.getElementById('view-login');
const viewDashboard = document.getElementById('view-dashboard');

const loginStepEmail = document.getElementById('login-step-email');
const loginStepCode = document.getElementById('login-step-code');
const emailInput = document.getElementById('email-input');
const codeInput = document.getElementById('code-input');
const codeSentEmail = document.getElementById('code-sent-email');
const sendCodeBtn = document.getElementById('send-code-btn');
const verifyCodeBtn = document.getElementById('verify-code-btn');
const backToEmailBtn = document.getElementById('back-to-email-btn');
const loginStatus = document.getElementById('login-status');

const accountEmailEl = document.getElementById('account-email');
const accountRoleEl = document.getElementById('account-role');
const signOutBtn = document.getElementById('sign-out-btn');

const diskCountEl = document.getElementById('disk-count');
const disksGridEl = document.getElementById('disks-grid');
const disksEmptyEl = document.getElementById('disks-empty');
const diskCardTemplate = document.getElementById('disk-card-template');

const matchModal = document.getElementById('match-modal');
const matchModalList = document.getElementById('match-modal-list');
const matchModalName = document.getElementById('match-modal-name');
const matchModalQrInput = document.getElementById('match-modal-qr-input');
const matchModalCreateBtn = document.getElementById('match-modal-create-btn');
const matchModalCancelBtn = document.getElementById('match-modal-cancel-btn');
const matchModalStatus = document.getElementById('match-modal-status');

const tabConnectedBtn = document.getElementById('tab-connected-btn');
const tabAllBtn = document.getElementById('tab-all-btn');
const tabQrBtn = document.getElementById('tab-qr-btn');
const tabUsersBtn = document.getElementById('tab-users-btn');
const panelUsers = document.getElementById('panel-users');
const panelConnected = document.getElementById('panel-connected');
const panelAll = document.getElementById('panel-all');
const panelQr = document.getElementById('panel-qr');
const allDisksSearch = document.getElementById('all-disks-search');
const allDisksSearchClearBtn = document.getElementById('all-disks-search-clear-btn');
const allDisksList = document.getElementById('all-disks-list');
const allDisksEmpty = document.getElementById('all-disks-empty');
const allDiskRowTemplate = document.getElementById('all-disk-row-template');
const inactiveDisksToggleBtn = document.getElementById('inactive-disks-toggle-btn');
const inactiveDisksList = document.getElementById('inactive-disks-list');

const diskDetailModal = document.getElementById('disk-detail-modal');
const diskDetailName = document.getElementById('disk-detail-name');
const diskDetailNotes = document.getElementById('disk-detail-notes');
const diskDetailMeter = document.getElementById('disk-detail-meter');
const diskDetailFree = document.getElementById('disk-detail-free');
const diskDetailScan = document.getElementById('disk-detail-scan');
const diskDetailSpeed = document.getElementById('disk-detail-speed');
const diskDetailFolders = document.getElementById('disk-detail-folders');
const diskDetailStatusBtn = document.getElementById('disk-detail-status-btn');
const diskDetailCloseBtn = document.getElementById('disk-detail-close-btn');

const qrExportBtn = document.getElementById('qr-export-btn');
const qrExportStatus = document.getElementById('qr-export-status');
const qrEmpty = document.getElementById('qr-empty');
const qrGrid = document.getElementById('qr-grid');
const qrTagTemplate = document.getElementById('qr-tag-template');

const brandPreviewTag = document.getElementById('brand-preview-tag');
const brandLogoInput = document.getElementById('brand-logo-input');
const brandUploadStatus = document.getElementById('brand-upload-status');
const brandApproveBtn = document.getElementById('brand-approve-btn');
const brandApproveStatus = document.getElementById('brand-approve-status');

let pendingEmail = '';
let matchModalDisk = null;
let allDisksCache = [];
let qrDisksCache = [];
let inactiveDisksExpanded = false;
let currentOrg = null;

const SYNC_INTERVAL_MS = 60000;
const DISK_MAP_KEY = 'qraf.diskMap';
const PENDING_SYNC_KEY = 'qraf.pendingSync';

function showLogin() {
  viewLogin.hidden = false;
  viewDashboard.hidden = true;
}

// --- Rol (Faz 16) ---
// 'admin' | 'standart'. Yetkiler asıl olarak Supabase RLS'te; burada
// yalnız kullanıcının yapamayacağı işlerin düğmeleri gizleniyor.
let currentRole = null;

function isAdmin() {
  return currentRole === 'admin';
}

function applyRole() {
  const admin = isAdmin();
  tabQrBtn.hidden = !admin;
  tabUsersBtn.hidden = !admin;
  diskDetailStatusBtn.hidden = !admin;
  if (!admin && (!panelQr.hidden || !panelUsers.hidden)) switchTab('connected');
}

async function loadRole() {
  const { data: userData } = await supabaseClient.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return null;
  const { data, error } = await supabaseClient.from('profiles').select('role,email').eq('id', userId).maybeSingle();
  if (error) return undefined; // ağ hatası: bilinmiyor, oturumu kapatma
  currentRole = data?.role ?? null;
  applyRole();
  accountEmailEl.textContent = data?.email || userData.user.email || '';
  accountRoleEl.textContent = currentRole === 'admin' ? 'ADMIN' : currentRole ? 'USER' : '';
  return data;
}

function resetLoginForm() {
  loginStepCode.hidden = true;
  loginStepEmail.hidden = false;
  codeInput.value = '';
  pendingEmail = '';
}

signOutBtn.addEventListener('click', async () => {
  signOutBtn.disabled = true;
  // Açık pencereler ve admin sekmeleri bir sonraki girişe taşınmasın.
  diskDetailModal.hidden = true;
  matchModal.hidden = true;
  currentRole = null;
  applyRole();
  switchTab('connected');
  const { error } = await supabaseClient.auth.signOut();
  signOutBtn.disabled = false;
  if (error) {
    // Ağ yoksa sunucu oturumu kapanmamış olabilir; yerelde yine de kapat.
    await supabaseClient.auth.signOut({ scope: 'local' });
  }
  accountEmailEl.textContent = '';
  accountRoleEl.textContent = '';
  resetLoginForm();
  showLogin();
  setLoginStatus('Signed out.', false);
});

let dashboardLoading = null;

function showDashboard() {
  // onAuthStateChange ve getSession aynı anda çağırabiliyor.
  if (!dashboardLoading) dashboardLoading = loadDashboard().finally(() => (dashboardLoading = null));
  return dashboardLoading;
}

async function loadDashboard() {
  const profile = await loadRole();
  if (profile === null) {
    // Auth hesabı var ama profili yok: kullanıcı çıkarılmış.
    await supabaseClient.auth.signOut();
    showLogin();
    setLoginStatus('This account has no access to qRaf. Ask your admin for an invitation.');
    return;
  }
  viewLogin.hidden = true;
  viewDashboard.hidden = false;
  loadOrganization();
  refreshDisks();
}

function setLoginStatus(message, isError = true) {
  loginStatus.textContent = message || '';
  loginStatus.style.color = isError ? 'var(--stamp-red)' : 'var(--ink-soft)';
}

sendCodeBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  if (!email) {
    setLoginStatus('Enter an email address.');
    return;
  }
  sendCodeBtn.disabled = true;
  setLoginStatus('Sending…', false);
  // shouldCreateUser: davetli yeni çalışan ilk girişte hesap açabilsin.
  // Davetsiz e-postayı veritabanı reddediyor (handle_new_user).
  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  sendCodeBtn.disabled = false;
  if (error) {
    setLoginStatus(/database error/i.test(error.message) ? 'There is no invitation for this email. Ask your admin for one.' : error.message);
    return;
  }
  pendingEmail = email;
  codeSentEmail.textContent = email;
  loginStepEmail.hidden = true;
  loginStepCode.hidden = false;
  setLoginStatus('Code sent. Check your inbox.', false);
  codeInput.focus();
});

verifyCodeBtn.addEventListener('click', async () => {
  const code = codeInput.value.trim();
  if (!code) {
    setLoginStatus('Enter the code.');
    return;
  }
  verifyCodeBtn.disabled = true;
  setLoginStatus('Verifying…', false);
  const { error } = await supabaseClient.auth.verifyOtp({
    email: pendingEmail,
    token: code,
    type: 'email',
  });
  verifyCodeBtn.disabled = false;
  if (error) {
    setLoginStatus(error.message);
    return;
  }
  showDashboard();
});

backToEmailBtn.addEventListener('click', () => {
  resetLoginForm();
  setLoginStatus('');
});

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const tb = 1e12;
  const gb = 1e9;
  const mb = 1e6;
  if (bytes >= tb * 0.1) return `${(bytes / tb).toFixed(1)}TB`;
  if (bytes >= gb * 0.1) return `${(bytes / gb).toFixed(0)}GB`;
  return `${(bytes / mb).toFixed(0)}MB`;
}

function meterText(freeBytes, totalBytes) {
  if (!totalBytes) return '·'.repeat(10) + ' —';
  const freePct = Math.round((freeBytes / totalBytes) * 100);
  const blocks = 10;
  const filled = Math.round((freePct / 100) * blocks);
  return '█'.repeat(filled) + '·'.repeat(blocks - filled) + ` ${freePct}% FREE`;
}

function diskDisplayName(disk) {
  return (disk.name || disk.mountpoint).replace(/[\\/]+$/, '') || disk.mountpoint;
}

// --- Yerel eşleştirme (stableId -> Supabase disks.id) ve çevrimdışı kuyruk ---
// QR henüz yok (Faz 5) — admin diskleri elle bir Supabase disks kaydına
// eşleştirir. Eşleştirme bu bilgisayara özel, localStorage'da tutulur.

function loadDiskMap() {
  try {
    return JSON.parse(localStorage.getItem(DISK_MAP_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDiskMap(map) {
  localStorage.setItem(DISK_MAP_KEY, JSON.stringify(map));
}

function loadPendingQueue() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_SYNC_KEY)) || {};
  } catch {
    return {};
  }
}

function savePendingQueue(queue) {
  localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(queue));
}

function scanToPayload(scan) {
  return {
    top_level_folders: scan.topLevelFolders,
    total_bytes: scan.totalBytes,
    free_bytes: scan.freeBytes,
    last_scanned_at: scan.scannedAt,
  };
}

// Supabase'e yazmayı dener; internet yoksa (ya da yazma başarısızsa) en
// son durumu yerel kuyruğa alır, bağlantı gelince flushPendingSync bunu
// tekrar dener. Kuyruk yalnızca EN SON durumu tutar (geçmiş biriktirmez).
async function syncScanToSupabase(diskRecordId, scan) {
  if (!isAdmin()) return true; // yalnız admin yazabilir (RLS); kuyruğa da alma
  const payload = scanToPayload(scan);
  try {
    const { error } = await supabaseClient.from('disks').update(payload).eq('id', diskRecordId);
    if (error) throw error;
    const queue = loadPendingQueue();
    if (queue[diskRecordId]) {
      delete queue[diskRecordId];
      savePendingQueue(queue);
    }
    return true;
  } catch {
    const queue = loadPendingQueue();
    queue[diskRecordId] = payload;
    savePendingQueue(queue);
    return false;
  }
}

async function flushPendingSync() {
  const queue = loadPendingQueue();
  const ids = Object.keys(queue);
  for (const id of ids) {
    try {
      const { error } = await supabaseClient.from('disks').update(queue[id]).eq('id', id);
      if (!error) delete queue[id];
    } catch {
      // hâlâ çevrimdışı, sırada kalsın
    }
  }
  savePendingQueue(queue);
}

// --- Eşleştirme modali ---

function generateQrValue() {
  return `qraf:${crypto.randomUUID()}`;
}

async function openMatchModal(disk) {
  matchModalDisk = disk;
  matchModalName.value = '';
  matchModalQrInput.value = '';
  matchModalStatus.textContent = '';
  matchModal.hidden = false;
  matchModalQrInput.focus();
  matchModalList.textContent = 'Loading…';

  const { data, error } = await supabaseClient.from('disks').select('id,name').order('name');
  matchModalList.innerHTML = '';
  if (error) {
    matchModalList.textContent = `Could not load records: ${error.message}`;
    return;
  }
  if (!data || data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'modal-list-empty';
    empty.textContent = 'No drives registered yet.';
    matchModalList.appendChild(empty);
    return;
  }
  for (const row of data) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-list-item';
    btn.textContent = row.name;
    btn.addEventListener('click', () => confirmMatch(row.id, row.name));
    matchModalList.appendChild(btn);
  }
}

function closeMatchModal() {
  matchModal.hidden = true;
  matchModalDisk = null;
}

async function confirmMatch(diskRecordId, name) {
  const map = loadDiskMap();
  map[matchModalDisk.stableId] = { id: diskRecordId, name };
  saveDiskMap(map);
  closeMatchModal();
  refreshDisks();
}

matchModalCreateBtn.addEventListener('click', async () => {
  const name = matchModalName.value.trim();
  if (!name) {
    matchModalStatus.textContent = 'Enter a drive name.';
    return;
  }
  if (!currentOrg) {
    matchModalStatus.textContent = 'Organization info has not loaded yet. Try again in a few seconds.';
    return;
  }
  matchModalCreateBtn.disabled = true;
  matchModalStatus.textContent = 'Creating…';
  const { data, error } = await supabaseClient
    .from('disks')
    .insert({ name, qr_code_value: generateQrValue(), org_id: currentOrg.id })
    .select('id,name')
    .single();
  if (error) {
    matchModalCreateBtn.disabled = false;
    matchModalStatus.textContent = error.message;
    return;
  }

  // Hız testi burada ayrıca yapılmıyor: confirmMatch → refreshDisks,
  // bu oturumda hızı ölçülmemiş eşleşmiş diski zaten ölçüyor.
  matchModalCreateBtn.disabled = false;
  await confirmMatch(data.id, data.name);
});

matchModalCancelBtn.addEventListener('click', closeMatchModal);

// Fiziksel bir USB QR/barkod okuyucu, taranan metni klavye girişi gibi
// "yazar" — bu yüzden burada kamera/görüntü işleme yok, sadece odaklı
// bir metin alanına Enter ile gelen değeri disks.qr_code_value ile
// eşleştiriyoruz.
matchModalQrInput.addEventListener('keydown', async (event) => {
  if (event.key !== 'Enter') return;
  const value = matchModalQrInput.value.trim();
  if (!value) return;
  matchModalStatus.textContent = 'Searching…';
  const { data, error } = await supabaseClient
    .from('disks')
    .select('id,name')
    .eq('qr_code_value', value)
    .maybeSingle();
  if (error) {
    matchModalStatus.textContent = error.message;
    return;
  }
  if (!data) {
    matchModalStatus.textContent = 'No drive record found for this QR code.';
    return;
  }
  await confirmMatch(data.id, data.name);
});

// --- Tüm Diskler (Faz 4b) ---
// Bağlı diskler paneli yalnızca O AN bu bilgisayara takılı diskleri
// gösterir. Bu panel, fiziksel olarak takılı olsun olmasın, Supabase'deki
// TÜM disk kayıtlarını (her birinin son bilinen durumuyla) arama kutulu
// tek bir listede gösterir — 40+ disklik envanteri tek ekrandan görmek
// ve isimle bulmak için.

// Arama büyük/küçük harfe VE Türkçe aksanlara duyarsız olsun diye
// ("GUNES"/"güneş"/"GÜNEŞ" hepsi aynı sonucu bulmalı) —
// önce Türkçe kurallarıyla küçük harfe çevrilir (İ/I doğru ayrılsın),
// sonra NFD ile ayrıştırılıp aksan işaretleri (ç,ş,ğ,ü,ö) atılır. Tek
// istisna "ı" (noktasız i) — Unicode'da ayrıştırılabilir bir aksan
// işareti değil, elle 'i'ye çevriliyor.
function normalizeForSearch(text) {
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

// Eski taramalarda kaydedilmiş sistem klasörleri (.Spotlight-V100,
// .fseventsd, $RECYCLE.BIN ...) disk yeniden taranana kadar listede
// görünmesin — main.js'teki isHiddenFolder ile aynı kural.
function isHiddenFolder(name) {
  const lower = (name || '').toLowerCase();
  return lower.startsWith('.') || lower === '$recycle.bin' || lower === 'system volume information';
}

function visibleFolders(folders) {
  return (folders || []).filter((f) => !isHiddenFolder(f.name));
}

// top_level_folders artık bir ağaç: her klasörün altında taramada
// kaydedilen alt klasörler `children` olarak duruyor (bkz. main.js →
// FOLDER_TREE_DEPTH). Arama için her klasör, diskin kökünden itibaren
// tam yoluyla ("LATE SHIFT / 2026.08.25 / BOLUM_13") düzleştirilir.
function flattenFolderTree(folders, parentPath = []) {
  const out = [];
  for (const folder of visibleFolders(folders)) {
    const folderPath = [...parentPath, folder.name];
    out.push({ path: folderPath, folder });
    out.push(...flattenFolderTree(folder.children, folderPath));
  }
  return out;
}

function folderPathKey(folderPath) {
  return folderPath.join('\u0000');
}

// Sorgu boşluklardan kelimelere bölünür ve HER kelime klasörün tam
// yolunda aranır — "late shift 13" sorgusundaki "late" kökteki
// proje klasöründe, "13" ise alt klasördeki "BOLUM_13"te bulunabilir.
// Yalnız rakamdan oluşan kelimeler sayı olarak eşleşir: "13" "BOLUM_13"ü
// bulur ama "130"u bulmaz, "4" "BOLUM_04"ü de bulur. "2026.08" gibi
// içinde nokta/tire olan kelimeler ise olduğu gibi (tarih olarak) aranır.
function searchTokens(q) {
  return q
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
}

function pathMatchesTokens(folderPath, tokens) {
  const haystack = normalizeForSearch(folderPath.join(' / '));
  const numbers = new Set((haystack.match(/\d+/g) || []).map((n) => parseInt(n, 10)));
  return tokens.every((token) => (/^\d+$/.test(token) ? numbers.has(parseInt(token, 10)) : haystack.includes(token)));
}

// "BOLUM_13", "13.BOLUM", "Bölüm 13", "EP13" gibi bir klasör adı sorgudaki
// sayıyı bölüm numarası olarak taşıyorsa, aynı sayının tarih içinde
// geçtiği klasörlerden ("2026.08.13") önce gösterilir.
function isEpisodeMatch(folderName, tokens) {
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

// Diskin klasör ağacında sorguyla eşleşen klasörleri döndürür. Bir klasör
// eşleştiyse altındaki klasörler ayrıca listelenmez (hepsi zaten o
// klasörün içinde) — "late shift" araması 200 alt klasör değil,
// tek bir "LATE SHIFT" sonucu verir.
function matchingFolders(disk, q) {
  const tokens = searchTokens(q);
  if (tokens.length === 0) return [];
  const matches = [];
  const matchedKeys = new Set();
  for (const entry of flattenFolderTree(disk.top_level_folders)) {
    const coveredByParent = entry.path.some((_, i) => i > 0 && matchedKeys.has(folderPathKey(entry.path.slice(0, i))));
    if (coveredByParent) continue;
    if (pathMatchesTokens(entry.path, tokens)) {
      matchedKeys.add(folderPathKey(entry.path));
      matches.push({ ...entry, episode: isEpisodeMatch(entry.folder.name, tokens) });
    }
  }
  // Sorgudaki sayı bir klasörde bölüm numarası olarak geçiyorsa yalnız
  // onlar gösterilir; aynı sayının tarihlerde ya da dosya adlarındaki
  // saat damgalarında ("…-36-13-utc") geçtiği klasörler gürültü.
  const episodes = matches.filter((m) => m.episode);
  return episodes.length > 0 ? episodes : matches;
}

function formatFolderPath(folderPath) {
  return folderPath.join(' › ');
}

// Disk adları "1. Disk".."40. Disk" gibi sayısal ama string sıralamada
// "1, 10, 11, 2, …" şeklinde yanlış sıralanıyor — adın başındaki
// sayıyı ayıklayıp sayısal karşılaştırma yapıyoruz.
function naturalDiskCompare(a, b) {
  // Yalnız adın başındaki sayı sıra numarasıdır ("ARC MASTER2" değil);
  // numarasız diskler sona gider. Mobildeki naturalDiskCompare ile aynı.
  const numA = parseInt((a.name || '').match(/^\s*(\d+)/)?.[1], 10);
  const numB = parseInt((b.name || '').match(/^\s*(\d+)/)?.[1], 10);
  const hasA = !Number.isNaN(numA);
  const hasB = !Number.isNaN(numB);
  if (hasA && hasB && numA !== numB) return numA - numB;
  if (hasA !== hasB) return hasA ? -1 : 1;
  return (a.name || '').localeCompare(b.name || '', 'tr', { numeric: true });
}

function buildAllDiskRow(disk, matchedFolders, nameMatch, q) {
  const node = allDiskRowTemplate.content.cloneNode(true);
  const row = node.querySelector('.all-disk-row');
  row.querySelector('.all-disk-row-name').textContent = disk.name;
  row.querySelector('.all-disk-row-meter').textContent = meterText(disk.free_bytes, disk.total_bytes);
  row.querySelector('.all-disk-row-free').textContent = `${formatBytes(disk.free_bytes)} free / ${formatBytes(disk.total_bytes)}`;
  row.querySelector('.all-disk-row-scan').textContent = disk.last_scanned_at
    ? `Last scan: ${new Date(disk.last_scanned_at).toLocaleString('en-GB')}`
    : 'Not scanned yet';
  const matchEl = row.querySelector('.all-disk-row-match');
  if (q && !nameMatch && matchedFolders.length > 0) {
    matchEl.hidden = false;
    const shown = matchedFolders.slice(0, 4).map((m) => formatFolderPath(m.path));
    const more = matchedFolders.length > 4 ? ` (+${matchedFolders.length - 4} more)` : '';
    matchEl.textContent = `Found inside: ${shown.join(' · ')}${more}`;
  } else if (disk.status === 'inactive' && disk.notes) {
    matchEl.hidden = false;
    matchEl.textContent = disk.notes;
  } else {
    matchEl.hidden = true;
  }
  const openDetail = () => openDiskDetailModal(disk, matchedFolders);
  row.addEventListener('click', openDetail);
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDetail();
    }
  });
  return node;
}

function filterDisks(disks, q) {
  return disks
    .map((d) => {
      const nameMatch = !q || normalizeForSearch(d.name).includes(q);
      const matchedFolders = matchingFolders(d, q);
      return { disk: d, nameMatch, matchedFolders };
    })
    .filter((row) => !q || row.nameMatch || row.matchedFolders.length > 0);
}

function renderAllDisksList(filterText) {
  const q = normalizeForSearch((filterText || '').trim());
  const activeDisks = allDisksCache.filter((d) => d.status !== 'inactive');
  const inactiveDisks = allDisksCache.filter((d) => d.status === 'inactive');
  const rows = filterDisks(activeDisks, q);

  allDisksList.innerHTML = '';
  if (rows.length === 0) {
    allDisksEmpty.hidden = false;
    allDisksEmpty.textContent = activeDisks.length === 0 ? 'No drives registered yet.' : 'No matching drive, project or folder.';
  } else {
    allDisksEmpty.hidden = true;
    for (const { disk, nameMatch, matchedFolders } of rows) {
      allDisksList.appendChild(buildAllDiskRow(disk, matchedFolders, nameMatch, q));
    }
  }

  renderInactiveDisksList(inactiveDisks, q);
}

// Kullanımda olmayan (kayıp/bozuk/başka yere gönderilmiş) diskler ana
// listeyi kalabalıklaştırmasın diye varsayılan olarak katlanmış bir
// bölümde tutuluyor — bkz. disks.status.
function renderInactiveDisksList(inactiveDisks, q) {
  if (inactiveDisks.length === 0) {
    inactiveDisksToggleBtn.hidden = true;
    inactiveDisksList.hidden = true;
    return;
  }
  inactiveDisksToggleBtn.hidden = false;
  inactiveDisksToggleBtn.textContent = inactiveDisksExpanded
    ? `HIDE RETIRED DRIVES (${inactiveDisks.length})`
    : `SHOW RETIRED DRIVES (${inactiveDisks.length})`;
  inactiveDisksList.hidden = !inactiveDisksExpanded;
  if (!inactiveDisksExpanded) return;

  const rows = filterDisks(inactiveDisks, q);
  inactiveDisksList.innerHTML = '';
  for (const { disk, nameMatch, matchedFolders } of rows) {
    inactiveDisksList.appendChild(buildAllDiskRow(disk, matchedFolders, nameMatch, q));
  }
}

inactiveDisksToggleBtn.addEventListener('click', () => {
  inactiveDisksExpanded = !inactiveDisksExpanded;
  renderAllDisksList(allDisksSearch.value);
});

async function refreshAllDisks() {
  allDisksList.innerHTML = '';
  allDisksEmpty.hidden = false;
  allDisksEmpty.textContent = 'Loading…';
  const { data, error } = await supabaseClient
    .from('disks')
    .select(
      'id,name,notes,status,total_bytes,free_bytes,last_scanned_at,top_level_folders,read_speed_mbps,write_speed_mbps,speed_tested_at'
    )
    .order('name');
  if (error) {
    allDisksEmpty.textContent = `Could not load: ${error.message}`;
    allDisksCache = [];
    return;
  }
  allDisksCache = (data || []).sort(naturalDiskCompare);
  renderAllDisksList(allDisksSearch.value);
}

allDisksSearch.addEventListener('input', () => {
  allDisksSearchClearBtn.hidden = allDisksSearch.value.length === 0;
  renderAllDisksList(allDisksSearch.value);
});
allDisksSearchClearBtn.addEventListener('click', () => {
  allDisksSearch.value = '';
  allDisksSearchClearBtn.hidden = true;
  allDisksSearch.focus();
  renderAllDisksList('');
});

// --- Disk detay modalı ---
// "Tüm Diskler" satırına tıklayınca o diskin üst düzey klasörlerini
// (Excel'den aktarılan "proje" listesi) gösterir; bir arama sonucundan
// açılmışsa eşleşen klasör(ler) kırmızı çerçeveyle vurgulanır.

let diskDetailCurrent = null;

function openDiskDetailModal(disk, matchedFolders = []) {
  diskDetailCurrent = disk;
  diskDetailName.textContent = disk.name;
  if (disk.notes) {
    diskDetailNotes.hidden = false;
    diskDetailNotes.textContent = disk.notes;
  } else {
    diskDetailNotes.hidden = true;
  }
  diskDetailMeter.textContent = meterText(disk.free_bytes, disk.total_bytes);
  diskDetailFree.textContent = `${formatBytes(disk.free_bytes)} free / ${formatBytes(disk.total_bytes)} total`;
  diskDetailScan.textContent = disk.last_scanned_at
    ? `Last scan: ${new Date(disk.last_scanned_at).toLocaleString('en-GB')}`
    : 'Not scanned yet';
  if (disk.read_speed_mbps || disk.write_speed_mbps) {
    diskDetailSpeed.hidden = false;
    const testedAt = disk.speed_tested_at
      ? ` (${new Date(disk.speed_tested_at).toLocaleString('en-GB')})`
      : '';
    diskDetailSpeed.textContent = `Speed: ${speedText(disk.read_speed_mbps, disk.write_speed_mbps)}${testedAt}`;
  } else {
    diskDetailSpeed.hidden = true;
  }

  const folders = visibleFolders(disk.top_level_folders);
  diskDetailFolders.innerHTML = '';
  if (folders.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'disk-detail-folder-empty';
    empty.textContent = 'No top-level folders recorded for this drive.';
    diskDetailFolders.appendChild(empty);
  } else {
    const matchedKeys = new Set(matchedFolders.map((m) => folderPathKey(m.path)));
    // Eşleşen klasörlerin üst klasörleri açık gelsin ki sonuç görünsün.
    const expandedKeys = new Set();
    for (const m of matchedFolders) {
      for (let i = 1; i < m.path.length; i++) expandedKeys.add(folderPathKey(m.path.slice(0, i)));
    }
    renderFolderTree(diskDetailFolders, folders, [], matchedKeys, expandedKeys);
  }

  diskDetailStatusBtn.textContent = disk.status === 'inactive' ? 'MARK AS ACTIVE' : 'MARK AS RETIRED';
  diskDetailStatusBtn.disabled = false;

  diskDetailModal.hidden = false;
}

// Klasör ağacı: alt klasörü olan satırlar tıklanınca açılıp kapanır.
// Kök seviyesi boyuta göre (en büyük üstte), alt seviyeler ada göre
// sıralanır — alt seviyede çoğunlukla tarih/bölüm klasörleri var, bunlar
// adla sıralanınca kronolojik okunuyor.
function renderFolderTree(container, folders, parentPath, matchedKeys, expandedKeys) {
  const sorted =
    parentPath.length === 0
      ? [...folders].sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
      : [...folders].sort((a, b) => a.name.localeCompare(b.name, 'tr', { numeric: true }));
  for (const folder of sorted) {
    const folderPath = [...parentPath, folder.name];
    const key = folderPathKey(folderPath);
    const children = visibleFolders(folder.children);

    const row = document.createElement('div');
    row.className = 'disk-detail-folder-row';
    row.style.paddingLeft = `${10 + parentPath.length * 18}px`;
    if (matchedKeys.has(key)) row.classList.add('is-matched');
    const name = document.createElement('div');
    name.className = 'disk-detail-folder-name';
    const toggle = document.createElement('span');
    toggle.className = 'disk-detail-folder-toggle';
    name.appendChild(toggle);
    name.appendChild(document.createTextNode(folder.name));
    const size = document.createElement('div');
    size.className = 'disk-detail-folder-size';
    size.textContent = formatBytes(folder.sizeBytes);
    row.appendChild(name);
    row.appendChild(size);
    container.appendChild(row);

    if (children.length === 0) continue;
    const childBox = document.createElement('div');
    childBox.className = 'disk-detail-folder-children';
    container.appendChild(childBox);
    let rendered = false;
    const setExpanded = (expanded) => {
      toggle.textContent = expanded ? '▾ ' : '▸ ';
      childBox.hidden = !expanded;
      if (expanded && !rendered) {
        renderFolderTree(childBox, children, folderPath, matchedKeys, expandedKeys);
        rendered = true;
      }
    };
    row.classList.add('is-expandable');
    row.addEventListener('click', () => setExpanded(childBox.hidden));
    setExpanded(expandedKeys.has(key));
  }
}

function closeDiskDetailModal() {
  diskDetailModal.hidden = true;
  diskDetailCurrent = null;
}

diskDetailStatusBtn.addEventListener('click', async () => {
  if (!diskDetailCurrent) return;
  const nextStatus = diskDetailCurrent.status === 'inactive' ? 'active' : 'inactive';
  diskDetailStatusBtn.disabled = true;
  // RLS'te yalnız admin güncelleyebilir; yetkisiz güncelleme hata vermeden
  // 0 satır döndürür — dönen satıra bakılmazsa değişmiş gibi görünüyordu.
  const { data, error } = await supabaseClient
    .from('disks')
    .update({ status: nextStatus })
    .eq('id', diskDetailCurrent.id)
    .select('id');
  if (error || !data || data.length === 0) {
    diskDetailStatusBtn.disabled = false;
    diskDetailStatusBtn.textContent = error ? `Error: ${error.message}` : 'Not saved: admin permission required';
    return;
  }
  diskDetailCurrent.status = nextStatus;
  const idx = allDisksCache.findIndex((d) => d.id === diskDetailCurrent.id);
  if (idx !== -1) allDisksCache[idx].status = nextStatus;
  closeDiskDetailModal();
  renderAllDisksList(allDisksSearch.value);
});

diskDetailCloseBtn.addEventListener('click', closeDiskDetailModal);
diskDetailModal.addEventListener('click', (event) => {
  if (event.target === diskDetailModal) closeDiskDetailModal();
});

function switchTab(tab) {
  tabConnectedBtn.classList.toggle('tab-btn-active', tab === 'connected');
  tabAllBtn.classList.toggle('tab-btn-active', tab === 'all');
  tabQrBtn.classList.toggle('tab-btn-active', tab === 'qr');
  tabUsersBtn.classList.toggle('tab-btn-active', tab === 'users');
  panelConnected.hidden = tab !== 'connected';
  panelAll.hidden = tab !== 'all';
  panelQr.hidden = tab !== 'qr';
  panelUsers.hidden = tab !== 'users';
}

tabConnectedBtn.addEventListener('click', () => switchTab('connected'));

tabAllBtn.addEventListener('click', () => {
  switchTab('all');
  refreshAllDisks();
});

tabQrBtn.addEventListener('click', () => {
  switchTab('qr');
  loadOrganization();
  refreshQrTab();
});

tabUsersBtn.addEventListener('click', () => {
  switchTab('users');
  refreshUsersTab();
});

// --- Kullanıcı yönetimi (Faz 16) ---
// Davet: invitations'a satır; kişi ilk girişte (OTP) hesabını açar,
// rolü davetten alır. Çıkarma: admin_remove_user() auth hesabını siler.
const inviteEmailInput = document.getElementById('invite-email-input');
const inviteRoleSelect = document.getElementById('invite-role-select');
const inviteBtn = document.getElementById('invite-btn');
const inviteStatus = document.getElementById('invite-status');
const usersList = document.getElementById('users-list');
const usersStatus = document.getElementById('users-status');
const invitesTitle = document.getElementById('invites-title');
const invitesList = document.getElementById('invites-list');

const ROLE_LABELS = { admin: 'ADMIN', standart: 'USER' };

function friendlyDbError(error) {
  const msg = (error && error.message) || String(error);
  if (/last admin/.test(msg)) return 'The organization must keep at least one admin.';
  if (/duplicate key|invitations_email_key/.test(msg)) return 'This email has already been invited.';
  return msg.replace(/^qraf:\s*/, '');
}

function roleSelect(value, onChange) {
  const select = document.createElement('select');
  select.className = 'text-input user-row-role';
  for (const role of ['standart', 'admin']) {
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = ROLE_LABELS[role];
    select.appendChild(opt);
  }
  select.value = value;
  if (onChange) select.addEventListener('change', () => onChange(select));
  return select;
}

// İlk tıkta "ARE YOU SURE?", ikinci tıkta işlem; 4 sn içinde vazgeçilir.
function confirmButton(label, confirmLabel, action) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'user-row-btn';
  btn.textContent = label;
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!btn.classList.contains('confirm')) {
      btn.classList.add('confirm');
      btn.textContent = confirmLabel;
      timer = setTimeout(() => {
        btn.classList.remove('confirm');
        btn.textContent = label;
      }, 4000);
      return;
    }
    clearTimeout(timer);
    btn.disabled = true;
    await action(btn);
  });
  return btn;
}

function rowError(row, message) {
  let el = row.querySelector('.user-row-error');
  if (!el) {
    el = document.createElement('div');
    el.className = 'user-row-error';
    row.appendChild(el);
  }
  el.textContent = message;
}

async function refreshUsersTab() {
  usersStatus.textContent = 'Loading…';
  const { data: userData } = await supabaseClient.auth.getUser();
  const myId = userData?.user?.id;
  const [profilesRes, invitesRes] = await Promise.all([
    supabaseClient.from('profiles').select('id,email,role,created_at').order('email'),
    supabaseClient.from('invitations').select('id,email,role,created_at').order('created_at', { ascending: false }),
  ]);
  if (profilesRes.error) {
    usersStatus.textContent = `Could not load: ${profilesRes.error.message}`;
    return;
  }
  usersStatus.textContent = '';

  usersList.innerHTML = '';
  for (const p of profilesRes.data || []) {
    const row = document.createElement('div');
    row.className = 'user-row';
    const email = document.createElement('div');
    email.className = 'user-row-email';
    email.textContent = p.email || '(no email)';
    row.appendChild(email);
    if (p.id === myId) {
      const tag = document.createElement('span');
      tag.className = 'user-row-tag';
      tag.textContent = 'YOU';
      row.appendChild(tag);
      const role = roleSelect(p.role);
      role.disabled = true; // kendi rolünü düşürüp kilitlenmesin
      row.appendChild(role);
    } else {
      row.appendChild(
        roleSelect(p.role, async (select) => {
          select.disabled = true;
          const { data, error } = await supabaseClient
            .from('profiles')
            .update({ role: select.value })
            .eq('id', p.id)
            .select('id');
          select.disabled = false;
          if (error || !data || data.length === 0) {
            select.value = p.role;
            rowError(row, error ? friendlyDbError(error) : 'Kaydedilemedi.');
            return;
          }
          p.role = select.value;
          rowError(row, '');
        })
      );
      row.appendChild(
        confirmButton('REMOVE', 'ARE YOU SURE? REMOVE', async (btn) => {
          const { error } = await supabaseClient.rpc('admin_remove_user', { target: p.id });
          if (error) {
            btn.disabled = false;
            btn.classList.remove('confirm');
            btn.textContent = 'REMOVE';
            rowError(row, friendlyDbError(error));
            return;
          }
          row.remove();
        })
      );
    }
    usersList.appendChild(row);
  }

  const invites = invitesRes.error ? [] : invitesRes.data || [];
  invitesTitle.hidden = invites.length === 0;
  invitesList.innerHTML = '';
  for (const inv of invites) {
    const row = document.createElement('div');
    row.className = 'user-row';
    const email = document.createElement('div');
    email.className = 'user-row-email';
    email.textContent = inv.email;
    row.appendChild(email);
    const tag = document.createElement('span');
    tag.className = 'user-row-tag';
    tag.textContent = `${ROLE_LABELS[inv.role] || inv.role} · AWAITING SIGN-IN`;
    row.appendChild(tag);
    row.appendChild(
      confirmButton('CANCEL', 'ARE YOU SURE? CANCEL', async (btn) => {
        const { error } = await supabaseClient.from('invitations').delete().eq('id', inv.id);
        if (error) {
          btn.disabled = false;
          rowError(row, friendlyDbError(error));
          return;
        }
        refreshUsersTab();
      })
    );
    invitesList.appendChild(row);
  }
}

inviteBtn.addEventListener('click', async () => {
  const email = inviteEmailInput.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    inviteStatus.style.color = 'var(--stamp-red)';
    inviteStatus.textContent = 'Enter a valid email address.';
    return;
  }
  inviteBtn.disabled = true;
  inviteStatus.style.color = 'var(--ink-soft)';
  inviteStatus.textContent = 'Kaydediliyor…';
  const { data: existing } = await supabaseClient.from('profiles').select('id').eq('email', email).maybeSingle();
  if (existing) {
    inviteBtn.disabled = false;
    inviteStatus.style.color = 'var(--stamp-red)';
    inviteStatus.textContent = 'This email already has an account.';
    return;
  }
  const { error } = await supabaseClient.from('invitations').insert({ email, role: inviteRoleSelect.value });
  inviteBtn.disabled = false;
  if (error) {
    inviteStatus.style.color = 'var(--stamp-red)';
    inviteStatus.textContent = friendlyDbError(error);
    return;
  }
  inviteStatus.style.color = 'var(--ink-soft)';
  inviteStatus.textContent = `${email} has been invited. They can install qRaf and sign in with this email.`;
  inviteEmailInput.value = '';
  inviteRoleSelect.value = 'standart';
  refreshUsersTab();
});

inviteEmailInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') inviteBtn.click();
});

// --- Marka kimliği (Faz 9) ---
// Organizasyon kendi logosunu yükleyip QR etiket tasarımını (Faz 1'in
// "Depo Etiketi" şablonunda, sadece logo alanı değişken) önizleyip
// onaylayabiliyor. Onaylanmadan önce (ya da hiç logo yüklenmemişse)
// qRaf'ın kendi SVG mührü kullanılmaya devam eder — font özelleştirme
// kapsam dışı.

function orgLogoUrl() {
  if (!currentOrg || !currentOrg.logo_path) return null;
  return supabaseClient.storage.from('org-logos').getPublicUrl(currentOrg.logo_path).data.publicUrl;
}

async function loadOrganization() {
  const { data, error } = await supabaseClient
    .from('organizations')
    .select('id,name,logo_path,logo_design_approved_at')
    .single();
  if (error) {
    brandUploadStatus.textContent = `Could not load organization info: ${error.message}`;
    return;
  }
  currentOrg = data;
  renderBrandSection();
}

function renderBrandSection() {
  // Önizleme, onaylanmamış olsa bile YÜKLENMİŞ logoyu hemen gösterir —
  // admin logonun yerleşimini onaylamadan önce görebilsin diye. Gerçek
  // PDF export'ta kullanılan mühür ise onay durumuna bakar (bkz.
  // buildTagHtml'in ikinci parametresi).
  brandPreviewTag.innerHTML = buildTagHtml('SAMPLE DRIVE', makeQrDataUrl('qraf:onizleme'), false);
  const hasLogo = !!(currentOrg && currentOrg.logo_path);
  const approved = !!(currentOrg && currentOrg.logo_design_approved_at);
  brandApproveBtn.disabled = !hasLogo;
  brandApproveBtn.textContent = approved ? 'APPROVED ✓ (APPROVE AGAIN)' : 'APPROVE DESIGN';
  brandApproveStatus.textContent = approved
    ? `Approved: ${new Date(currentOrg.logo_design_approved_at).toLocaleString('en-GB')}. QR labels are generated with this logo.`
    : hasLogo
      ? 'Logo uploaded but not approved yet. Until it is, QR labels use the qRaf logo.'
      : 'No logo uploaded yet. QR labels use the qRaf logo.';
}

brandLogoInput.addEventListener('change', async () => {
  const file = brandLogoInput.files[0];
  if (!file || !currentOrg) return;
  // Bucket sunucu tarafında da yalnız PNG/JPEG ve 2 MB kabul ediyor
  // (migration 20261026120000); burada kullanıcıya erkenden söylenir.
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg' }[file.type];
  if (!ext) {
    brandUploadStatus.textContent = 'Only PNG or JPG logos can be uploaded.';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    brandUploadStatus.textContent = 'The logo can be at most 2 MB.';
    return;
  }
  const path = `${currentOrg.id}/logo.${ext}`;
  brandUploadStatus.textContent = 'Loading…';
  const { error: uploadError } = await supabaseClient.storage
    .from('org-logos')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    brandUploadStatus.textContent = `Could not load: ${uploadError.message}`;
    return;
  }
  // Yeni logo, önceki onayı geçersiz kılar — admin yeni tasarımı tekrar
  // onaylamadan QR etiketlerine yansımaz.
  const { error: updateError } = await supabaseClient
    .from('organizations')
    .update({ logo_path: path, logo_design_approved_at: null })
    .eq('id', currentOrg.id);
  if (updateError) {
    brandUploadStatus.textContent = `Could not save: ${updateError.message}`;
    return;
  }
  brandUploadStatus.textContent = 'Logo uploaded. Check the preview, then approve.';
  await loadOrganization();
});

brandApproveBtn.addEventListener('click', async () => {
  if (!currentOrg) return;
  brandApproveBtn.disabled = true;
  const { error } = await supabaseClient
    .from('organizations')
    .update({ logo_design_approved_at: new Date().toISOString() })
    .eq('id', currentOrg.id);
  if (error) {
    brandApproveStatus.textContent = `Could not approve: ${error.message}`;
    brandApproveBtn.disabled = false;
    return;
  }
  await loadOrganization();
});

// --- QR Kodları (Faz 5) ---
// Her disk kaydı benzersiz bir "qraf:<uuid>" değeri taşır — QR görseli
// yalnızca bu opak kimliği kodlar, disk içeriğiyle ilgili hiçbir veri
// taşımaz (gerçek veri her zaman sunucu tarafında RLS'den geçer).
// `qrcode-generator` senkron çalışır (callback/promise yok); global adı
// küçük harfle `qrcode` — npm'in `QRCode` (büyük harf) paketiyle karıştırma.

function makeQrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 8);
}

async function renderQrGrid() {
  qrGrid.innerHTML = '';
  if (qrDisksCache.length === 0) {
    qrEmpty.hidden = false;
    qrEmpty.textContent = 'No drives registered yet.';
    return;
  }
  qrEmpty.hidden = true;
  for (const disk of qrDisksCache) {
    const node = qrTagTemplate.content.cloneNode(true);
    const tag = node.querySelector('.qr-tag');
    tag.querySelector('.qr-tag-name').textContent = disk.name;
    const imageEl = tag.querySelector('.qr-tag-image');
    const genBtn = tag.querySelector('.qr-tag-generate-btn');
    if (disk.qr_code_value) {
      genBtn.hidden = true;
      const img = document.createElement('img');
      img.src = makeQrDataUrl(disk.qr_code_value);
      imageEl.appendChild(img);
    } else {
      genBtn.hidden = false;
      genBtn.addEventListener('click', async () => {
        genBtn.disabled = true;
        const value = generateQrValue();
        const { error } = await supabaseClient.from('disks').update({ qr_code_value: value }).eq('id', disk.id);
        if (error) {
          genBtn.disabled = false;
          qrExportStatus.textContent = error.message;
          return;
        }
        disk.qr_code_value = value;
        renderQrGrid();
      });
    }
    qrGrid.appendChild(tag);
  }
}

async function refreshQrTab() {
  qrGrid.innerHTML = '';
  qrEmpty.hidden = false;
  qrEmpty.textContent = 'Loading…';
  qrExportStatus.textContent = '';
  const { data, error } = await supabaseClient.from('disks').select('id,name,qr_code_value').order('name');
  if (error) {
    qrEmpty.textContent = `Could not load: ${error.message}`;
    qrDisksCache = [];
    return;
  }
  qrDisksCache = data || [];
  await renderQrGrid();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const QR_LOGO_SVG = `<svg viewBox="0 0 120 90" width="18" height="14">
  <rect x="6" y="6" width="108" height="78" rx="3" fill="none" stroke="#1C1A16" stroke-width="7"></rect>
  <circle cx="24" cy="24" r="9" fill="none" stroke="#1C1A16" stroke-width="7"></circle>
</svg>`;

// Organizasyon bir logo yüklediyse etikette qRaf'ın SVG mührü yerine o
// logo kullanılır (bkz. Faz 9 — Marka kimliği). `requireApproved` true
// ise (gerçek PDF export) logo yalnızca onaylanmışsa gösterilir; false
// ise (ekran önizlemesi) admin onaylamadan önce de yüklediği logoyu
// görebilsin diye onay şartı aranmaz.
function brandMarkHtml(requireApproved) {
  const hasLogo = currentOrg && currentOrg.logo_path && (!requireApproved || currentOrg.logo_design_approved_at);
  if (hasLogo) {
    return `<img class="tag-logo" src="${orgLogoUrl()}" />`;
  }
  return `${QR_LOGO_SVG}<span>qRaf</span>`;
}

// Tek bir etiketin HTML'i — hem ekrandaki "Marka Kimliği" önizlemesinde
// hem de PDF dışa aktarımında aynı yapı kullanılır, ikisi asla
// birbirinden farklı görünmesin diye (yalnızca onay şartı farklı, bkz.
// brandMarkHtml).
function buildTagHtml(name, qrDataUrl, requireApproved = true) {
  return `
    <div class="tag">
      <div class="tag-brand">${brandMarkHtml(requireApproved)}</div>
      <img src="${qrDataUrl}" />
      <div class="tag-name">${escapeHtml(name)}</div>
    </div>`;
}

// Faz 1'deki "Depo Etiketi" kimliğiyle uyumlu (kraft/etiket kağıdı,
// Bebas Neue, perfore kenar) yazdırılabilir bir sayfa — her etiket
// diskin adını, marka mührünü (logo ya da qRaf) ve QR kodunu taşır.
async function buildQrPdfHtml() {
  const withQr = qrDisksCache.filter((d) => d.qr_code_value);
  const tagsHtml = withQr.map((d) => buildTagHtml(d.name, makeQrDataUrl(d.qr_code_value), true));
  return `<!doctype html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; }
  .sheet { display: flex; flex-wrap: wrap; gap: 6mm; }
  .tag {
    width: 55mm; height: 65mm; border: 1.5px dashed #B5A780; border-radius: 2mm;
    padding: 4mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3mm;
    page-break-inside: avoid;
  }
  .tag-brand { display: flex; align-items: center; gap: 5px; font-family: 'Bebas Neue', sans-serif; font-size: 10pt; letter-spacing: 0.08em; color: #1C1A16; max-width: 100%; }
  .tag-name { font-family: 'Bebas Neue', sans-serif; font-size: 15pt; letter-spacing: 0.03em; text-align: center; }
  img { width: 32mm; height: 32mm; }
  .tag-logo { width: auto; height: 9mm; max-width: 40mm; object-fit: contain; }
</style>
</head><body><div class="sheet">${tagsHtml.join('')}</div></body></html>`;
}

qrExportBtn.addEventListener('click', async () => {
  if (!qrDisksCache.some((d) => d.qr_code_value)) {
    qrExportStatus.textContent = 'No QR codes to export. Assign QR codes to drives first.';
    return;
  }
  qrExportBtn.disabled = true;
  qrExportStatus.textContent = 'Preparing…';
  try {
    const html = await buildQrPdfHtml();
    const result = await window.qraf.exportPdf(html);
    if (result.canceled) {
      qrExportStatus.textContent = '';
    } else if (result.success) {
      qrExportStatus.textContent = `Saved: ${result.filePath}`;
    } else {
      qrExportStatus.textContent = `Export failed: ${result.error}`;
    }
  } finally {
    qrExportBtn.disabled = false;
  }
});

// --- Disk kartları ---

// Kart hemen bir iskelet olarak render edilir (disk listesi zaten
// total/free bilgisini taşıyor); üst düzey klasör taraması tam
// recursive olduğu için büyük disklerde uzun sürebilir — bu yüzden her
// diskin taraması bağımsız ve paralel çalışır, biri diğerini bekletmez.
function buildDiskCard(disk, mapping) {
  const node = diskCardTemplate.content.cloneNode(true);
  const card = node.querySelector('.disk-card');
  card.dataset.id = disk.id;
  card.querySelector('.disk-card-id').textContent = (mapping ? mapping.name : diskDisplayName(disk)).toUpperCase();
  card.querySelector('.disk-card-status').textContent = disk.removable ? 'REMOVABLE' : 'INTERNAL';
  card.querySelector('.disk-card-meter').textContent = meterText(disk.freeBytes, disk.totalBytes);
  card.querySelector('.disk-card-free').textContent = `${formatBytes(disk.freeBytes)} FREE`;
  card.querySelector('.disk-card-total').textContent = `/ ${formatBytes(disk.totalBytes)} total`;
  card.querySelector('.disk-card-scan').textContent = 'Scanning…';
  card.querySelector('.disk-card-speed').textContent = speedLine(disk);
  card.periodicRescan = () => refreshDiskScan(disk, card, mapping, { force: true });
  const matchBtn = card.querySelector('.disk-card-match-btn');
  const rescanBtn = card.querySelector('.disk-card-rescan-btn');
  if (mapping) {
    matchBtn.hidden = true;
    rescanBtn.hidden = false;
    rescanBtn.addEventListener('click', async () => {
      rescanBtn.disabled = true;
      await refreshDiskScan(disk, card, mapping, { force: true });
      rescanBtn.disabled = false;
    });
  } else {
    // Disk eşleştirme/yeni kayıt yalnız admin işi.
    matchBtn.hidden = !isAdmin();
    matchBtn.addEventListener('click', () => openMatchModal(disk));
    rescanBtn.hidden = true;
  }
  return card;
}

// Bu oturumda alınmış son taramalar (stableId → tarama sözü). Yeni bir
// disk takıldığında ya da bir disk eşleştirildiğinde liste yeniden
// çiziliyor; önceden her seferinde TÜM bağlı diskler baştan taranıyordu
// (5 Ekim 2026). Artık yalnızca yeni takılan disk
// taranıyor; eşleştirilen disk mevcut taramayla hemen senkronlanıyor.
// "SCAN NOW" (force) her zaman taze tarama yapar. Çıkarılan diskin
// kaydı silinir — tekrar takıldığında baştan taranır.
const scanCache = new Map();

// Bu takılışta hızı ölçülmüş diskler (stableId). Disk her takıldığında
// hız bir kez ölçülür — kullanıcı hızı diskin güncel sağlık göstergesi
// olarak izliyor (5 Ekim 2026). "SCAN NOW" yeniden
// ölçmez; disk çıkarılınca kayıt silinir, tekrar takılınca yine ölçülür.
const speedTested = new Set();

function speedText(readMBps, writeMBps) {
  const read = readMBps ? `${Math.round(readMBps)} MB/s` : '—';
  const write = writeMBps ? `${Math.round(writeMBps)} MB/s` : '—';
  return `Read: ${read} · Write: ${write}`;
}

// Kart her disk değişikliğinde yeniden çiziliyor; hız durumu (ölçülüyor /
// bekliyor / sonuç) burada tutulup yeni karta da yazılıyor.
const speedStatus = new Map();
// Meşgul diskte hız testinin yeniden deneme aralığı. Kontrol (iostat)
// diske dokunmuyor, ama kullanıcı aktarımların saatler sürdüğünü
// belirtti — dakikada bir denemek gereksiz bulundu (5 Ekim 2026).
const SPEED_RETRY_MS = 60 * 60 * 1000;

// Veritabanındaki son ölçüm (stableId → metin). Bu takılışın ölçümü
// bitene kadar (ya da disk meşgulken) kartta bu gösterilir.
const lastKnownSpeed = new Map();

function speedLine(disk) {
  const status = speedStatus.get(disk.stableId);
  const last = lastKnownSpeed.get(disk.stableId);
  if (status && !status.startsWith('Read')) return last ? `${status} · Last: ${last}` : status;
  return status || (last ? `Last measured: ${last}` : '');
}

function renderSpeedLine(disk) {
  const card = disksGridEl.querySelector(`.disk-card[data-id="${CSS.escape(disk.id)}"]`);
  if (card) card.querySelector('.disk-card-speed').textContent = speedLine(disk);
}

function setSpeedStatus(disk, text) {
  speedStatus.set(disk.stableId, text);
  renderSpeedLine(disk);
}

async function loadLastKnownSpeeds(disks, diskMap) {
  const ids = disks.map((d) => diskMap[d.stableId]?.id).filter(Boolean);
  if (ids.length === 0) return;
  const { data, error } = await supabaseClient
    .from('disks')
    .select('id,read_speed_mbps,write_speed_mbps,speed_tested_at')
    .in('id', ids);
  if (error || !data) return;
  for (const disk of disks) {
    const row = data.find((r) => r.id === diskMap[disk.stableId]?.id);
    if (!row || !(row.read_speed_mbps || row.write_speed_mbps)) continue;
    const at = row.speed_tested_at ? ` (${new Date(row.speed_tested_at).toLocaleString('en-GB')})` : '';
    lastKnownSpeed.set(disk.stableId, `${speedText(row.read_speed_mbps, row.write_speed_mbps)}${at}`);
    renderSpeedLine(disk);
  }
}

async function runSpeedTest(disk, diskRecordId) {
  if (speedTested.has(disk.stableId)) return;
  speedTested.add(disk.stableId);
  // Disk başka bir aktarım yapıyorsa test olduğundan düşük çıkar —
  // disk boşalana kadar 60 dakikada bir tekrar bakılır. Disk bu arada
  // çıkarılırsa (speedTested'dan silinir) bekleme sona erer.
  while (await window.qraf.isDiskBusy(disk.device)) {
    setSpeedStatus(disk, 'Drive is busy. Speed test is waiting');
    await new Promise((resolve) => setTimeout(resolve, SPEED_RETRY_MS));
    if (!speedTested.has(disk.stableId)) return;
  }
  setSpeedStatus(disk, 'Measuring speed…');
  let speed;
  try {
    speed = await window.qraf.speedTestDisk(disk.mountpoint);
  } catch {
    speedTested.delete(disk.stableId);
    setSpeedStatus(disk, 'Speed test failed');
    return;
  }
  if (!speedTested.has(disk.stableId)) return; // test sırasında çıkarıldı
  setSpeedStatus(disk, speedText(speed.readMBps, speed.writeMBps));
  const payload = {
    read_speed_mbps: speed.readMBps,
    write_speed_mbps: speed.writeMBps,
    speed_tested_at: new Date().toISOString(),
  };
  try {
    const { error } = await supabaseClient.from('disks').update(payload).eq('id', diskRecordId);
    if (error) throw error;
  } catch {
    // çevrimdışı — bekleyen senkron kuyruğuna ekle, bağlantı gelince yazılır
    const queue = loadPendingQueue();
    queue[diskRecordId] = { ...queue[diskRecordId], ...payload };
    savePendingQueue(queue);
  }
}

function getScan(disk, force) {
  if (force || !scanCache.has(disk.stableId)) {
    const scanPromise = window.qraf.scanDisk(disk.mountpoint);
    scanCache.set(disk.stableId, scanPromise);
    scanPromise.catch(() => {
      if (scanCache.get(disk.stableId) === scanPromise) scanCache.delete(disk.stableId);
    });
  }
  return scanCache.get(disk.stableId);
}

async function refreshDiskScan(disk, card, mapping, { force = false } = {}) {
  card.querySelector('.disk-card-scan').textContent = 'Scanning…';
  const scan = await getScan(disk, force);
  card.querySelector('.disk-card-meter').textContent = meterText(scan.freeBytes, scan.totalBytes);
  card.querySelector('.disk-card-free').textContent = `${formatBytes(scan.freeBytes)} FREE`;
  card.querySelector('.disk-card-total').textContent = `/ ${formatBytes(scan.totalBytes)} total`;
  card.querySelector('.disk-card-scan').textContent = `Last scan: ${new Date(scan.scannedAt).toLocaleTimeString('en-GB')}`;

  const syncEl = card.querySelector('.disk-card-sync');
  if (mapping) {
    const ok = await syncScanToSupabase(mapping.id, scan);
    syncEl.textContent = ok ? '' : 'Offline. Will sync when the connection is back';
    // Tarama bittikten sonra: aynı anda çalışırsa HDD'de ikisi de yavaşlar.
    // Beklenmiyor — disk meşgulse test dakikalarca ertelenebilir.
    runSpeedTest(disk, mapping.id);
  } else {
    syncEl.textContent = '';
  }
}

async function refreshDisks() {
  // Bekleyen senkron kuyruğu ağ isteği; disk listesinin çizilmesini
  // bekletmesin.
  flushPendingSync();
  const diskMap = loadDiskMap();
  const disks = await window.qraf.listDisks();
  const connected = new Set(disks.map((d) => d.stableId));
  for (const id of scanCache.keys()) {
    if (!connected.has(id)) scanCache.delete(id);
  }
  for (const id of [...speedTested]) {
    if (!connected.has(id)) {
      speedTested.delete(id);
      speedStatus.delete(id);
      lastKnownSpeed.delete(id);
    }
  }
  diskCountEl.textContent = `${disks.length} DRIVES CONNECTED`;
  disksEmptyEl.hidden = disks.length > 0;
  disksGridEl.innerHTML = '';
  const scans = disks.map((disk) => {
    const mapping = diskMap[disk.stableId];
    const card = buildDiskCard(disk, mapping);
    disksGridEl.appendChild(card);
    return refreshDiskScan(disk, card, mapping);
  });
  loadLastKnownSpeeds(disks, diskMap);
  await Promise.all(scans);
}

window.qraf.onDisksChanged(() => {
  if (!viewDashboard.hidden) refreshDisks();
});

// Not — tasarım kararı (5 Ekim 2026):
// tam klasör taraması (her dosyayı stat'layan recursive işlem) disk
// takıldığında, uygulama açıldığında, "SCAN NOW"ya basıldığında ve
// takılı diskler için SAAT BAŞI çalışır. Önceden dakikada bir tüm
// diskleri tarayan zamanlayıcı sürekli disk I/O'su yarattığı için
// kaldırılmıştı; ama diskler saatlerce takılı kalıp aktarım aldığında
// veritabanındaki klasör/boş alan bilgisi takıldığı anda kalıyordu.
// Tarama dosya içeriği okumuyor (16 TB / 31.817 dosya ≈ 3 sn), saatte
// bir kez aktarımı belirgin yavaşlatmıyor. Hız testi bu taramada
// yeniden yapılmaz (takılış başına bir kez).
const PERIODIC_SCAN_MS = 60 * 60 * 1000;

setInterval(() => {
  if (viewDashboard.hidden) return;
  for (const card of disksGridEl.querySelectorAll('.disk-card')) {
    card.periodicRescan?.();
  }
}, PERIODIC_SCAN_MS);

// Çevrimdışıyken biriken senkron kuyruğu ise disk taramasına ihtiyaç
// duymuyor (sadece ağ isteği) — o yüzden hafif haliyle periyodik olarak
// denenmeye devam ediyor.
setInterval(() => {
  if (!viewDashboard.hidden) flushPendingSync();
}, SYNC_INTERVAL_MS);

supabaseClient.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showDashboard();
  } else {
    showLogin();
  }
});

supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session) {
    showDashboard();
  } else {
    showLogin();
  }
});

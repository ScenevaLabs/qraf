const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const si = require('systeminformation');

const POLL_INTERVAL_MS = 3000;

let mainWindow;
let lastDisksSnapshot = '';
// Son görülen harici disklerin bağlama noktaları (bkz. assertKnownDisk).
let knownMountpoints = new Set();

function rememberDisks(disks) {
  knownMountpoints = new Set(disks.map((d) => d.mountpoint));
  return disks;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    backgroundColor: '#D9CBA6',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  lockNavigation(mainWindow);
}

// Uygulama penceresi yalnız kendi index.html'ini gösterir: yeni pencere
// açılamaz, başka bir adrese gidilemez (renderer'a bir şekilde zararlı
// içerik girse bile window.qraf köprüsü dış bir sayfaya geçmesin diye).
function lockNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.on('will-redirect', (event) => event.preventDefault());
}

// Klasör ağacında kaç seviye aşağıya kadar alt klasör kaydedileceği
// (kök = 1). Late Shift gibi projelerde bölümler
// "PROJE / tarih / BOLUM_13 / GORUNTULER" şeklinde 3–4. seviyede
// duruyor; daha derini (tek tek kamera kartları vb.) aramada gürültü
// ve veritabanında gereksiz hacim yaratıyor. Tarama
// derinliği sabit değil, buradan ayarlanabilir.
const FOLDER_TREE_DEPTH = 4;

// İşletim sisteminin diske bıraktığı, kullanıcının işine yaramayan
// klasörler (Faz 12). "." ile başlayan her şey (.Spotlight-V100,
// .fseventsd, .Trashes, .TemporaryItems, ...) + Windows'un kendi
// klasörleri. Boyutları yine de üst klasörün toplamına dahil edilir —
// diskte gerçekten yer kaplıyorlar, sadece listede gösterilmiyorlar.
const HIDDEN_FOLDER_NAMES = new Set(['$recycle.bin', 'system volume information']);

function isHiddenFolder(name) {
  return name.startsWith('.') || HIDDEN_FOLDER_NAMES.has(name.toLowerCase());
}

// Bir klasörün toplam boyutunu (ne kadar derinde olursa olsun tüm alt
// içerik dahil, tam recursive) hesaplarken, `depthLeft` > 0 olduğu
// sürece alt klasörlerini de `children` olarak toplar. Aynı tek gezinti
// hem boyutu hem ağacı çıkarır, disk iki kez okunmaz.
async function scanFolderTree(dirPath, depthLeft) {
  let sizeBytes = 0;
  const children = [];
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return { sizeBytes: 0, children }; // erişim izni yok / okunamıyor — sessizce 0 say
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const keepNode = depthLeft > 0 && !isHiddenFolder(entry.name);
      const sub = await scanFolderTree(entryPath, keepNode ? depthLeft - 1 : 0);
      sizeBytes += sub.sizeBytes;
      if (keepNode) children.push(toFolderNode(entry.name, sub));
    } else if (entry.isFile()) {
      try {
        const stat = await fs.stat(entryPath);
        sizeBytes += stat.size;
      } catch {
        // dosya okunamadı, atla
      }
    }
  }
  return { sizeBytes, children };
}

// `children` boşsa hiç yazılmaz — 40 diskin JSON'u gereksiz şişmesin.
function toFolderNode(name, { sizeBytes, children }) {
  const node = { name, sizeBytes };
  if (children.length > 0) node.children = children;
  return node;
}

// macOS, dahili SSD'yi tek bir disk yerine bir sürü "sanal" APFS birimine
// böler (/System/Volumes/VM, Preboot, Data, Hardware, vb.) — bunlar
// fiziksel olarak ayrı diskler değil, aynı dahili sürücünün sistem
// bölmeleri. qRaf yalnızca fiziksel olarak takılıp çıkarılan harici
// prodüksiyon disklerini (/Volumes/... altında görünürler) takip etmeyi
// hedefliyor — bu yüzden dahili/sistem birimleri baştan filtreleniyor.
// Bunları listeleyip taramak hem kafa karıştırıcı kartlara yol açıyordu
// hem de "/" ve "/System/Volumes/Data" özyinelemeli tarandığında kullanıcı
// klasörüne (Kişiler/Takvim/Fotoğraflar veritabanlarına) kadar iniyor,
// macOS bu korumalı klasörlere erişim için izin istemi çıkarıyordu.
function isTrackableMount(mount) {
  if (process.platform !== 'darwin') return true;
  if (mount === '/') return false;
  if (mount.startsWith('/System/Volumes/')) return false;
  return true;
}

// Windows'ta `blockDevices()`'in `removable` alanı USB'ye takılı harici
// HDD/SSD'ler için neredeyse hep false dönüyor (Windows bunları "Fixed"
// medya sınıfına koyuyor, gerçek "removable" işareti fiilen sadece
// flash bellek/SD kart gibi cihazlara veriliyor) — bu yüzden qRaf'ın asıl
// takip etmesi gereken harici prodüksiyon SSD/HDD'leri sessizce
// filtreleniyordu (30 Ağustos 2026: kullanıcı
// takılı bir USB SSD'nin hiç görünmediğini bildirdi). Daha güvenilir
// sinyal `diskLayout()`'taki fiziksel diskin `interfaceType`'ı — USB
// üzerinden bağlıysa harici sayılır, dahili SATA/NVMe ise sayılmaz.
//
// macOS'ta `blockDevices()`'in `device` alanı boş geliyor, bu yüzden
// diskLayout eşleşmesi tutmuyordu; arayüz bilgisi doğrudan `protocol`
// alanında ('USB', 'Thunderbolt', 'Disk Image' ...). .dmg kurulum
// imajları da `removable: true` geldiği için listeye "disk" olarak
// giriyordu (4 Ekim 2026) — disk imajları hiçbir zaman
// envanter diski değil.
const EXTERNAL_INTERFACES = new Set(['USB', 'Thunderbolt', 'FireWire']);

function isExternalInterface(interfaceType) {
  return EXTERNAL_INTERFACES.has(interfaceType);
}

// macOS'ta `si.blockDevices()` her birim için ayrı `diskutil info`
// çağırıyor; 5 harici HDD takılıyken tek çağrı ~31 sn sürüyordu 
// (5 Ekim 2026: disk takıldıktan 1–2 dk sonra görünüyordu).
// `diskutil list -plist external physical` aynı bilgiyi ~30 ms'de veriyor
// ve zaten yalnızca harici fiziksel diskleri listeliyor (dahili SSD ve
// .dmg imajları dışarıda kalıyor). VolumeUUID, blockDevices'ın `uuid`
// alanıyla aynı değer — mevcut disk eşleşmeleri (stableId) bozulmuyor.
function listExternalVolumesMac() {
  return new Promise((resolve, reject) => {
    execFile(
      '/bin/sh',
      ['-c', 'diskutil list -plist external physical | plutil -convert json -o - -'],
      (err, stdout) => {
        if (err) return reject(err);
        const disks = JSON.parse(stdout).AllDisksAndPartitions || [];
        resolve(disks.flatMap((d) => d.Partitions || []).filter((p) => p.MountPoint));
      }
    );
  });
}

async function listDisksMac() {
  const [fsSizes, volumes] = await Promise.all([si.fsSize(), listExternalVolumesMac()]);
  const byMount = new Map(volumes.map((v) => [v.MountPoint, v]));
  return fsSizes
    .filter((fs_) => byMount.has(fs_.mount))
    .map((fs_) => {
      const volume = byMount.get(fs_.mount);
      return {
        id: fs_.mount,
        // Bölümün ait olduğu fiziksel disk (disk4s1 → disk4) — meşguliyet
        // ölçümü (iostat) fiziksel disk bazında yapılıyor.
        device: volume.DeviceIdentifier.replace(/s\d+$/, ''),
        stableId: volume.VolumeUUID || volume.DiskUUID || fs_.mount,
        name: fs_.mount,
        mountpoint: fs_.mount,
        totalBytes: fs_.size,
        freeBytes: fs_.available,
        removable: true,
      };
    });
}

async function listDisks() {
  if (process.platform === 'darwin') return listDisksMac();
  const [fsSizes, blockDevices, diskLayout] = await Promise.all([
    si.fsSize(),
    si.blockDevices().catch(() => []),
    si.diskLayout().catch(() => []),
  ]);
  const byMount = new Map(blockDevices.filter((d) => d.mount).map((d) => [d.mount, d]));
  const interfaceByDevice = new Map(diskLayout.map((d) => [d.device, d.interfaceType]));
  return fsSizes
    .filter((fs_) => fs_.mount && isTrackableMount(fs_.mount))
    .map((fs_) => {
      const block = byMount.get(fs_.mount);
      const physicalInterface =
        (block?.device && interfaceByDevice.get(block.device)) || block?.protocol || undefined;
      // Sürücü harfi (mountpoint) takılıp çıkarmalar arasında değişebilir;
      // eşleştirmeyi kalıcı tutmak için dosya sistemi UUID'si / seri
      // numarası gibi daha kararlı bir kimlik tercih edilir, yoksa
      // mountpoint'e düşülür.
      const stableId = block?.uuid || block?.serial || fs_.mount;
      return {
        id: fs_.mount,
        stableId,
        name: fs_.mount,
        mountpoint: fs_.mount,
        totalBytes: fs_.size,
        freeBytes: fs_.available,
        removable:
          physicalInterface !== 'Disk Image' &&
          (Boolean(block?.removable) || isExternalInterface(physicalInterface)),
      };
    })
    // qRaf yalnızca takılıp çıkarılan harici prodüksiyon disklerini
    // takip ediyor — bilgisayarın kendi dahili sistem diski (Windows'ta
    // C:, macOS'ta dahili SSD) hiçbir zaman etiketlenip QR ile
    // eşleştirilecek bir "envanter diski" değil, listede sadece
    // gürültü yaratıyordu.
    .filter((disk) => disk.removable);
}

async function scanDisk(mountpoint) {
  // Windows'ta bir sürücü harfi sonuna ayraç eklenmeden ("C:") verilirse
  // bu, o sürücüdeki GÜNCEL ÇALIŞMA DİZİNİ anlamına gelir — sürücü kökü
  // değil. fs çağrılarında her zaman kökü hedeflediğimizden emin olmak
  // için bare bir sürücü harfine ayraç ekliyoruz.
  const rootPath = /^[A-Za-z]:$/.test(mountpoint) ? `${mountpoint}\\` : mountpoint;

  let space = { size: null, free: null };
  try {
    const fsSizes = await si.fsSize();
    const match = fsSizes.find((fs_) => fs_.mount === mountpoint);
    if (match) space = { size: match.size, free: match.available };
  } catch {
    // boş alan bilgisi alınamadı (ör. erişilemeyen bir bağlantı noktası)
  }

  // Üst düzey klasörler + FOLDER_TREE_DEPTH seviyeye kadar alt
  // klasörleri (`children`). Mevcut `top_level_folders` alanının
  // biçimi korunuyor ({ name, sizeBytes }), alt klasörler ek bir alan —
  // eski mobil sürüm `children`'ı yok sayıp çalışmaya devam ediyor.
  let topLevelFolders = [];
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const folders = entries.filter((e) => e.isDirectory() && !isHiddenFolder(e.name));
    topLevelFolders = await Promise.all(
      folders.map(async (folder) =>
        toFolderNode(folder.name, await scanFolderTree(path.join(rootPath, folder.name), FOLDER_TREE_DEPTH - 1))
      )
    );
  } catch {
    topLevelFolders = [];
  }

  return {
    mountpoint,
    totalBytes: space.size,
    freeBytes: space.free,
    topLevelFolders,
    scannedAt: new Date().toISOString(),
  };
}

const SPEED_TEST_SIZE_BYTES = 64 * 1024 * 1024; // 64MB — hız için yeterince büyük, disk aşınması için makul

// Disk her takıldığında bir kez çalışır (5 Ekim 2026:
// kullanıcı hızı diskin güncel sağlık göstergesi olarak kullanmak
// istiyor — 3 ay önceki ölçüm işe yaramıyor). Her taramada çalışmaz.
//
// Yazma: test dosyası yazılıp `sync` ile diske zorlanır, sonra silinir.
// Okuma: eskiden aynı test dosyası geri okunuyordu, ama yeni yazılan
// dosya işletim sisteminin belleğinden geldiği için harici bir HDD'de
// ~7000 MB/s gibi imkânsız değerler çıkıyordu. Artık diskte zaten
// duran büyük bir dosyanın rastgele bir bölümü okunuyor — disk yeni
// takıldığında o veri bellekte olmadığından gerçek disk hızı ölçülür
// (ölçüm: aynı dosyanın ilk okunuşu 200 MB/s, ikincisi 6644 MB/s).
// Diskte yeterince büyük dosya yoksa okuma hızı boş (null) kalır —
// yanlış bir sayı göstermektense hiç göstermemek tercih edildi.
async function measureWriteSpeed(rootPath, sizeBytes) {
  const testPath = path.join(rootPath, '.qraf-speedtest.tmp');
  const buffer = Buffer.alloc(sizeBytes, 1);
  let handle;
  try {
    handle = await fs.open(testPath, 'w');
    const start = process.hrtime.bigint();
    await handle.write(buffer, 0, buffer.length, 0);
    await handle.sync(); // OS yazma önbelleğini atlayıp gerçek diske zorlar
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    return seconds > 0 ? sizeBytes / 1e6 / seconds : null;
  } catch {
    return null; // disk dolu / salt okunur — yazma hızı ölçülemedi
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(testPath).catch(() => {});
  }
}

// Okuma testi için en az `minBytes` büyüklüğünde, gizli olmayan ilk
// dosyayı bulur (önce bir klasördeki dosyalar, sonra alt klasörler).
// Video arşivi disklerinde birkaç milisaniyede bulunuyor.
async function findReadSample(dirPath, minBytes, depthLeft) {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const filePath = path.join(dirPath, entry.name);
    try {
      const stat = await fs.stat(filePath);
      if (stat.size >= minBytes) return { filePath, size: stat.size };
    } catch {
      // okunamadı, sıradakine geç
    }
  }
  if (depthLeft <= 0) return null;
  for (const entry of entries) {
    if (!entry.isDirectory() || isHiddenFolder(entry.name)) continue;
    const found = await findReadSample(path.join(dirPath, entry.name), minBytes, depthLeft - 1);
    if (found) return found;
  }
  return null;
}

async function measureReadSpeed(rootPath, sizeBytes) {
  const sample = await findReadSample(rootPath, sizeBytes, 8);
  if (!sample) return null;
  const offset = Math.floor(Math.random() * (sample.size - sizeBytes));
  const buffer = Buffer.alloc(sizeBytes);
  let handle;
  try {
    handle = await fs.open(sample.filePath, 'r');
    const start = process.hrtime.bigint();
    let bytesRead = 0;
    while (bytesRead < sizeBytes) {
      const result = await handle.read(buffer, bytesRead, sizeBytes - bytesRead, offset + bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    const seconds = Number(process.hrtime.bigint() - start) / 1e9;
    return seconds > 0 && bytesRead > 0 ? bytesRead / 1e6 / seconds : null;
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function speedTestDisk(mountpoint) {
  const rootPath = /^[A-Za-z]:$/.test(mountpoint) ? `${mountpoint}\\` : mountpoint;

  let writeSize = SPEED_TEST_SIZE_BYTES;
  try {
    const fsSizes = await si.fsSize();
    const match = fsSizes.find((fs_) => fs_.mount === mountpoint);
    if (match?.available && match.available < writeSize * 3) {
      writeSize = Math.max(1 * 1024 * 1024, Math.floor(match.available / 4));
    }
  } catch {
    // boş alan bilgisi alınamadı, varsayılan boyutla devam
  }

  // Önce okuma: yazma testi sonrası disk önbelleği karışmasın.
  const readMBps = await measureReadSpeed(rootPath, SPEED_TEST_SIZE_BYTES);
  const writeMBps = await measureWriteSpeed(rootPath, writeSize);
  return { readMBps, writeMBps };
}

// Diskin o anki aktarım hızı (MB/s, ~2 sn'lik örnek). Hız testi başka
// bir aktarımla aynı anda çalışırsa disk paylaşıldığı için olduğundan
// düşük çıkıyordu (5 Ekim 2026) — test, disk boşken
// yapılsın diye önce buna bakılıyor. Yalnız macOS (iostat); diğer
// platformlarda 0 döner, test hemen yapılır.
const DISK_BUSY_MBPS = 3;

function diskActivityMBps(device) {
  if (process.platform !== 'darwin' || !/^disk\d+$/.test(device || '')) return Promise.resolve(0);
  return new Promise((resolve) => {
    execFile('/usr/sbin/iostat', ['-d', '-w', '2', '-c', '2', device], (err, stdout) => {
      if (err) return resolve(0);
      const last = stdout.trim().split('\n').pop().trim().split(/\s+/);
      resolve(Number(last[2]) || 0);
    });
  });
}

ipcMain.handle('disks:list', async () => rememberDisks(await listDisks()));
ipcMain.handle('disks:isBusy', async (_event, device) => (await diskActivityMBps(device)) > DISK_BUSY_MBPS);
// Tarama ve hız testi yalnız listDisks()'in gösterdiği harici disklerde
// çalışır; renderer'dan gelen herhangi bir yol (ör. ev klasörü) kabul
// edilmez. Hız testi diske dosya yazdığı için bu ayrıca önemli.
// Kontrol, 3 sn'lik yoklamanın son listesine bakar; Windows'ta
// listDisks() birkaç saniye sürdüğü için her taramada yeniden
// çağrılmaz, yalnız disk o listede yoksa (az önce takıldıysa) çağrılır.
async function assertKnownDisk(mountpoint) {
  if (typeof mountpoint !== 'string') throw new Error('Unknown drive');
  if (knownMountpoints.has(mountpoint)) return;
  rememberDisks(await listDisks());
  if (!knownMountpoints.has(mountpoint)) throw new Error('Unknown drive');
}
ipcMain.handle('disks:scan', async (_event, mountpoint) => {
  await assertKnownDisk(mountpoint);
  return scanDisk(mountpoint);
});
ipcMain.handle('disks:speedTest', async (_event, mountpoint) => {
  await assertKnownDisk(mountpoint);
  return speedTestDisk(mountpoint);
});

// QR etiketlerini PDF olarak dışa aktarır: renderer'ın oluşturduğu
// kendi kendine yeten (self-contained) HTML'i gizli bir pencerede
// yükleyip Electron'un printToPDF'iyle basar, sonra kullanıcıya
// kaydetme diyaloğu gösterir.
ipcMain.handle('pdf:export', async (_event, html) => {
  // Etiket HTML'i yalnız işaretleme + stil; betik çalışmasına gerek yok.
  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  });
  pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save QR codes as PDF',
      defaultPath: 'qraf-qr-codes.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { success: false, canceled: true };
    await fs.writeFile(filePath, pdfBuffer);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    pdfWindow.destroy();
  }
});

// setInterval bir önceki yoklamanın bitmesini beklemiyor; liste yavaş
// geldiğinde yoklamalar üst üste binip birbirini daha da yavaşlatıyordu.
let pollInProgress = false;

async function pollDiskChanges() {
  if (pollInProgress) return;
  pollInProgress = true;
  try {
    const disks = rememberDisks(await listDisks());
    const snapshot = JSON.stringify(disks.map((d) => d.id).sort());
    if (snapshot !== lastDisksSnapshot) {
      lastDisksSnapshot = snapshot;
      if (mainWindow) {
        mainWindow.webContents.send('disks:changed', disks);
      }
    }
  } catch {
    // bir sonraki döngüde tekrar denenecek
  } finally {
    pollInProgress = false;
  }
}

app.whenReady().then(() => {
  createWindow();
  setInterval(pollDiskChanges, POLL_INTERVAL_MS);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

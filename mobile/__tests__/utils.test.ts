import {
  formatShortDate,
  formatSpeed,
  matchingFolders,
  naturalDiskCompare,
  normalizeForSearch,
  type DiskRow,
} from '../src/utils';

function disk(name: string, folders: DiskRow['top_level_folders'] = []): DiskRow {
  return {
    id: name,
    name,
    qr_code_value: null,
    top_level_folders: folders,
    total_bytes: null,
    free_bytes: null,
    last_scanned_at: null,
    read_speed_mbps: null,
    write_speed_mbps: null,
    speed_tested_at: null,
  };
}

describe('naturalDiskCompare', () => {
  test('yalnız baştaki sayı sıra numarası; adın içindeki sayı değil', () => {
    const names = ['ARC MASTER2', '10. Disk', '2. Disk', '1. Disk', 'ARC BACKUP', '3. Disk', 'ARC MASTER'];
    expect(names.map((n) => disk(n)).sort(naturalDiskCompare).map((d) => d.name)).toEqual([
      '1. Disk',
      '2. Disk',
      '3. Disk',
      '10. Disk',
      'ARC BACKUP',
      'ARC MASTER',
      'ARC MASTER2',
    ]);
  });

  test('01 ile 1 aynı sırada, 9 < 10', () => {
    const sorted = ['10 Disk', '09 Disk', '01 Disk'].map((n) => disk(n)).sort(naturalDiskCompare);
    expect(sorted.map((d) => d.name)).toEqual(['01 Disk', '09 Disk', '10 Disk']);
  });

  test('numarasızlar kendi aralarında doğal sıralı (MASTER2 < MASTER10)', () => {
    const sorted = ['ARC MASTER10', 'ARC MASTER2'].map((n) => disk(n)).sort(naturalDiskCompare);
    expect(sorted.map((d) => d.name)).toEqual(['ARC MASTER2', 'ARC MASTER10']);
  });
});

describe('matchingFolders', () => {
  const d = disk('ARC MASTER', [
    {
      name: 'NIGHT SHIFT',
      sizeBytes: 5e12,
      children: [
        {
          name: '2026.08.25',
          sizeBytes: 1e12,
          children: [
            { name: 'BOLUM_13', sizeBytes: 4e11 },
            { name: 'BOLUM_3', sizeBytes: 3e11 },
          ],
        },
      ],
    },
    { name: '.Spotlight-V100', sizeBytes: 1e6 },
  ]);

  test('bölüm numarasıyla tam yolu bulur', () => {
    const m = matchingFolders(d, 'night shift 13');
    expect(m.map((x) => x.path.join(' › '))).toEqual(['NIGHT SHIFT › 2026.08.25 › BOLUM_13']);
  });

  test('aksan ve büyük/küçük harf duyarsız', () => {
    expect(matchingFolders(d, normalizeForSearch('BÖLÜM 3')).map((x) => x.folder.name)).toEqual(['BOLUM_3']);
  });

  test('sistem klasörleri aranmaz', () => {
    expect(matchingFolders(d, 'spotlight')).toEqual([]);
  });
});

describe('biçimlendirme', () => {
  test('formatShortDate', () => {
    expect(formatShortDate(null)).toBe('—');
    expect(formatShortDate(new Date(2026, 9, 12, 14, 5).toISOString())).toBe('12.10.2026 14:05');
  });

  test('formatSpeed', () => {
    expect(formatSpeed(null)).toBe('—');
    expect(formatSpeed(199.6)).toBe('200 MB/s');
  });
});

import React from 'react';
import { act } from 'react-test-renderer';
import { Image } from 'react-native';
import { pressableWithText, render, texts } from '../test-utils/render';
import DiskDetailScreen from '../src/screens/DiskDetailScreen';
import AllDisksScreen from '../src/screens/AllDisksScreen';
import HomeScreen from '../src/screens/HomeScreen';
import type { DiskRow } from '../src/utils';

const DISK: DiskRow = {
  id: 'd1',
  name: 'ARC MASTER',
  qr_code_value: null,
  top_level_folders: [
    {
      name: 'NIGHT SHIFT',
      sizeBytes: 5e12,
      children: [{ name: '2026.08.25', sizeBytes: 1e12, children: [{ name: 'BOLUM_13', sizeBytes: 4e11 }] }],
    },
    { name: 'EMEKLI HIKAYELERI', sizeBytes: 2e12 },
  ],
  total_bytes: 8e12,
  free_bytes: 1e12,
  last_scanned_at: new Date(2026, 9, 12, 14, 5).toISOString(),
  read_speed_mbps: 200,
  write_speed_mbps: 180,
  speed_tested_at: null,
};

describe('DiskDetailScreen', () => {
  test('üst klasörler kapalı gelir, dokununca alt klasörler açılır', async () => {
    const r = await render(<DiskDetailScreen disk={DISK} onBack={() => {}} />);
    expect(texts(r.root)).toContain('NIGHT SHIFT');
    expect(texts(r.root)).not.toContain('2026.08.25');

    const row = pressableWithText(r.root, 'NIGHT SHIFT');
    await act(async () => row.props.onPress());
    expect(texts(r.root)).toContain('2026.08.25');

    await act(async () => row.props.onPress());
    expect(texts(r.root)).not.toContain('2026.08.25');
  });

  test('aramadan gelince bulunan klasöre kadar açık gelir', async () => {
    const r = await render(
      <DiskDetailScreen disk={DISK} focusPath={['NIGHT SHIFT', '2026.08.25', 'BOLUM_13']} onBack={() => {}} />
    );
    const all = texts(r.root);
    expect(all).toContain('BOLUM_13');
    expect(all).toContain('NIGHT SHIFT › 2026.08.25 › BOLUM_13');
  });

  test('son tarama ve hızlar görünür', async () => {
    const r = await render(<DiskDetailScreen disk={DISK} onBack={() => {}} />);
    const all = texts(r.root).join('\n');
    expect(all).toContain('SON TARAMA 12.10.2026 14:05');
    expect(all).toContain('OKUMA 200 MB/s · YAZMA 180 MB/s');
  });
});

describe('DiskDetailScreen · kullanılmıyor durumu', () => {
  test('kullanıcı rolünde durum düğmesi yok', async () => {
    const r = await render(<DiskDetailScreen disk={DISK} onBack={() => {}} />);
    expect(texts(r.root)).not.toContain('MARK AS RETIRED');
  });

  test('kullanılmayan olarak işaretle → kaydeder, düğme ve etiket değişir', async () => {
    const r = await render(<DiskDetailScreen disk={DISK} canEdit onBack={() => {}} />);
    expect(texts(r.root)).not.toContain('RETIRED');
    await act(async () => pressableWithText(r.root, 'MARK AS RETIRED').props.onPress());
    expect((globalThis as any).__lastUpdate).toEqual({ status: 'inactive' });
    expect(texts(r.root)).toContain('RETIRED');
    expect(texts(r.root)).toContain('MARK AS AVAILABLE');
  });

  test('kullanılmayan diskte notu gösterir, kullanılabilir yapılabilir', async () => {
    const r = await render(
      <DiskDetailScreen disk={{ ...DISK, status: 'inactive', notes: 'Bozuk, serviste' }} canEdit onBack={() => {}} />
    );
    expect(texts(r.root)).toContain('Bozuk, serviste');
    await act(async () => pressableWithText(r.root, 'MARK AS AVAILABLE').props.onPress());
    expect((globalThis as any).__lastUpdate).toEqual({ status: 'active' });
    expect(texts(r.root)).not.toContain('RETIRED');
  });

  test('yetki yoksa (RLS 0 satır) değişmiş gibi göstermez, uyarır', async () => {
    (globalThis as any).__mockUpdate = { data: [], error: null };
    const r = await render(<DiskDetailScreen disk={DISK} canEdit onBack={() => {}} />);
    await act(async () => pressableWithText(r.root, 'MARK AS RETIRED').props.onPress());
    expect(texts(r.root)).not.toContain('RETIRED');
    expect(texts(r.root)).toContain('Not saved: this action requires admin permission.');
  });
});

describe('AllDisksScreen', () => {
  beforeEach(() => {
    (globalThis as any).__mockDisks = [DISK, { ...DISK, id: 'd2', name: '2. Disk', top_level_folders: [] }];
  });

  test('satırda son tarama tarihi ve hızlar, sıralama baştaki sayıya göre', async () => {
    const r = await render(<AllDisksScreen onSelectDisk={() => {}} onBack={() => {}} />);
    const all = texts(r.root);
    expect(all.indexOf('2. Disk')).toBeLessThan(all.indexOf('ARC MASTER'));
    expect(all).toContain('TARAMA 12.10.2026 14:05');
    expect(all).toContain('O 200 MB/s · Y 180 MB/s');
  });

  test('kullanılmayan diskler ayrı, katlanmış bölümde', async () => {
    (globalThis as any).__mockDisks = [
      DISK,
      { ...DISK, id: 'd3', name: '7. Disk', status: 'inactive', notes: 'Kayıp', top_level_folders: [] },
    ];
    const r = await render(<AllDisksScreen onSelectDisk={() => {}} onBack={() => {}} />);
    expect(texts(r.root)).toContain('▸ RETIRED DRIVES (1)');
    expect(texts(r.root)).not.toContain('7. Disk');
    await act(async () => pressableWithText(r.root, '▸ RETIRED DRIVES (1)').props.onPress());
    const all = texts(r.root);
    expect(all).toContain('7. Disk');
    expect(all).toContain('Kayıp');
    expect(all.indexOf('ARC MASTER')).toBeLessThan(all.indexOf('7. Disk'));
  });

  test('arama kullanılmayan diskte eşleşirse bölüm kendiliğinden açılır', async () => {
    (globalThis as any).__mockDisks = [{ ...DISK, status: 'inactive' }];
    const r = await render(<AllDisksScreen initialQuery="night 13" onSelectDisk={() => {}} onBack={() => {}} />);
    expect(texts(r.root)).toContain('NIGHT SHIFT › 2026.08.25 › BOLUM_13');
  });

  test('aramada bulunan klasöre dokununca disk + klasör yolu + arama metni gider', async () => {
    const onSelect = jest.fn();
    const r = await render(<AllDisksScreen initialQuery="night 13" onSelectDisk={onSelect} onBack={() => {}} />);
    const match = pressableWithText(r.root, 'NIGHT SHIFT › 2026.08.25 › BOLUM_13');
    await act(async () => match.props.onPress());
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1' }),
      ['NIGHT SHIFT', '2026.08.25', 'BOLUM_13'],
      'night 13'
    );
  });
});

test('ana sayfada logo var', async () => {
  const r = await render(<HomeScreen onOpenDisks={() => {}} onOpenScan={() => {}} />);
  expect(r.root.findAllByType(Image)).toHaveLength(1);
});

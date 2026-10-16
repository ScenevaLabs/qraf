import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, RefreshControl, BackHandler } from 'react-native';
import { supabase } from '../supabaseClient';
import { colors } from '../theme';
import {
  formatBytes,
  formatShortDate,
  formatSpeed,
  isInactive,
  meterText,
  matchingFolders,
  naturalDiskCompare,
  normalizeForSearch,
  type FolderMatch,
  type DiskRow,
} from '../utils';

// `onSelectDisk`'in ikinci argümanı aramada bulunan klasörün yolu —
// detay ekranı o klasörü açık ve işaretli gösterir. Üçüncüsü o anki
// arama metni; detaydan dönünce arama kaybolmasın diye App saklar.
type Props = {
  initialQuery?: string;
  onSelectDisk: (disk: DiskRow, folderPath: string[] | undefined, query: string) => void;
  onBack: () => void;
};

const MAX_MATCHES_SHOWN = 6;

export default function AllDisksScreen({ initialQuery, onSelectDisk, onBack }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [disks, setDisks] = useState<DiskRow[]>([]);
  const [status, setStatus] = useState('Loading…');
  const [refreshing, setRefreshing] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('disks')
      .select(
        'id,name,notes,status,qr_code_value,top_level_folders,total_bytes,free_bytes,last_scanned_at,read_speed_mbps,write_speed_mbps,speed_tested_at'
      )
      .order('name');
    if (error) {
      setStatus(`Could not load: ${error.message}`);
      setDisks([]);
    } else {
      setDisks(((data as DiskRow[]) ?? []).sort(naturalDiskCompare));
      setStatus(data && data.length > 0 ? '' : 'No drives registered yet.');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Donanım geri tuşu: önce arama metni varsa onu temizle (listeye
  // dön), boşsa ana sayfaya çık. Aksi halde (BackHandler hiç
  // dinlenmezse) geri tuşu doğrudan uygulamadan çıkıyordu.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (query.trim()) {
        setQuery('');
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [query, onBack]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const q = normalizeForSearch(query.trim());
  type Row = { disk: DiskRow; nameMatch: boolean; folders: FolderMatch[] };
  const filter = (list: DiskRow[]): Row[] =>
    q
      ? list
          .map((d) => ({ disk: d, nameMatch: normalizeForSearch(d.name).includes(q), folders: matchingFolders(d, q) }))
          .filter((r) => r.nameMatch || r.folders.length > 0)
      : list.map((d) => ({ disk: d, nameMatch: true, folders: [] as FolderMatch[] }));

  // Kullanılmayan diskler ana listeyi kalabalıklaştırmasın diye en altta,
  // katlanmış bir bölümde (masaüstündeki gibi). Arama bunlarda da eşleşirse
  // bölüm kendiliğinden açılır — sonuç gizli kalmasın.
  const rows = filter(disks.filter((d) => !isInactive(d)));
  const inactiveAll = disks.filter(isInactive);
  const inactiveRows = filter(inactiveAll);
  const inactiveOpen = showInactive || (q !== '' && inactiveRows.length > 0);

  function renderRow({ disk, nameMatch, folders }: Row) {
    const inactive = isInactive(disk);
    return (
      <Pressable
        key={disk.id}
        style={[styles.row, inactive && styles.rowInactive]}
        onPress={() => onSelectDisk(disk, undefined, query)}
      >
        <View style={styles.rowTitle}>
          <Text style={[styles.rowName, inactive && styles.rowNameInactive]}>{disk.name}</Text>
          {inactive ? <Text style={styles.inactiveTag}>RETIRED</Text> : null}
        </View>
        {inactive && disk.notes && !(q && !nameMatch) ? <Text style={styles.rowNotes}>{disk.notes}</Text> : null}
        {!nameMatch && folders.length > 0 ? (
          <View style={styles.matches}>
            {folders.slice(0, MAX_MATCHES_SHOWN).map((m) => (
              <Pressable
                key={m.path.join('\u0000')}
                style={styles.matchRow}
                onPress={() => onSelectDisk(disk, m.path, query)}
                hitSlop={4}
              >
                <Text style={styles.matchPath}>{m.path.join(' › ')}</Text>
                <Text style={styles.matchSize}>{formatBytes(m.folder.sizeBytes)} ›</Text>
              </Pressable>
            ))}
            {folders.length > MAX_MATCHES_SHOWN ? (
              <Text style={styles.matchMore}>+{folders.length - MAX_MATCHES_SHOWN} more folders</Text>
            ) : null}
          </View>
        ) : null}
        <Text style={styles.rowMeter}>{meterText(disk.free_bytes, disk.total_bytes)}</Text>
        <Text style={styles.rowFree}>
          {formatBytes(disk.free_bytes)} free / {formatBytes(disk.total_bytes)}
        </Text>
        <View style={styles.rowFooter}>
          <Text style={styles.rowInfo}>SCANNED {formatShortDate(disk.last_scanned_at)}</Text>
          <Text style={styles.rowInfo}>
            R {formatSpeed(disk.read_speed_mbps)} · W {formatSpeed(disk.write_speed_mbps)}
          </Text>
        </View>
      </Pressable>
    );
  }

  const inactiveSection =
    inactiveAll.length > 0 && (!q || inactiveRows.length > 0) ? (
      <View style={styles.inactiveSection}>
        <Pressable style={styles.inactiveToggle} onPress={() => setShowInactive(!inactiveOpen)}>
          <Text style={styles.inactiveToggleText}>
            {inactiveOpen ? '▾' : '▸'} RETIRED DRIVES ({q ? inactiveRows.length : inactiveAll.length})
          </Text>
        </Pressable>
        {inactiveOpen ? inactiveRows.map(renderRow) : null}
      </View>
    ) : null;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹ HOME</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by drive or project name…"
          placeholderTextColor={colors.inkSoft}
        />
        {query.length > 0 ? (
          <Pressable style={styles.clearBtn} onPress={() => setQuery('')} hitSlop={12}>
            <Text style={styles.clearBtnText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.disk.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {status || (q ? 'No matching drive, project or folder.' : 'No drives in use.')}
          </Text>
        }
        ListFooterComponent={inactiveSection ?? undefined}
        renderItem={({ item }) => renderRow(item)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.kraft, padding: 16 },
  header: { marginBottom: 12 },
  back: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  searchRow: { position: 'relative', justifyContent: 'center', marginBottom: 12 },
  search: {
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: '#fff',
    color: colors.ink,
    padding: 12,
    paddingRight: 40,
    fontSize: 14,
  },
  clearBtn: { position: 'absolute', right: 10, padding: 4 },
  clearBtnText: { color: colors.inkSoft, fontSize: 16, fontWeight: '700' },
  empty: { color: colors.inkSoft, fontSize: 13, marginTop: 8 },
  row: {
    backgroundColor: colors.labelPaper,
    borderWidth: 1.5,
    borderColor: colors.perforation,
    padding: 12,
    marginBottom: 8,
  },
  rowInactive: { opacity: 0.75, borderStyle: 'dashed' },
  rowTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 },
  rowName: { flexShrink: 1, fontSize: 15, fontWeight: '700', color: colors.ink },
  rowNameInactive: { color: colors.inkSoft },
  inactiveTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.stampRed,
    borderWidth: 1.5,
    borderColor: colors.stampRed,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  rowNotes: { fontSize: 12, color: colors.inkSoft, fontStyle: 'italic', marginBottom: 4 },
  inactiveSection: { marginTop: 12, paddingBottom: 24 },
  inactiveToggle: { borderTopWidth: 2, borderTopColor: colors.ink, paddingVertical: 12 },
  inactiveToggleText: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.ink },
  matches: { marginBottom: 8, borderLeftWidth: 2, borderLeftColor: colors.stampRed, paddingLeft: 8 },
  matchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5, gap: 8 },
  matchPath: { flex: 1, fontSize: 12, color: colors.stampRed, fontWeight: '700' },
  matchSize: { fontFamily: 'monospace', fontSize: 11, color: colors.inkSoft },
  matchMore: { fontSize: 11, color: colors.inkSoft, paddingTop: 2 },
  rowMeter: { fontFamily: 'monospace', fontSize: 13, color: colors.ink },
  rowFree: { fontFamily: 'monospace', fontSize: 11, color: colors.inkSoft, marginTop: 2 },
  rowFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.perforation,
    borderStyle: 'dashed',
  },
  rowInfo: { fontFamily: 'monospace', fontSize: 10, color: colors.inkSoft },
});

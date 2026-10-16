import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, BackHandler, ActivityIndicator } from 'react-native';
import { supabase } from '../supabaseClient';
import { colors } from '../theme';
import {
  formatBytes,
  formatShortDate,
  formatSpeed,
  meterText,
  visibleFolders,
  type DiskFolder,
  type DiskRow,
} from '../utils';

// `focusPath`: aramada bulunan klasörün yolu — ağaç o klasöre kadar açık
// gelir, klasör işaretlenir ve listede ona kaydırılır.
// `canEdit`: yalnız admin'de durum düğmesi görünür (Faz 16).
type Props = { disk: DiskRow; focusPath?: string[]; canEdit?: boolean; onBack: () => void };

type TreeRow = { key: string; path: string[]; folder: DiskFolder; depth: number; hasChildren: boolean };

// Satır yüksekliği sabit; uzun adlar tek satırda ortadan kırpılır.
const ROW_HEIGHT = 44;
const KEY_SEP = '\u0000';

function pathKey(path: string[]): string {
  return path.join(KEY_SEP);
}

// Yalnız açık (expanded) klasörlerin çocuklarını içeren düz liste.
function flattenVisible(folders: DiskFolder[] | null | undefined, expanded: Set<string>, parent: string[] = []): TreeRow[] {
  const rows: TreeRow[] = [];
  for (const folder of visibleFolders(folders)) {
    const path = [...parent, folder.name];
    const key = pathKey(path);
    const children = visibleFolders(folder.children);
    rows.push({ key, path, folder, depth: parent.length, hasChildren: children.length > 0 });
    if (expanded.has(key)) rows.push(...flattenVisible(folder.children, expanded, path));
  }
  return rows;
}

function ancestorKeys(path: string[] | undefined): string[] {
  if (!path) return [];
  return path.slice(0, -1).map((_, i) => pathKey(path.slice(0, i + 1)));
}

export default function DiskDetailScreen({ disk, focusPath, canEdit = false, onBack }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorKeys(focusPath)));
  const rows = useMemo(() => flattenVisible(disk.top_level_folders, expanded), [disk.top_level_folders, expanded]);
  const focusKey = focusPath ? pathKey(focusPath) : undefined;
  const focusIndex = focusKey ? rows.findIndex((r) => r.key === focusKey) : -1;
  const listRef = useRef<FlatList<TreeRow>>(null);
  const [status, setStatus] = useState(disk.status === 'inactive' ? 'inactive' : 'active');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState('');
  const inactive = status === 'inactive';
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollRetries = useRef(0);

  function scrollToFocus(index: number, delay: number) {
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(
      () => listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }),
      delay
    );
  }

  useEffect(() => {
    // Yalnız ilk açılışta kaydır; kullanıcı ağacı açıp kapadıkça değil.
    if (focusIndex >= 0) scrollToFocus(focusIndex, 0);
    return () => clearTimeout(scrollTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BackHandler olmadan donanım geri tuşu bu ekranda doğrudan
  // uygulamadan çıkıyordu — üstteki "GERİ" butonuyla aynı işi yapsın.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  // Supabase RLS'te yalnız admin disk güncelleyebilir; yetkisiz
  // güncelleme hata vermeden 0 satır döndürür — bu yüzden dönen satıra
  // bakılıyor, yoksa "yetki yok" deniyor. Liste, geri dönülünce
  // Supabase'den yeniden yüklendiği için ayrıca haber vermeye gerek yok.
  async function toggleStatus() {
    const next = inactive ? 'active' : 'inactive';
    setStatusBusy(true);
    setStatusError('');
    const { data, error } = await supabase.from('disks').update({ status: next }).eq('id', disk.id).select('id');
    setStatusBusy(false);
    if (error) {
      setStatusError(`Could not save: ${error.message}`);
    } else if (!data || data.length === 0) {
      setStatusError('Not saved: this action requires admin permission.');
    } else {
      setStatus(next);
    }
  }

  function toggle(row: TreeRow) {
    if (!row.hasChildren) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) {
        // Kapatılan klasörün açık alt klasörleri de kapansın.
        for (const k of prev) if (k === row.key || k.startsWith(row.key + KEY_SEP)) next.delete(k);
      } else {
        next.add(row.key);
      }
      return next;
    });
  }

  const header = (
    <View>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.back}>‹ BACK</Text>
        </Pressable>
      </View>

      <Text style={styles.name}>{disk.name}</Text>
      {inactive ? (
        <View style={styles.inactiveBanner}>
          <Text style={styles.inactiveTag}>RETIRED</Text>
          {disk.notes ? <Text style={styles.inactiveNotes}>{disk.notes}</Text> : null}
        </View>
      ) : null}

      <View style={styles.summaryCard}>
        <Text style={styles.meter}>{meterText(disk.free_bytes, disk.total_bytes)}</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.freeText}>{formatBytes(disk.free_bytes)} FREE</Text>
          <Text style={styles.totalText}>/ {formatBytes(disk.total_bytes)} total</Text>
        </View>
        <View style={styles.infoBlock}>
          <Text style={styles.infoText}>LAST SCAN {formatShortDate(disk.last_scanned_at)}</Text>
          <Text style={styles.infoText}>
            READ {formatSpeed(disk.read_speed_mbps)} · WRITE {formatSpeed(disk.write_speed_mbps)}
          </Text>
          {disk.speed_tested_at ? (
            <Text style={styles.infoText}>SPEED TEST {formatShortDate(disk.speed_tested_at)}</Text>
          ) : null}
        </View>
      </View>

      {canEdit ? (
        <Pressable
          style={[styles.statusBtn, inactive && styles.statusBtnInactive]}
          onPress={toggleStatus}
          disabled={statusBusy}
        >
          {statusBusy ? (
            <ActivityIndicator color={inactive ? colors.labelPaper : colors.ink} />
          ) : (
            <Text style={[styles.statusBtnText, inactive && styles.statusBtnTextInactive]}>
              {inactive ? 'MARK AS AVAILABLE' : 'MARK AS RETIRED'}
            </Text>
          )}
        </Pressable>
      ) : null}
      {statusError ? <Text style={styles.statusError}>{statusError}</Text> : null}

      {focusPath ? (
        <View style={styles.foundBox}>
          <Text style={styles.foundLabel}>FOUND IN SEARCH</Text>
          <Text style={styles.foundPath}>{focusPath.join(' › ')}</Text>
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>FOLDERS</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.key}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={styles.empty}>No folder info.</Text>}
        // Satır henüz çizilmediyse önce yaklaşık konuma kay, sonra birkaç
        // kez yeniden dene (sınırsız denerse ekran kapanınca bile döner).
        onScrollToIndexFailed={(info) => {
          if (scrollRetries.current >= 3) return;
          scrollRetries.current += 1;
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          scrollToFocus(info.index, 100);
        }}
        renderItem={({ item }) => {
          const isOpen = expanded.has(item.key);
          const isFocus = item.key === focusKey;
          return (
            <Pressable
              style={[styles.folderRow, { paddingLeft: 4 + item.depth * 16 }, isFocus && styles.folderRowFocus]}
              onPress={() => toggle(item)}
            >
              <Text style={styles.chevron}>{item.hasChildren ? (isOpen ? '▾' : '▸') : ' '}</Text>
              <Text
                style={[styles.folderName, item.depth === 0 && styles.folderNameTop, isFocus && styles.folderNameFocus]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {item.folder.name}
              </Text>
              <Text style={styles.folderSize}>{formatBytes(item.folder.sizeBytes)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.kraft, paddingHorizontal: 20, paddingTop: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  back: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  name: { fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  summaryCard: {
    backgroundColor: colors.labelPaper,
    borderWidth: 2,
    borderColor: colors.ink,
    padding: 16,
    marginBottom: 16,
  },
  meter: { fontFamily: 'monospace', fontSize: 16, color: colors.ink },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  freeText: { fontFamily: 'monospace', fontWeight: '700', fontSize: 15, color: colors.ink },
  totalText: { fontFamily: 'monospace', fontSize: 12, color: colors.inkSoft },
  infoBlock: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.perforation,
    borderStyle: 'dashed',
    gap: 2,
  },
  infoText: { fontFamily: 'monospace', fontSize: 11, color: colors.inkSoft },
  inactiveBanner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  inactiveTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.stampRed,
    borderWidth: 2,
    borderColor: colors.stampRed,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inactiveNotes: { flexShrink: 1, fontSize: 12, color: colors.inkSoft, fontStyle: 'italic' },
  statusBtn: {
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.labelPaper,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 46,
    justifyContent: 'center',
  },
  statusBtnInactive: { backgroundColor: colors.ink },
  statusBtnText: { color: colors.ink, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  statusBtnTextInactive: { color: colors.labelPaper },
  statusError: { color: colors.stampRed, fontSize: 12, marginTop: -8, marginBottom: 16 },
  foundBox: { borderLeftWidth: 3, borderLeftColor: colors.stampRed, paddingLeft: 10, marginBottom: 16 },
  foundLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.stampRed },
  foundPath: { fontSize: 13, fontWeight: '700', color: colors.ink, marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.inkSoft, marginBottom: 4 },
  folderRow: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.perforation,
  },
  folderRowFocus: { backgroundColor: colors.labelPaper },
  chevron: { width: 18, color: colors.inkSoft, fontSize: 13 },
  folderName: { flex: 1, color: colors.ink, fontSize: 14, marginRight: 8 },
  folderNameTop: { fontWeight: '700' },
  folderNameFocus: { color: colors.stampRed, fontWeight: '700' },
  folderSize: { color: colors.inkSoft, fontFamily: 'monospace', fontSize: 12 },
  empty: { color: colors.inkSoft, fontSize: 13 },
});

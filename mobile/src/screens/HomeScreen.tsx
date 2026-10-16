import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Image } from 'react-native';
import { colors } from '../theme';

type Props = {
  onOpenDisks: (initialQuery?: string) => void;
  onOpenScan: () => void;
  // Yalnız admin'e verilir; yoksa USERS düğmesi görünmez.
  onOpenUsers?: () => void;
  accountEmail?: string;
  roleLabel?: string;
  onSignOut?: () => void;
};

export default function HomeScreen({ onOpenDisks, onOpenScan, onOpenUsers, accountEmail, roleLabel, onSignOut }: Props) {
  const [query, setQuery] = useState('');

  function submitSearch() {
    onOpenDisks(query.trim() || undefined);
  }

  return (
    <View style={styles.screen}>
      <Image source={require('../assets/logo.png')} style={styles.logo} resizeMode="contain" />

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submitSearch}
        placeholder="Search by drive or project name…"
        placeholderTextColor={colors.inkSoft}
        returnKeyType="search"
      />
      {query.trim() ? (
        <Pressable style={styles.searchGoBtn} onPress={submitSearch}>
          <Text style={styles.searchGoText}>SEARCH</Text>
        </Pressable>
      ) : null}

      <View style={styles.buttons}>
        <Pressable style={styles.btnPrimary} onPress={() => onOpenDisks()}>
          <Text style={styles.btnPrimaryText}>MY DRIVES</Text>
        </Pressable>
        <Pressable style={styles.btnSecondary} onPress={onOpenScan}>
          <Text style={styles.btnSecondaryText}>SCAN QR</Text>
        </Pressable>
        {onOpenUsers ? (
          <Pressable style={styles.btnLink} onPress={onOpenUsers}>
            <Text style={styles.btnLinkText}>USERS</Text>
          </Pressable>
        ) : null}
      </View>

      {onSignOut ? (
        <View style={styles.account}>
          <View style={styles.accountInfo}>
            <Text style={styles.accountEmail} numberOfLines={1}>
              {accountEmail}
            </Text>
            {roleLabel ? <Text style={styles.accountRole}>{roleLabel}</Text> : null}
          </View>
          <Pressable style={styles.signOutBtn} onPress={onSignOut} testID="sign-out-btn">
            <Text style={styles.signOutText}>SIGN OUT</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.kraft, padding: 24, justifyContent: 'center' },
  // Uygulama ikonundaki etiket (mobile/icon/logo.svg → render.sh).
  logo: { width: 200, height: 164, alignSelf: 'center', marginBottom: 32 },
  search: {
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: '#fff',
    color: colors.ink,
    padding: 12,
    fontSize: 14,
    marginBottom: 10,
  },
  searchGoBtn: { alignSelf: 'flex-end', paddingHorizontal: 14, paddingVertical: 8, marginBottom: 22 },
  searchGoText: { color: colors.ink, fontWeight: '700', fontSize: 12, letterSpacing: 1, textDecorationLine: 'underline' },
  buttons: { gap: 12, marginTop: 12 },
  btnPrimary: { backgroundColor: colors.ink, padding: 18, alignItems: 'center' },
  btnPrimaryText: { color: colors.labelPaper, fontWeight: '700', letterSpacing: 1, fontSize: 15 },
  btnSecondary: {
    backgroundColor: colors.labelPaper,
    borderWidth: 2,
    borderColor: colors.ink,
    padding: 18,
    alignItems: 'center',
  },
  btnLink: { alignItems: 'center', paddingVertical: 12 },
  btnLinkText: { color: colors.ink, fontWeight: '700', letterSpacing: 1, fontSize: 13, textDecorationLine: 'underline' },
  btnSecondaryText: { color: colors.ink, fontWeight: '700', letterSpacing: 1, fontSize: 15 },
  // Ekranın altına sabit: hangi hesapla girildiği + çıkış.
  account: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    borderTopWidth: 1.5,
    borderTopColor: colors.ink,
  },
  accountInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountEmail: { flexShrink: 1, color: colors.ink, fontSize: 12 },
  accountRole: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    paddingHorizontal: 5,
    paddingVertical: 1,
    color: colors.ink,
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1,
  },
  signOutBtn: { borderWidth: 2, borderColor: colors.ink, paddingHorizontal: 12, paddingVertical: 8 },
  signOutText: { color: colors.ink, fontWeight: '700', letterSpacing: 1, fontSize: 12 },
});

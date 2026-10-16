/**
 * qRaf mobil uygulaması — QR okuma + disk envanteri görüntüleme.
 * @format
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, BackHandler } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './src/supabaseClient';
import { colors } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ScanScreen from './src/screens/ScanScreen';
import AllDisksScreen from './src/screens/AllDisksScreen';
import DiskDetailScreen from './src/screens/DiskDetailScreen';
import UsersScreen from './src/screens/UsersScreen';
import type { DiskRow } from './src/utils';

type Screen = 'home' | 'scan' | 'disks' | 'users';
// Faz 16. `undefined`: henüz yüklenmedi. Asıl yetki Supabase RLS'te;
// rol yalnız kullanıcının yapamayacağı işlerin düğmelerini gizler.
type Role = 'admin' | 'standart';

function AppContent() {
  const insets = useSafeAreaInsets();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>('home');
  const [disksQuery, setDisksQuery] = useState<string | undefined>(undefined);
  const [selectedDisk, setSelectedDisk] = useState<DiskRow | null>(null);
  const [focusPath, setFocusPath] = useState<string[] | undefined>(undefined);
  const [role, setRole] = useState<Role | undefined>(undefined);
  const [loginNotice, setLoginNotice] = useState<{ text: string; error: boolean } | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Oturum açılınca rol okunur. Profili olmayan hesap (çıkarılmış
  // kullanıcı) oturumdan atılır.
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId) {
      setRole(undefined);
      return;
    }
    let cancelled = false;
    supabase
      .from('profiles')
      .select('role,email')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setRole('standart'); // ağ hatası: en kısıtlı rolle devam
        } else if (!data) {
          setLoginNotice({ text: 'This account has no access to qRaf. Ask your admin for an invitation.', error: true });
          supabase.auth.signOut();
        } else {
          setRole(data.role === 'admin' ? 'admin' : 'standart');
          setLoginNotice(undefined);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Ana sayfada donanım geri tuşu varsayılan (uygulamadan çık) davranışta
  // kalsın diye bilinçli olarak burada bir BackHandler yok — alt
  // ekranlar (ScanScreen/AllDisksScreen/DiskDetailScreen) kendi geri
  // tuşlarını yakalayıp buraya (Ana Sayfa'ya) döner.
  useEffect(() => {
    if (screen !== 'home') return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => false);
    return () => sub.remove();
  }, [screen]);

  // Yetkisiz/giriş yapılmamış durumda hiçbir disk verisi gösterilmez —
  // oturum yoksa tek görülebilecek şey giriş ekranıdır.
  if (session === undefined || (session && role === undefined)) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (!session) {
    return <LoginScreen notice={loginNotice?.text} noticeIsError={loginNotice?.error} />;
  }

  async function signOut() {
    // Bir sonraki giriş ana sayfadan, temiz başlasın.
    setSelectedDisk(null);
    setFocusPath(undefined);
    setDisksQuery(undefined);
    setScreen('home');
    const { error } = await supabase.auth.signOut();
    // Ağ yoksa sunucudaki oturum kapanmamış olabilir; telefonda yine de kapat.
    if (error) await supabase.auth.signOut({ scope: 'local' });
    setLoginNotice({ text: 'Signed out.', error: false });
    setSession(null);
  }

  function openDisks(initialQuery?: string) {
    setDisksQuery(initialQuery);
    setScreen('disks');
  }

  function selectDisk(disk: DiskRow, folderPath?: string[], query?: string) {
    if (query !== undefined) setDisksQuery(query.trim() || undefined);
    setFocusPath(folderPath);
    setSelectedDisk(disk);
  }

  function closeDisk() {
    setSelectedDisk(null);
    setFocusPath(undefined);
  }

  function goHome() {
    setDisksQuery(undefined);
    setScreen('home');
  }

  if (selectedDisk) {
    return (
      <View style={[styles.fill, { paddingTop: insets.top }]}>
        <DiskDetailScreen disk={selectedDisk} focusPath={focusPath} canEdit={role === 'admin'} onBack={closeDisk} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      {screen === 'home' ? (
        <HomeScreen
          onOpenDisks={openDisks}
          onOpenScan={() => setScreen('scan')}
          onOpenUsers={role === 'admin' ? () => setScreen('users') : undefined}
          accountEmail={session.user?.email ?? ''}
          roleLabel={role === 'admin' ? 'ADMIN' : 'USER'}
          onSignOut={signOut}
        />
      ) : screen === 'users' ? (
        <UsersScreen onBack={goHome} />
      ) : screen === 'scan' ? (
        <ScanScreen onDiskFound={(disk) => selectDisk(disk)} onBack={goHome} />
      ) : (
        <AllDisksScreen initialQuery={disksQuery} onSelectDisk={selectDisk} onBack={goHome} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.kraft },
});

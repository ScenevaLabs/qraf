import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PermissionsAndroid, Platform, ActivityIndicator, BackHandler } from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { supabase } from '../supabaseClient';
import { colors } from '../theme';
import type { DiskRow } from '../utils';

type Props = { onDiskFound: (disk: DiskRow) => void; onBack: () => void };

export default function ScanScreen({ onDiskFound, onBack }: Props) {
  const [permission, setPermission] = useState<'checking' | 'granted' | 'denied'>('checking');
  const [status, setStatus] = useState('');
  const busyRef = useRef(false);

  // BackHandler olmadan donanım geri tuşu bu ekranda doğrudan
  // uygulamadan çıkıyordu — ana sayfaya dönsün.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  useEffect(() => {
    (async () => {
      if (Platform.OS !== 'android') {
        setPermission('granted');
        return;
      }
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera permission',
        message: 'qRaf needs camera access to scan QR codes.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      });
      setPermission(granted === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
    })();
  }, []);

  async function handleReadCode(value: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus('Searching…');
    const { data, error } = await supabase.from('disks').select('*').eq('qr_code_value', value).maybeSingle();
    if (error) {
      setStatus(error.message);
    } else if (!data) {
      setStatus('No drive record found for this QR code.');
    } else {
      setStatus('');
      onDiskFound(data as DiskRow);
      return; // ekran değişecek, busy kilidini serbest bırakmaya gerek yok
    }
    setTimeout(() => {
      busyRef.current = false;
    }, 1500);
  }

  if (permission === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.ink} />
      </View>
    );
  }

  if (permission === 'denied') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Camera access was denied. Allow it in Settings to scan QR codes.</Text>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>‹ HOME</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Camera
        style={StyleSheet.absoluteFill}
        scanBarcode
        onReadCode={(event) => handleReadCode(event.nativeEvent.codeStringValue)}
        showFrame
        laserColor={colors.stampRed}
        frameColor={colors.labelPaper}
        barcodeFrameSize={{ width: 260, height: 260 }}
      />
      <Pressable onPress={onBack} style={styles.topBar} hitSlop={12}>
        <Text style={styles.topBarText}>‹ HOME</Text>
      </Pressable>
      <View style={styles.overlay} pointerEvents="none">
        <Text style={styles.instruction}>ALIGN THE QR CODE ON THE DRIVE INSIDE THE SQUARE</Text>
      </View>
      {status ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.kraft, padding: 24 },
  message: { color: colors.ink, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  backBtn: { padding: 10 },
  backBtnText: { color: colors.ink, fontWeight: '700', fontSize: 14 },
  topBar: { position: 'absolute', top: 14, left: 14, padding: 8 },
  topBarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  overlay: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center', paddingHorizontal: 24 },
  instruction: { color: '#fff', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  statusBar: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: colors.ink, padding: 10 },
  statusText: { color: colors.labelPaper, textAlign: 'center', fontSize: 13 },
});

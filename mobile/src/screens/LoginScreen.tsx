import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { supabase } from '../supabaseClient';
import { colors } from '../theme';

// `notice`: App'ten gelen mesaj (ör. hesabı kaldırılmış kullanıcı ya da
// "Signed out."). `noticeIsError` false ise uyarı renginde değil.
export default function LoginScreen({ notice, noticeIsError = true }: { notice?: string; noticeIsError?: boolean }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(notice ?? '');
  const [isError, setIsError] = useState(!!notice && noticeIsError);

  async function sendCode() {
    if (!email.trim()) {
      setIsError(true);
      setStatus('Enter an email address.');
      return;
    }
    setBusy(true);
    setIsError(false);
    setStatus('Sending…');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      // Davetli yeni çalışan ilk girişte hesap açabilsin; davetsiz
      // e-postayı veritabanı reddediyor (handle_new_user, Faz 16).
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setIsError(true);
      setStatus(
        /database error/i.test(error.message)
          ? 'There is no invitation for this email. Ask your admin for one.'
          : error.message
      );
      return;
    }
    setStep('code');
    setIsError(false);
    setStatus('Code sent. Check your inbox.');
  }

  async function verifyCode() {
    if (!code.trim()) {
      setIsError(true);
      setStatus('Enter the code.');
      return;
    }
    setBusy(true);
    setIsError(false);
    setStatus('Verifying…');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'email',
    });
    setBusy(false);
    if (error) {
      setIsError(true);
      setStatus(error.message);
    }
    // Başarılıysa App.tsx'teki onAuthStateChange dinleyicisi devreye girer.
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.wordmark}>qRAF</Text>

        {step === 'email' ? (
          <>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="admin@company.com"
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              keyboardType="email-address"
              editable={!busy}
            />
            <Pressable style={styles.btnPrimary} onPress={sendCode} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.labelPaper} /> : <Text style={styles.btnPrimaryText}>SEND CODE</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.hint}>Code sent to {email}.</Text>
            <Text style={styles.label}>6-DIGIT CODE</Text>
            <TextInput
              style={[styles.input, styles.inputMono]}
              value={code}
              onChangeText={setCode}
              placeholder="000000"
              placeholderTextColor={colors.inkSoft}
              keyboardType="number-pad"
              maxLength={6}
              editable={!busy}
            />
            <Pressable style={styles.btnPrimary} onPress={verifyCode} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.labelPaper} /> : <Text style={styles.btnPrimaryText}>SIGN IN</Text>}
            </Pressable>
            <Pressable
              onPress={() => {
                setStep('email');
                setCode('');
                setStatus('');
              }}
            >
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </>
        )}

        {status ? <Text style={[styles.status, { color: isError ? colors.stampRed : colors.inkSoft }]}>{status}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.kraft, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.labelPaper,
    borderWidth: 2,
    borderColor: colors.perforation,
    borderStyle: 'dashed',
    padding: 28,
    gap: 14,
  },
  wordmark: { fontSize: 28, fontWeight: '700', letterSpacing: 2, color: colors.ink, textAlign: 'center', marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.inkSoft, marginBottom: 4 },
  hint: { fontSize: 13, color: colors.inkSoft, marginBottom: 8 },
  input: {
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: '#fff',
    color: colors.ink,
    padding: 12,
    fontSize: 15,
    marginBottom: 10,
  },
  inputMono: { fontFamily: 'monospace', letterSpacing: 4, textAlign: 'center', fontSize: 20 },
  btnPrimary: { backgroundColor: colors.ink, padding: 14, alignItems: 'center', marginBottom: 6 },
  btnPrimaryText: { color: colors.labelPaper, fontWeight: '700', letterSpacing: 1 },
  link: { color: colors.inkSoft, fontSize: 12, textDecorationLine: 'underline', textAlign: 'center', marginTop: 4 },
  status: { fontSize: 12, textAlign: 'center', marginTop: 8 },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, BackHandler, ActivityIndicator } from 'react-native';
import { supabase } from '../supabaseClient';
import { colors } from '../theme';

// Faz 16 — kullanıcı yönetimi (yalnız admin açar; masaüstündeki
// USERS sekmesiyle aynı işler). Davet: invitations'a satır; kişi
// ilk girişte (OTP) hesabını açar, rolü davetten alır. Çıkarma:
// admin_remove_user() auth hesabını siler.

type Role = 'admin' | 'standart';
type Profile = { id: string; email: string | null; role: Role };
type Invitation = { id: string; email: string; role: Role };

const ROLE_LABELS: Record<Role, string> = { admin: 'ADMIN', standart: 'USER' };

export function friendlyDbError(message: string): string {
  if (/last admin/.test(message)) return 'The organization must keep at least one admin.';
  if (/duplicate key|invitations_email_key/.test(message)) return 'This email has already been invited.';
  return message.replace(/^qraf:\s*/, '');
}

function RoleToggle({
  value,
  disabled,
  onChange,
  testID,
}: {
  value: Role;
  disabled?: boolean;
  onChange?: (r: Role) => void;
  testID?: string;
}) {
  return (
    <View style={styles.roleToggle}>
      {(['standart', 'admin'] as Role[]).map((r) => (
        <Pressable
          key={r}
          testID={testID ? `${testID}-${r}` : undefined}
          style={[styles.roleChip, value === r && styles.roleChipOn, disabled && styles.roleChipDisabled]}
          onPress={() => !disabled && value !== r && onChange?.(r)}
          disabled={disabled}
        >
          <Text style={[styles.roleChipText, value === r && styles.roleChipTextOn]}>{ROLE_LABELS[r]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// İlk dokunuşta "ARE YOU SURE?", ikincisinde işlem; 4 sn içinde vazgeçilir.
function ConfirmButton({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function press() {
    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    clearTimeout(timer.current);
    setBusy(true);
    await onConfirm();
    setBusy(false);
    setArmed(false);
  }
  return (
    <Pressable style={[styles.dangerBtn, armed && styles.dangerBtnArmed]} onPress={press} disabled={busy}>
      <Text style={[styles.dangerBtnText, armed && styles.dangerBtnTextArmed]}>{armed ? `ARE YOU SURE? ${label}` : label}</Text>
    </Pressable>
  );
}

export default function UsersScreen({ onBack }: { onBack: () => void }) {
  const [myId, setMyId] = useState<string | undefined>(undefined);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('standart');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    setMyId(userData?.user?.id);
    const [p, i] = await Promise.all([
      supabase.from('profiles').select('id,email,role').order('email'),
      supabase.from('invitations').select('id,email,role').order('created_at', { ascending: false }),
    ]);
    setLoading(false);
    if (p.error) {
      setLoadError(`Could not load: ${p.error.message}`);
      return;
    }
    setLoadError('');
    setProfiles((p.data as Profile[]) ?? []);
    setInvites(i.error ? [] : ((i.data as Invitation[]) ?? []));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const setRowError = (id: string, msg: string) => setRowErrors((prev) => ({ ...prev, [id]: msg }));

  async function invite() {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setInviteMsg({ text: 'Enter a valid email address.', error: true });
      return;
    }
    if (profiles.some((p) => p.email === clean)) {
      setInviteMsg({ text: 'This email already has an account.', error: true });
      return;
    }
    setInviteBusy(true);
    const { error } = await supabase.from('invitations').insert({ email: clean, role: inviteRole });
    setInviteBusy(false);
    if (error) {
      setInviteMsg({ text: friendlyDbError(error.message), error: true });
      return;
    }
    setInviteMsg({ text: `${clean} has been invited. They can install qRaf and sign in with this email.`, error: false });
    setEmail('');
    setInviteRole('standart');
    load();
  }

  async function changeRole(p: Profile, role: Role) {
    const { data, error } = await supabase.from('profiles').update({ role }).eq('id', p.id).select('id');
    if (error || !data || data.length === 0) {
      setRowError(p.id, error ? friendlyDbError(error.message) : 'Kaydedilemedi.');
      return;
    }
    setRowError(p.id, '');
    setProfiles((prev) => prev.map((x) => (x.id === p.id ? { ...x, role } : x)));
  }

  async function removeUser(p: Profile) {
    const { error } = await supabase.rpc('admin_remove_user', { target: p.id });
    if (error) {
      setRowError(p.id, friendlyDbError(error.message));
      return;
    }
    setProfiles((prev) => prev.filter((x) => x.id !== p.id));
  }

  async function cancelInvite(inv: Invitation) {
    const { error } = await supabase.from('invitations').delete().eq('id', inv.id);
    if (error) {
      setRowError(inv.id, friendlyDbError(error.message));
      return;
    }
    setInvites((prev) => prev.filter((x) => x.id !== inv.id));
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable onPress={onBack} hitSlop={8}>
        <Text style={styles.back}>‹ HOME</Text>
      </Pressable>
      <Text style={styles.title}>USERS</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>INVITE A USER</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="employee@company.com"
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <RoleToggle value={inviteRole} onChange={setInviteRole} />
        <Pressable style={styles.primaryBtn} onPress={invite} disabled={inviteBusy}>
          {inviteBusy ? <ActivityIndicator color={colors.labelPaper} /> : <Text style={styles.primaryBtnText}>INVITE</Text>}
        </Pressable>
        {inviteMsg ? <Text style={[styles.msg, inviteMsg.error && styles.msgError]}>{inviteMsg.text}</Text> : null}
        <Text style={styles.hint}>
          The invited person installs qRaf and signs in with this email; their account is created with the 6-digit code sent to them.
          USER can only view drives. ADMIN adds, renames and retires drives and manages users.
        </Text>
      </View>

      <Text style={styles.sectionLabel}>USERS</Text>
      {loading ? <ActivityIndicator color={colors.ink} /> : null}
      {loadError ? <Text style={[styles.msg, styles.msgError]}>{loadError}</Text> : null}
      {profiles.map((p) => {
        const me = p.id === myId;
        return (
          <View key={p.id} style={styles.row}>
            <View style={styles.rowHead}>
              <Text style={styles.rowEmail} numberOfLines={1} ellipsizeMode="middle">
                {p.email ?? '(no email)'}
              </Text>
              {me ? <Text style={styles.tag}>YOU</Text> : null}
            </View>
            <View style={styles.rowActions}>
              <RoleToggle value={p.role} disabled={me} onChange={(r) => changeRole(p, r)} testID={`role-${p.id}`} />
              {me ? null : <ConfirmButton label="REMOVE" onConfirm={() => removeUser(p)} />}
            </View>
            {rowErrors[p.id] ? <Text style={[styles.msg, styles.msgError]}>{rowErrors[p.id]}</Text> : null}
          </View>
        );
      })}

      {invites.length > 0 ? <Text style={styles.sectionLabel}>PENDING INVITATIONS</Text> : null}
      {invites.map((inv) => (
        <View key={inv.id} style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowEmail} numberOfLines={1} ellipsizeMode="middle">
              {inv.email}
            </Text>
          </View>
          <View style={styles.rowActions}>
            <Text style={styles.tag}>{ROLE_LABELS[inv.role]} · AWAITING SIGN-IN</Text>
            <ConfirmButton label="CANCEL" onConfirm={() => cancelInvite(inv)} />
          </View>
          {rowErrors[inv.id] ? <Text style={[styles.msg, styles.msgError]}>{rowErrors[inv.id]}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.kraft },
  content: { padding: 16, paddingBottom: 40 },
  back: { color: colors.ink, fontWeight: '700', fontSize: 14, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  card: {
    backgroundColor: colors.labelPaper,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.perforation,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  cardTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 1, color: colors.ink },
  input: {
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: '#fff',
    color: colors.ink,
    padding: 12,
    fontSize: 14,
  },
  roleToggle: { flexDirection: 'row' },
  roleChip: { borderWidth: 1.5, borderColor: colors.ink, paddingHorizontal: 10, paddingVertical: 6, marginRight: -1.5 },
  roleChipOn: { backgroundColor: colors.ink },
  roleChipDisabled: { opacity: 0.5 },
  roleChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.ink },
  roleChipTextOn: { color: colors.labelPaper },
  primaryBtn: { backgroundColor: colors.ink, padding: 14, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  primaryBtnText: { color: colors.labelPaper, fontWeight: '700', letterSpacing: 1, fontSize: 14 },
  msg: { fontSize: 12, color: colors.inkSoft },
  msgError: { color: colors.stampRed },
  hint: { fontSize: 12, color: colors.inkSoft, lineHeight: 17 },
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1, color: colors.inkSoft, marginBottom: 8, marginTop: 4 },
  row: {
    backgroundColor: colors.labelPaper,
    borderWidth: 1.5,
    borderColor: colors.perforation,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowEmail: { flex: 1, fontFamily: 'monospace', fontSize: 13, color: colors.ink },
  rowActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  tag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    color: colors.inkSoft,
    borderWidth: 1.5,
    borderColor: colors.inkSoft,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  dangerBtn: { borderWidth: 1.5, borderColor: colors.stampRed, paddingHorizontal: 10, paddingVertical: 6 },
  dangerBtnArmed: { backgroundColor: colors.stampRed },
  dangerBtnText: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.stampRed },
  dangerBtnTextArmed: { color: colors.labelPaper },
});

import React from 'react';
import { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import App from '../App';
import UsersScreen from '../src/screens/UsersScreen';
import { pressableWithText, render, texts } from '../test-utils/render';

const g = globalThis as any;

function seed(myRole: 'admin' | 'standart') {
  g.__mockSession = { user: { id: 'me', email: 'yonetici@example.com' } };
  g.__mockDb = {
    profiles: [
      { id: 'me', email: 'yonetici@example.com', role: myRole },
      { id: 'u2', email: 'ekip@example.com', role: 'standart' },
    ],
    invitations: [{ id: 'i1', email: 'yeni@example.com', role: 'standart' }],
    disks: [],
  };
}

const calls = () => (g.__calls ?? []) as any[];

describe('UsersScreen', () => {
  beforeEach(() => seed('admin'));

  test('kullanıcılar ve bekleyen davetler listelenir; kendi satırında REMOVE yok', async () => {
    const r = await render(<UsersScreen onBack={() => {}} />);
    const all = texts(r.root);
    expect(all).toContain('yonetici@example.com');
    expect(all).toContain('ekip@example.com');
    expect(all).toContain('YOU');
    expect(all).toContain('yeni@example.com');
    expect(all).toContain('USER · AWAITING SIGN-IN');
    expect(all.filter((t) => t === 'REMOVE')).toHaveLength(1);
  });

  test('davet küçük harfle ve seçilen rolle kaydedilir', async () => {
    const r = await render(<UsersScreen onBack={() => {}} />);
    await act(async () => r.root.findByType(TextInput).props.onChangeText('  Usta@Example.com '));
    await act(async () => pressableWithText(r.root, 'ADMIN').props.onPress());
    await act(async () => pressableWithText(r.root, 'INVITE').props.onPress());
    expect(calls()).toContainEqual(
      expect.objectContaining({ table: 'invitations', op: 'insert', values: { email: 'usta@example.com', role: 'admin' } })
    );
    expect(texts(r.root)).toContain("usta@example.com has been invited. They can install qRaf and sign in with this email.");
  });

  test('hesabı olan e-postaya davet gönderilmez', async () => {
    const r = await render(<UsersScreen onBack={() => {}} />);
    await act(async () => r.root.findByType(TextInput).props.onChangeText('ekip@example.com'));
    await act(async () => pressableWithText(r.root, 'INVITE').props.onPress());
    expect(texts(r.root)).toContain('This email already has an account.');
    expect(calls().some((c) => c.op === 'insert')).toBe(false);
  });

  test('çıkarma iki dokunuşla onaylanır ve admin_remove_user çağrılır', async () => {
    const r = await render(<UsersScreen onBack={() => {}} />);
    await act(async () => pressableWithText(r.root, 'REMOVE').props.onPress());
    expect(calls().some((c) => c.rpc)).toBe(false);
    await act(async () => pressableWithText(r.root, 'ARE YOU SURE? REMOVE').props.onPress());
    expect(calls()).toContainEqual({ rpc: 'admin_remove_user', args: { target: 'u2' } });
    expect(texts(r.root)).not.toContain('ekip@example.com');
  });

  test('veritabanı reddederse (son admin) satırda anlaşılır uyarı', async () => {
    g.__mockRpcError = 'qraf: the last admin of the organization cannot be removed';
    const r = await render(<UsersScreen onBack={() => {}} />);
    await act(async () => pressableWithText(r.root, 'REMOVE').props.onPress());
    await act(async () => pressableWithText(r.root, 'ARE YOU SURE? REMOVE').props.onPress());
    expect(texts(r.root)).toContain('The organization must keep at least one admin.');
    expect(texts(r.root)).toContain('ekip@example.com');
  });

  test('rol değiştirme kaydedilir; kendi rolü kilitli', async () => {
    const r = await render(<UsersScreen onBack={() => {}} />);
    expect(r.root.findByProps({ testID: 'role-me-standart' }).props.disabled).toBe(true);
    await act(async () => r.root.findByProps({ testID: 'role-u2-admin' }).props.onPress());
    expect(calls()).toContainEqual(
      expect.objectContaining({ table: 'profiles', op: 'update', values: { role: 'admin' }, filter: ['id', 'u2'] })
    );
  });
});

describe('App rolleri', () => {
  test('admin ana sayfada USERS görür', async () => {
    seed('admin');
    const r = await render(<App />);
    expect(texts(r.root)).toContain('USERS');
  });

  test('kullanıcı ana sayfada USERS görmez', async () => {
    seed('standart');
    const r = await render(<App />);
    expect(texts(r.root)).toContain('MY DRIVES');
    expect(texts(r.root)).not.toContain('USERS');
  });

  test('profili olmayan (çıkarılmış) hesap oturumdan atılır', async () => {
    seed('admin');
    g.__mockDb.profiles = [];
    await render(<App />);
    expect(calls()).toContainEqual({ auth: 'signOut' });
  });
});

describe('Oturum', () => {
  test('ana sayfada hesap ve rol görünür', async () => {
    seed('standart');
    const r = await render(<App />);
    expect(texts(r.root)).toEqual(expect.arrayContaining(['yonetici@example.com', 'USER', 'SIGN OUT']));
  });

  test('SIGN OUT oturumu kapatır ve giriş ekranına döner', async () => {
    seed('admin');
    const r = await render(<App />);
    expect(texts(r.root)).toContain('ADMIN');
    await act(async () => pressableWithText(r.root, 'SIGN OUT').props.onPress());
    expect(calls()).toContainEqual({ auth: 'signOut' });
    expect(texts(r.root)).toContain('SEND CODE');
    expect(texts(r.root)).toContain('Signed out.');
    expect(texts(r.root)).not.toContain('MY DRIVES');
  });
});

describe('Giriş', () => {
  test('davetli yeni kullanıcı hesap açabilsin diye shouldCreateUser: true', async () => {
    const r = await render(<App />);
    await act(async () => r.root.findByType(TextInput).props.onChangeText('yeni@example.com'));
    await act(async () => pressableWithText(r.root, 'SEND CODE').props.onPress());
    expect(calls()).toContainEqual({
      auth: 'signInWithOtp',
      args: { email: 'yeni@example.com', options: { shouldCreateUser: true } },
    });
  });

  test('davetsiz e-posta için anlaşılır uyarı', async () => {
    g.__mockOtpError = { message: 'Database error saving new user' };
    const r = await render(<App />);
    await act(async () => r.root.findByType(TextInput).props.onChangeText('yabanci@gmail.com'));
    await act(async () => pressableWithText(r.root, 'SEND CODE').props.onPress());
    expect(texts(r.root)).toContain('There is no invitation for this email. Ask your admin for one.');
  });
});

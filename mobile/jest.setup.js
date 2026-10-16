/* eslint-env jest */
/* global globalThis */
// Testlerde ağ ve native modül yok: Supabase istemcisi ve kamera sahte.
// Her test `globalThis.__mockDisks` ile Supabase'in döneceği diskleri seçer.
jest.mock('./src/supabaseClient', () => {
  // Küçük bellek-içi sahte Supabase. Testler `globalThis.__mockDb`
  // (tablo → satırlar), `__mockDisks` (disks kısayolu), `__mockUpdate`
  // (update sonucunu zorla), `__mockSession`, `__mockRpcError` ayarlar.
  // Yapılan yazmalar `globalThis.__calls`'a, son update `__lastUpdate`'e.
  function table(name) {
    const db = globalThis.__mockDb || (globalThis.__mockDb = {});
    if (name === 'disks' && globalThis.__mockDisks) return globalThis.__mockDisks;
    return db[name] || (db[name] = []);
  }
  function log(call) {
    (globalThis.__calls || (globalThis.__calls = [])).push(call);
  }
  function query(name) {
    let op = 'select';
    let values = null;
    let filter = null;
    const rows = () => table(name).filter((r) => !filter || r[filter[0]] === filter[1]);
    const run = () => {
      if (op === 'select') return { data: rows(), error: null };
      log({ table: name, op, values, filter });
      if (op === 'update') {
        globalThis.__lastUpdate = values;
        if (globalThis.__mockUpdate) return globalThis.__mockUpdate;
        const hit = rows();
        hit.forEach((r) => Object.assign(r, values));
        return { data: hit.length ? hit : [{ id: 'x' }], error: null };
      }
      if (op === 'insert') {
        table(name).push({ id: `new-${table(name).length}`, ...values });
        return { data: null, error: null };
      }
      if (op === 'delete') {
        const hit = rows();
        const list = table(name);
        hit.forEach((r) => list.splice(list.indexOf(r), 1));
        return { data: null, error: null };
      }
      return { data: null, error: null };
    };
    const q = {
      select: () => (op === 'select' ? q : Promise.resolve(run())),
      order: () => (op === 'select' ? Promise.resolve(run()) : q),
      eq: (c, v) => {
        filter = [c, v];
        return q;
      },
      update: (v) => {
        op = 'update';
        values = v;
        return q;
      },
      insert: (v) => {
        op = 'insert';
        values = v;
        return Promise.resolve(run());
      },
      delete: () => {
        op = 'delete';
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: run().data[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  }
  return {
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: globalThis.__mockSession ?? null } }),
        getUser: () => Promise.resolve({ data: { user: globalThis.__mockSession?.user ?? null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInWithOtp: (args) => {
          log({ auth: 'signInWithOtp', args });
          return Promise.resolve({ error: globalThis.__mockOtpError ?? null });
        },
        verifyOtp: () => Promise.resolve({ error: null }),
        signOut: () => {
          log({ auth: 'signOut' });
          return Promise.resolve({ error: null });
        },
      },
      from: (name) => query(name),
      rpc: (fn, args) => {
        log({ rpc: fn, args });
        if (globalThis.__mockRpcError) return Promise.resolve({ error: { message: globalThis.__mockRpcError } });
        const profiles = table('profiles');
        const i = profiles.findIndex((p) => p.id === args.target);
        if (i >= 0) profiles.splice(i, 1);
        return Promise.resolve({ error: null });
      },
    },
  };
});

// Her testten önce sahte durum sıfırlanır.
beforeEach(() => {
  for (const k of ['__mockDb', '__mockDisks', '__mockUpdate', '__mockSession', '__mockRpcError', '__mockOtpError', '__calls', '__lastUpdate']) {
    delete globalThis[k];
  }
});

// Gerçek cihaz ölçüsü olmadan SafeAreaProvider hiçbir şey çizmiyor.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('react-native-camera-kit', () => ({ Camera: 'Camera', CameraType: { Back: 'back' } }));

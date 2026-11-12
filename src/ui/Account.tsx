// Account window: sign in / create account, and for signed-in users profile, password, sessions and deletion.
import { useState, type FormEvent, type ReactNode } from 'react';
import { api, legacyPlayerId } from '../store/remote';
import { store, useStoreVersion } from '../store/simStore';
import { Modal, Tabs } from './components/ui';
import { useUI } from './uiState';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="label mb-0.5">{label}</div>
      {children}
      {hint && <div className="mt-0.5 text-[10px] text-ops-dim">{hint}</div>}
    </label>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = (fn: () => Promise<string | void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, run };
}

const Msg = ({ error, notice }: { error: string | null; notice: string | null }) => (
  <>
    {error && <div role="alert" className="rounded border border-ops-red/50 bg-ops-red/10 px-2 py-1 text-[11px] text-ops-red">{error}</div>}
    {notice && <div role="status" className="rounded border border-ops-green/40 bg-ops-green/10 px-2 py-1 text-[11px] text-ops-green">{notice}</div>}
  </>
);

export function AccountModal() {
  useStoreVersion();
  const ui = useUI();
  const close = () => ui.setAccountOpen(false);
  const sv = store.server;
  return (
    <Modal title={sv.user ? `ACCOUNT · ${sv.user.username}` : 'SIGN IN'} onClose={close}>
      {sv.status === 'offline' ? (
        <div className="space-y-2 text-ops-dim">
          <p>The persistence server is unreachable{sv.error ? ` (${sv.error})` : ''}, so accounts are unavailable. Browser saves still work.</p>
          <button className="btn" onClick={() => void store.refreshServer()}>Retry connection</button>
        </div>
      ) : sv.user ? <SignedIn onDone={close} /> : <SignedOut onDone={close} />}
    </Modal>
  );
}

function SignedOut({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { busy, error, notice, run } = useAction();
  const legacy = legacyPlayerId();

  const submit = run(async () => {
    if (tab === 'register') {
      if (password !== confirm) throw new Error('Passwords do not match');
      await store.register(username.trim(), password);
    } else {
      await store.login(username.trim(), password);
    }
    onDone();
  });

  return (
    <div className="space-y-3">
      <Tabs value={tab} onChange={(t) => { setTab(t); setPassword(''); setConfirm(''); }} tabs={[{ id: 'login', label: 'Sign in' }, { id: 'register', label: 'Create account' }]} />
      <p className="text-[11px] text-ops-dim">
        {tab === 'login' ? 'Sign in to store campaigns on the server and continue them from any browser.' : 'An account keeps your campaigns, save slots and service record on the server.'}
      </p>
      <form className="space-y-2.5" onSubmit={submit}>
        <Field label="Username" hint={tab === 'register' ? '3–32 characters: letters, digits, _ . -' : undefined}>
          <input className="input w-full" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.\-]{3,32}" />
        </Field>
        <Field label="Password" hint={tab === 'register' ? 'At least 10 characters. A passphrase works well.' : undefined}>
          <input className="input w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} required minLength={tab === 'register' ? 10 : 1} maxLength={200} />
        </Field>
        {tab === 'register' && (
          <Field label="Confirm password">
            <input className="input w-full" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </Field>
        )}
        {tab === 'register' && legacy && <p className="text-[10px] text-ops-cyan">Server saves made from this browser before accounts existed will be linked to the new account.</p>}
        <Msg error={error} notice={notice} />
        <button className="btn btn-primary w-full py-2" disabled={busy} type="submit">{busy ? 'Working…' : tab === 'login' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p className="text-[10px] text-ops-dim">Forgot your password? There is no email recovery. The server operator can issue a temporary password with <code>npm run user:reset-password</code>.</p>
    </div>
  );
}

function SignedIn({ onDone }: { onDone: () => void }) {
  const user = store.server.user!;
  const [callsign, setCallsign] = useState(user.callsign);
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [delPw, setDelPw] = useState('');
  const [delName, setDelName] = useState('');
  const profile = useAction();
  const pw = useAction();
  const sess = useAction();
  const del = useAction();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        <div><div className="label">Username</div><div className="text-white">{user.username}</div></div>
        <div><div className="label">Member since</div><div className="text-white">{new Date(user.createdAt).toLocaleDateString()}</div></div>
        <div><div className="label">Active sessions</div><div className="text-white">{user.activeSessions}</div></div>
        <div><div className="label">Campaigns stored</div><div className="text-white">{store.server.campaigns.length}</div></div>
      </div>

      <form className="space-y-2 rounded border border-ops-line p-3" onSubmit={profile.run(async () => {
        await store.updateAccount(() => api.setCallsign(callsign.trim()));
        return 'Callsign updated.';
      })}>
        <Field label="Callsign (shown in briefings and records)">
          <div className="flex gap-2"><input className="input flex-1" value={callsign} onChange={(e) => setCallsign(e.target.value)} maxLength={40} required />
            <button className="btn" disabled={profile.busy || !callsign.trim() || callsign.trim() === user.callsign}>Save</button></div>
        </Field>
        <Msg error={profile.error} notice={profile.notice} />
      </form>

      <form className="space-y-2 rounded border border-ops-line p-3" onSubmit={pw.run(async () => {
        const r = await api.changePassword(cur, next);
        setCur('');
        setNext('');
        await store.updateAccount(async () => null);
        return `Password changed.${r.revokedSessions ? ` ${r.revokedSessions} other session(s) signed out.` : ''}`;
      })}>
        <div className="label">Change password</div>
        <input type="text" className="hidden" autoComplete="username" value={user.username} readOnly />
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required aria-label="Current password" />
          <input className="input" type="password" placeholder="New password (10+ chars)" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required aria-label="New password" />
        </div>
        <Msg error={pw.error} notice={pw.notice} />
        <button className="btn" disabled={pw.busy}>Change password</button>
        <p className="text-[10px] text-ops-dim">Changing your password signs out every other device.</p>
      </form>

      <div className="flex flex-wrap items-center gap-2 rounded border border-ops-line p-3">
        <button className="btn" disabled={sess.busy} onClick={sess.run(async () => {
          const r = await api.logoutOthers();
          await store.updateAccount(async () => null);
          return `${r.revokedSessions} other session(s) signed out.`;
        })}>Sign out other devices</button>
        <button className="btn btn-primary" onClick={async () => { await store.logout(); onDone(); }}>Sign out</button>
        <div className="w-full"><Msg error={sess.error} notice={sess.notice} /></div>
      </div>

      <details className="rounded border border-ops-red/40 p-3">
        <summary className="cursor-pointer text-ops-red">Delete account</summary>
        <form className="mt-2 space-y-2" onSubmit={del.run(async () => {
          await store.deleteAccount(delPw);
          onDone();
        })}>
          <p className="text-[11px]">This permanently deletes your account, every stored campaign, all server save slots and your service record. Browser saves on this device are not affected. This cannot be undone.</p>
          <input className="input w-full" placeholder={`Type ${user.username} to confirm`} value={delName} onChange={(e) => setDelName(e.target.value)} aria-label="Type your username to confirm" />
          <input className="input w-full" type="password" placeholder="Password" value={delPw} onChange={(e) => setDelPw(e.target.value)} autoComplete="current-password" aria-label="Password" />
          <Msg error={del.error} notice={del.notice} />
          <button className="btn btn-danger" disabled={del.busy || delName !== user.username || !delPw}>Permanently delete account</button>
        </form>
      </details>
    </div>
  );
}

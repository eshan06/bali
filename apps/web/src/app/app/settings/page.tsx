'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Toggle } from '@/components/bali/Button';
import { ErrorToast, LoadError } from '@/components/bali/bits';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface SettingsDTO {
  name: string;
  displayName: string;
  email: string;
  schoolName: string;
  notifyEmergency: boolean;
  notifyRevoked: boolean;
  notifyWeekly: boolean;
}

const FIELD_LABEL = 'mb-[5px] text-[12.5px] leading-[17px] text-ink-secondary';

export default function SettingsPage() {
  const { reload } = useAuth();
  const [form, setForm] = useState<SettingsDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    api
      .get<SettingsDTO>('/me/settings')
      .then(setForm)
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await api.patch<SettingsDTO>('/me/settings', {
        name: form.name.trim() || undefined,
        displayName: form.displayName.trim() || undefined,
        schoolName: form.schoolName.trim() || undefined,
        notifyEmergency: form.notifyEmergency,
        notifyRevoked: form.notifyRevoked,
        notifyWeekly: form.notifyWeekly,
      });
      setForm(updated);
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2400);
      // Best-effort sidenav refresh — the save already committed, so a failed /me
      // reload must NOT masquerade as a save failure.
      void reload().catch(() => {});
    } catch {
      setActionError('Couldn’t save your settings. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!form)
    return loadError ? (
      <div className="p-9">
        <LoadError what="settings" onRetry={load} />
      </div>
    ) : (
      <div className="p-9 text-ink-tertiary">Loading…</div>
    );

  const toggles: Array<{
    key: 'notifyEmergency' | 'notifyRevoked' | 'notifyWeekly';
    title: string;
    sub: string;
  }> = [
    { key: 'notifyEmergency', title: 'Emergency unlocks', sub: 'always also on the dashboard' },
    { key: 'notifyRevoked', title: 'Permission turned off mid-session', sub: '' },
    { key: 'notifyWeekly', title: 'Weekly summary', sub: 'Mondays, one email' },
  ];

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Settings</h1>

      <div className="flex max-w-[560px] flex-col gap-[18px]">
        <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-card p-5">
          <div className="text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
            Profile
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className={FIELD_LABEL}>Name</div>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex-1">
              <div className={FIELD_LABEL}>Shown to students as</div>
              <Input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </div>
          </div>
          <div>
            <div className={FIELD_LABEL}>School</div>
            <Input
              value={form.schoolName}
              onChange={(e) => setForm({ ...form, schoolName: e.target.value })}
            />
          </div>
        </div>

        <div className="flex flex-col rounded-md border border-line bg-surface-card p-5 pt-4">
          <div className="mb-2 text-[11.5px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-ink-tertiary">
            Email me about
          </div>
          {toggles.map((t) => (
            <div key={t.key} className="flex items-center gap-3 border-t border-line py-2.5">
              <div className="flex-1">
                <div className="text-[14.5px] font-medium leading-[19px]">{t.title}</div>
                {t.sub ? (
                  <div className="text-[12.5px] leading-[17px] text-ink-tertiary">{t.sub}</div>
                ) : null}
              </div>
              <Toggle
                on={form[t.key]}
                onChange={(next) => setForm({ ...form, [t.key]: next })}
                ariaLabel={t.title}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button
            className="self-start px-6 py-2.5"
            loading={busy}
            disabled={!form.name.trim() || !form.displayName.trim()}
            onClick={() => void save()}
          >
            Save changes
          </Button>
          <span aria-live="polite" className="text-[13px] leading-[18px] text-ink-tertiary">
            {savedAt ? 'Saved' : ''}
          </span>
        </div>
      </div>

      {actionError ? <ErrorToast message={actionError} onDismiss={() => setActionError(null)} /> : null}
    </div>
  );
}

'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button, Input } from '@/components/bali/Button';
import { ErrorToast, LoadError } from '@/components/bali/bits';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import type { PolicyDTO } from '@/lib/types';

/** Editor form state; `id === null` is the "+ New policy" draft. Full-focus only —
 *  every session shields all but the apps each student allows once on their own phone,
 *  so a policy is just a name you pick when starting a session. */
interface Draft {
  id: string | null;
  name: string;
}

const draftFrom = (p: PolicyDTO | null): Draft => (p ? { id: p.id, name: p.name } : { id: null, name: '' });

const listSub = (p: PolicyDTO): string =>
  `Full focus · used by ${p.usedByClasses} ${p.usedByClasses === 1 ? 'class' : 'classes'}`;

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyDTO[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<PolicyDTO[]> => {
    try {
      const r = await api.get<{ policies: PolicyDTO[] }>('/policies');
      setPolicies(r.policies);
      setLoadError(false);
      return r.policies;
    } catch {
      setLoadError(true);
      return [];
    }
  }, []);

  useEffect(() => {
    void load().then((list) => {
      setDraft((prev) => prev ?? draftFrom(list[0] ?? null));
    });
  }, [load]);

  const selected = policies?.find((p) => p.id === draft?.id) ?? null;
  const usedBy = selected?.usedByClasses ?? 0;

  const select = (p: PolicyDTO | null) => {
    setDraft(draftFrom(p));
    if (!p) setTimeout(() => nameRef.current?.focus(), 0);
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const body = { name: draft.name.trim() };
      const saved = draft.id
        ? await api.patch<PolicyDTO>(`/policies/${draft.id}`, body)
        : await api.post<PolicyDTO>('/policies', body);
      await load();
      setDraft(draftFrom(saved));
    } catch {
      setActionError('Couldn’t save the policy. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.del(`/policies/${draft.id}`);
      setConfirmDelete(false);
      const list = await load();
      setDraft(draftFrom(list[0] ?? null));
    } catch {
      setActionError('Couldn’t delete the policy. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-center gap-4">
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Policies</h1>
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => select(null)}>
            <Plus size={16} strokeWidth={ICON_STROKE} />
            New policy
          </Button>
        </div>
      </div>

      {policies === null ? (
        loadError ? (
          <LoadError what="policies" onRetry={() => void load()} />
        ) : (
          <div className="text-ink-tertiary">Loading…</div>
        )
      ) : (
        <div className="grid grid-cols-[320px_1fr] items-start gap-5 max-[1024px]:grid-cols-1">
          {/* policy list */}
          <div className="flex flex-col gap-2.5">
            {policies.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p)}
                className={clsx(
                  'rounded-md border border-line bg-surface-card px-4 py-3.5 text-left hover:bg-surface-sunken',
                  draft?.id === p.id && '[box-shadow:var(--focus-ring)]',
                )}
              >
                <div className="text-[15px] font-semibold leading-5">{p.name}</div>
                <div className="mt-0.5 text-[12.5px] leading-[17px] text-ink-tertiary">{listSub(p)}</div>
              </button>
            ))}
            {draft && draft.id === null ? (
              <div className="rounded-md border border-dashed border-line-strong px-4 py-3.5 [box-shadow:var(--focus-ring)]">
                <div className="text-[15px] font-semibold leading-5 text-ink-secondary">
                  {draft.name.trim() || 'New policy'}
                </div>
                <div className="mt-0.5 text-[12.5px] leading-[17px] text-ink-tertiary">not saved yet</div>
              </div>
            ) : null}
            {policies.length === 0 && draft?.id !== null ? (
              <div className="text-[13px] leading-[18px] text-ink-tertiary">
                No policies yet — create one to pick when you start a session.
              </div>
            ) : null}
          </div>

          {/* editor — full-focus only, so a policy is just a name */}
          {draft ? (
            <div className="max-w-[620px] rounded-md border border-line bg-surface-card p-5">
              <div className="mb-3.5 flex items-center gap-3">
                <div className="w-[240px]">
                  <Input
                    ref={nameRef}
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Policy name"
                    className="font-semibold"
                    aria-label="Policy name"
                  />
                </div>
                <span className="ml-auto whitespace-nowrap text-[12.5px] leading-[17px] text-ink-tertiary">
                  {draft.id ? `Used by ${usedBy} ${usedBy === 1 ? 'class' : 'classes'}` : 'New policy'}
                </span>
              </div>

              <div className="rounded-sm border border-line bg-surface-sunken p-3.5 text-[13px] leading-[19px] text-ink-secondary">
                Every session is <span className="font-medium text-ink-primary">full focus</span>. Each
                phone pauses every app except the few that student chose once during setup — Bali never
                sees the list. The Phone app always works (calls &amp; 911 are never blocked). A policy is
                just a name you pick when starting a session.
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3.5 mt-3.5">
                <Button className="px-[22px]" disabled={!draft.name.trim()} loading={busy} onClick={() => void save()}>
                  {draft.id ? 'Save changes' : 'Create policy'}
                </Button>
                {draft.id ? (
                  <div className="text-right">
                    <Button
                      variant="ghost"
                      className="text-red-600"
                      disabled={usedBy > 0}
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete policy…
                    </Button>
                    {usedBy > 0 ? (
                      <div className="text-[11.5px] leading-[15px] text-ink-tertiary">
                        In use — detach from {usedBy} {usedBy === 1 ? 'class' : 'classes'} first
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* delete confirm — destructive confirms before acting */}
      <Dialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-[rgba(22,19,16,0.42)]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[31] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card p-6 shadow-3 focus:outline-none"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-[19px] font-semibold leading-[25px]">
              Delete {selected?.name ?? 'this policy'}?
            </Dialog.Title>
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">
              Past sessions keep their settings — only the reusable policy goes away.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <Dialog.Close asChild>
                <Button variant="ghost" className="text-ink-secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button variant="destructive" loading={busy} onClick={() => void remove()}>
                Delete policy
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {actionError ? <ErrorToast message={actionError} onDismiss={() => setActionError(null)} /> : null}
    </div>
  );
}

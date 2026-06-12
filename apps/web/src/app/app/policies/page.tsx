'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button, Input, Toggle } from '@/components/bali/Button';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import type { PolicyDTO } from '@/lib/types';

const MAX_LABELS = 12;

/** Editor form state; `id === null` is the "+ New policy" draft. */
interface Draft {
  id: string | null;
  name: string;
  messagesAllowed: boolean;
  allowedAppLabels: string[];
}

const draftFrom = (p: PolicyDTO | null): Draft =>
  p
    ? { id: p.id, name: p.name, messagesAllowed: p.messagesAllowed, allowedAppLabels: [...p.allowedAppLabels] }
    : { id: null, name: '', messagesAllowed: true, allowedAppLabels: [] };

const listSub = (p: PolicyDTO): string => {
  const extras = p.allowedAppLabels.length > 0 ? p.allowedAppLabels.join(', ') : 'no extras';
  const used = `used by ${p.usedByClasses} ${p.usedByClasses === 1 ? 'class' : 'classes'}`;
  return `${extras} · ${used}`;
};

function ToggleRow({
  title,
  sub,
  on,
  lockedOn = false,
  onChange,
}: {
  title: string;
  sub: string;
  on: boolean;
  lockedOn?: boolean;
  onChange?: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line py-[13px]">
      <div className="flex-1">
        <div className="text-[14.5px] font-medium leading-[19px]">{title}</div>
        <div className="text-[12.5px] leading-[17px] text-ink-tertiary">{sub}</div>
      </div>
      <Toggle on={on} lockedOn={lockedOn} onChange={onChange} ariaLabel={title} />
    </div>
  );
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<PolicyDTO[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<PolicyDTO[]> => {
    const r = await api.get<{ policies: PolicyDTO[] }>('/policies');
    setPolicies(r.policies);
    return r.policies;
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
    setLabelInput('');
    if (!p) setTimeout(() => nameRef.current?.focus(), 0);
  };

  const addLabel = () => {
    const label = labelInput.trim();
    if (!draft || !label) return;
    if (draft.allowedAppLabels.some((l) => l.toLowerCase() === label.toLowerCase())) {
      setLabelInput('');
      return;
    }
    if (draft.allowedAppLabels.length >= MAX_LABELS) return;
    setDraft({ ...draft, allowedAppLabels: [...draft.allowedAppLabels, label] });
    setLabelInput('');
  };

  const save = async () => {
    if (!draft || !draft.name.trim()) return;
    setBusy(true);
    try {
      const body = {
        name: draft.name.trim(),
        messagesAllowed: draft.messagesAllowed,
        allowedAppLabels: draft.allowedAppLabels,
      };
      const saved = draft.id
        ? await api.patch<PolicyDTO>(`/policies/${draft.id}`, body)
        : await api.post<PolicyDTO>('/policies', body);
      await load();
      setDraft(draftFrom(saved));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    try {
      await api.del(`/policies/${draft.id}`);
      setConfirmDelete(false);
      const list = await load();
      setDraft(draftFrom(list[0] ?? null));
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
        <div className="text-ink-tertiary">Loading…</div>
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
                No policies yet — create one to choose what stays available during focus.
              </div>
            ) : null}
          </div>

          {/* editor */}
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
                  {draft.id
                    ? `Used by ${usedBy} ${usedBy === 1 ? 'class' : 'classes'}`
                    : 'New policy'}
                </span>
              </div>

              <ToggleRow title="Phone" sub="Always available — calls can't be shielded" on lockedOn />
              <ToggleRow
                title="Messages"
                sub="Recommended on for family reachability"
                on={draft.messagesAllowed}
                onChange={(next) => setDraft({ ...draft, messagesAllowed: next })}
              />

              <div className="border-t border-line py-3.5">
                <div className="mb-2.5 text-[14.5px] font-medium leading-[19px]">Also allowed</div>
                <div className="flex flex-wrap items-center gap-2">
                  {draft.allowedAppLabels.map((label) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken py-1 pl-3 pr-1.5 text-[13px] font-medium leading-[18px]"
                    >
                      {label}
                      <button
                        type="button"
                        aria-label={`Remove ${label}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            allowedAppLabels: draft.allowedAppLabels.filter((l) => l !== label),
                          })
                        }
                        className="flex rounded-full p-0.5 text-ink-tertiary hover:text-ink-primary"
                      >
                        <X size={13} strokeWidth={ICON_STROKE} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLabel();
                      }
                    }}
                    onBlur={addLabel}
                    placeholder="Add an app…"
                    aria-label="Add an allowed app"
                    className="w-[130px] rounded-sm border border-line-strong bg-surface-card px-2.5 py-[5px] text-[13px] leading-[18px] placeholder:text-ink-tertiary"
                  />
                </div>
                <div className="mt-2.5 text-[12.5px] leading-[18px] text-ink-tertiary">
                  Students pick the matching apps on their own phones — Bali never sees anyone's app
                  list.
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-line pt-3.5">
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
    </div>
  );
}

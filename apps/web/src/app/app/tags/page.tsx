'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Printer } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArcMark } from '@/components/bali/ArcMark';
import { Button, Input, Label, Toggle } from '@/components/bali/Button';
import { QrSvg } from '@/components/bali/QrSvg';
import { ICON_STROKE } from '@/components/bali/icons';
import { api } from '@/lib/api';
import type { ClassCardDTO } from '@/lib/types';

export interface TagDTO {
  id: string;
  classId: string;
  className: string;
  label: string;
  code: string;
  active: boolean;
  createdAt: string;
  deactivatedAt: string | null;
}

const tagUrl = (code: string): string =>
  `${typeof window !== 'undefined' ? window.location.origin : 'https://bali.app'}/t/${code}`;

function TagCard({
  tag,
  onToggle,
  onPrint,
}: {
  tag: TagDTO;
  onToggle: (tag: TagDTO, next: boolean) => void;
  onPrint: (tag: TagDTO) => void;
}) {
  return (
    <div
      className={clsx(
        'flex w-[268px] flex-col gap-3 rounded-md border border-line bg-surface-card p-5',
        !tag.active && 'opacity-[0.62]',
      )}
    >
      <QrSvg value={tagUrl(tag.code)} size={170} className="self-center" title={`QR for ${tag.label}`} />
      <div>
        <div className="text-[16px] font-semibold leading-[21px]">{tag.label}</div>
        <div className="mt-[3px] font-mono text-[11.5px] font-medium leading-4 tracking-[0.08em] text-ink-tertiary">
          {tag.code} · {tag.className}
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-t border-line pt-3">
        <span className="flex-1 text-[13.5px] font-medium leading-[18px]">
          {tag.active ? 'Active' : 'Deactivated'}
        </span>
        <Toggle
          on={tag.active}
          onChange={(next) => onToggle(tag, next)}
          ariaLabel={`${tag.label} active`}
        />
      </div>
      <Button variant="secondary" className="w-full" onClick={() => onPrint(tag)}>
        <Printer size={16} strokeWidth={ICON_STROKE} />
        Print sheet
      </Button>
    </div>
  );
}

export default function TagsPage() {
  const [classes, setClasses] = useState<ClassCardDTO[]>([]);
  const [tags, setTags] = useState<TagDTO[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState<TagDTO | null>(null);
  const [printTag, setPrintTag] = useState<TagDTO | null>(null);
  const [busy, setBusy] = useState(false);

  // create form
  const [label, setLabel] = useState('');
  const [classId, setClassId] = useState('');

  const load = useCallback(async () => {
    const { classes: list } = await api.get<{ classes: ClassCardDTO[] }>('/classes');
    setClasses(list);
    setClassId((prev) => prev || list[0]?.id || '');
    const perClass = await Promise.all(
      list.map((c) => api.get<{ tags: TagDTO[] }>(`/classes/${c.id}/tags`)),
    );
    setTags(perClass.flatMap((r) => r.tags));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!label.trim() || !classId) return;
    setBusy(true);
    try {
      await api.post<TagDTO>(`/classes/${classId}/tags`, { label: label.trim() });
      setLabel('');
      setCreateOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (tag: TagDTO, active: boolean) => {
    const updated = await api.patch<TagDTO>(`/tags/${tag.id}`, { active });
    setTags((prev) => prev?.map((t) => (t.id === tag.id ? updated : t)) ?? null);
  };

  const onToggle = (tag: TagDTO, next: boolean) => {
    if (!next) setConfirmOff(tag); // turning OFF warns first — blast radius is every printed copy
    else void setActive(tag, true);
  };

  const onPrint = (tag: TagDTO) => {
    setPrintTag(tag);
    // let the print sheet render before invoking the dialog
    setTimeout(() => {
      window.print();
      setPrintTag(null);
    }, 60);
  };

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Desk tags</h1>
          <div className="mt-1 text-[13.5px] leading-[19px] text-ink-secondary">
            NFC tags + printable QR — students tap either to start focus
          </div>
        </div>
        <div className="ml-auto">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={ICON_STROKE} />
            New tag
          </Button>
        </div>
      </div>

      {tags === null ? (
        <div className="text-ink-tertiary">Loading…</div>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-[60px] text-center">
          <svg viewBox="0 0 20 20" fill="none" className="h-14 w-14">
            <circle cx="10" cy="10" r="7.5" stroke="var(--stone-200)" strokeWidth="3" />
          </svg>
          <div className="text-[20px] font-semibold leading-[26px]">No desk tags yet</div>
          <div className="max-w-[400px] text-[14px] leading-[21px] text-ink-secondary">
            Tags are optional — students can always join and tap in by code. Print a QR sheet here,
            or write an NFC sticker from the Bali iPhone app.
          </div>
          <Button className="px-[26px] py-[11px]" onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={ICON_STROKE} />
            New tag
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-4">
          {tags.map((tag) => (
            <TagCard key={tag.id} tag={tag} onToggle={onToggle} onPrint={onPrint} />
          ))}
        </div>
      )}

      <div className="max-w-[640px] text-[13px] leading-[19px] text-ink-secondary">
        Turning a tag off warns first:{' '}
        <i>
          "Every printed copy of this tag stops working immediately. Students can still join by
          code."
        </i>{' '}
        Writing the NFC side happens on your iPhone (Tags → Write) — the web prints the QR sheets.
      </div>

      {/* create dialog */}
      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-[rgba(22,19,16,0.42)]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[31] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card p-6 shadow-3 focus:outline-none"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-[19px] font-semibold leading-[25px]">New tag</Dialog.Title>
            <div className="mt-3.5 flex flex-col gap-3.5">
              <div>
                <Label className="mb-1.5">Label</Label>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Front desk"
                  autoFocus
                />
              </div>
              <div>
                <Label className="mb-1.5">Class</Label>
                <select
                  className="w-full rounded-sm border border-line-strong bg-surface-card px-3 py-[9px] text-[15px] leading-5"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-[12.5px] leading-[17px] text-ink-tertiary">
                The QR is ready to print right away. To make the NFC sticker live, write it from
                the Bali iPhone app (Tags → Write).
              </div>
              <div className="mt-1 flex justify-end gap-2.5">
                <Dialog.Close asChild>
                  <Button variant="ghost" className="text-ink-secondary">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button disabled={!label.trim() || !classId} loading={busy} onClick={() => void create()}>
                  Create tag
                </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* deactivate warning — names the blast radius */}
      <Dialog.Root open={confirmOff !== null} onOpenChange={(o) => !o && setConfirmOff(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-[rgba(22,19,16,0.42)]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-[31] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-card p-6 shadow-3 focus:outline-none"
            aria-describedby={undefined}
          >
            <Dialog.Title className="text-[19px] font-semibold leading-[25px]">
              Deactivate {confirmOff?.label}?
            </Dialog.Title>
            <p className="mt-2 text-[14px] leading-5 text-ink-secondary">
              Every printed copy of this tag stops working immediately. Students can still join by
              code.
            </p>
            <div className="mt-5 flex justify-end gap-2.5">
              <Dialog.Close asChild>
                <Button variant="ghost" className="text-ink-secondary">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button
                variant="quiet-destructive"
                onClick={() => {
                  if (confirmOff) void setActive(confirmOff, false);
                  setConfirmOff(null);
                }}
              >
                Deactivate tag
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* print sheet — visible only to the printer (globals.css @media print) */}
      {printTag ? (
        <div className="print-sheet hidden print:flex">
          <div className="flex w-full flex-col items-center gap-6 pt-16 text-center">
            <div className="flex items-center gap-2 text-[22px] font-semibold">
              <ArcMark size={22} />
              Bali
            </div>
            <QrSvg value={tagUrl(printTag.code)} size={420} title={`QR for ${printTag.label}`} />
            <div>
              <div className="text-[30px] font-semibold leading-9">{printTag.label}</div>
              <div className="mt-2 font-mono text-[16px] font-medium tracking-[0.12em] text-ink-secondary">
                {printTag.code}
              </div>
              <div className="mt-1 text-[16px] text-ink-secondary">{printTag.className}</div>
            </div>
            <div className="text-[15px] text-ink-secondary">
              Tap your phone here — or scan the code — to start focus.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

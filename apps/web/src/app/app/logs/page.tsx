'use client';

import { useEffect, useState } from 'react';
import type { EventDTO } from '@bali/shared';
import { Button } from '@/components/bali/Button';
import { FilterChip } from '@/components/bali/bits';
import { EventTimeline } from '@/components/bali/EventTimeline';
import { api } from '@/lib/api';
import type { ClassCardDTO } from '@/lib/types';

type TypeFilter = 'all' | 'emergencies' | 'passes' | 'permission' | 'sessions';

const TYPE_CHIPS: Array<{ value: TypeFilter; label: string }> = [
  { value: 'all', label: 'All types' },
  { value: 'emergencies', label: 'Emergencies' },
  { value: 'passes', label: 'Passes' },
  { value: 'permission', label: 'Permission' },
  { value: 'sessions', label: 'Sessions' },
];

/** Chip label: the short class handle ("Period 3"), per the W9 mock. */
const shortClass = (name: string): string => name.split(' — ')[0] ?? name;

export default function LogsPage() {
  const [classes, setClasses] = useState<ClassCardDTO[]>([]);
  const [type, setType] = useState<TypeFilter>('all');
  const [classId, setClassId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventDTO[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    void api.get<{ classes: ClassCardDTO[] }>('/classes').then((r) => setClasses(r.classes));
  }, []);

  const baseQuery = `type=${type}${classId ? `&classId=${classId}` : ''}`;
  useEffect(() => {
    setEvents(null);
    setNextCursor(null);
    void api
      .get<{ events: EventDTO[]; nextCursor: string | null }>(`/events?${baseQuery}&limit=30`)
      .then((r) => {
        setEvents(r.events);
        setNextCursor(r.nextCursor);
      });
  }, [baseQuery]);

  const loadOlder = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await api.get<{ events: EventDTO[]; nextCursor: string | null }>(
        `/events?${baseQuery}&limit=30&cursor=${nextCursor}`,
      );
      setEvents((prev) => [...(prev ?? []), ...r.events]);
      setNextCursor(r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-[18px] px-8 pb-9 pt-6">
      <div className="flex items-baseline gap-3">
        <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">Event log</h1>
        <div className="text-[13px] leading-[18px] text-ink-tertiary">
          {classId ? shortClass(classes.find((c) => c.id === classId)?.name ?? '') : 'all classes'} ·
          newest first
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TYPE_CHIPS.map((c) => (
          <FilterChip key={c.value} active={type === c.value} onClick={() => setType(c.value)}>
            {c.label}
          </FilterChip>
        ))}
        <span className="flex-1" />
        <FilterChip active={classId === null} onClick={() => setClassId(null)}>
          All classes
        </FilterChip>
        {classes.map((c) => (
          <FilterChip key={c.id} active={classId === c.id} onClick={() => setClassId(c.id)}>
            {shortClass(c.name)}
          </FilterChip>
        ))}
      </div>

      <div className="max-w-[720px] rounded-md border border-line bg-surface-card p-6">
        {events === null ? (
          <div className="text-ink-tertiary">Loading…</div>
        ) : events.length === 0 ? (
          <div className="text-[14px] leading-5 text-ink-secondary">
            Nothing here yet — events appear as sessions run.
          </div>
        ) : (
          <EventTimeline events={events} />
        )}
        {nextCursor ? (
          <Button variant="secondary" className="mt-[18px]" loading={loadingMore} onClick={() => void loadOlder()}>
            Load older events
          </Button>
        ) : null}
      </div>
    </div>
  );
}

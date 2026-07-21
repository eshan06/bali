'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EventDTO, ParticipantDTO, SessionDetailDTO, SSEMessage } from '@bali/shared';
import { API_URL, api, getToken } from './api';

export interface LiveState {
  detail: SessionDetailDTO | null;
  /** Transport truth for the ReconnectingPill — SSE down, polling at 5s. */
  reconnecting: boolean;
  /** True once reconnect+poll have failed repeatedly: the grid is stale and the teacher
   *  must be told loudly (not just a calm "Reconnecting" pill) — this is a monitoring
   *  surface where a silently-frozen grid is a safety gap. */
  liveLost: boolean;
  /** Recent emergency/revoked/info events for the toast stack. */
  lastEvent: EventDTO | null;
  /** The student whose chip should soft-pulse (set on emergency arrival). */
  pulseStudentId: string | null;
}

/** Consecutive failed reconnect cycles before we escalate from "Reconnecting" to
 *  "Live updates lost". ~3 × (3s retry + poll) ≈ 10–15s of sustained failure. */
const LIVE_LOST_AFTER = 3;

/**
 * SSE via fetch-streaming (EventSource can't carry Authorization), with automatic
 * 5s polling fallback on transport loss — the grid never goes blind, it goes honest.
 */
export function useLiveSession(sessionId: string | null): LiveState & { refresh: () => void } {
  const [detail, setDetail] = useState<SessionDetailDTO | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [liveLost, setLiveLost] = useState(false);
  const [lastEvent, setLastEvent] = useState<EventDTO | null>(null);
  const [pulseStudentId, setPulseStudentId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failuresRef = useRef(0);

  const applyMessage = useCallback((msg: SSEMessage) => {
    switch (msg.kind) {
      case 'snapshot':
        setDetail(msg.detail);
        break;
      case 'participant':
        setDetail((prev) => {
          if (!prev) return prev;
          const participants = prev.participants.map((p) =>
            p.studentId === msg.participant.studentId ? msg.participant : p,
          );
          if (!participants.some((p) => p.studentId === msg.participant.studentId)) {
            participants.push(msg.participant);
          }
          return { ...prev, participants, counts: msg.counts };
        });
        if (msg.participant.state === 'emergency_unlocked') {
          setPulseStudentId(msg.participant.studentId);
        }
        break;
      case 'session':
        setDetail((prev) => (prev ? { ...prev, session: msg.session } : prev));
        break;
      case 'event':
        setLastEvent(msg.event);
        break;
      case 'ping':
        break;
    }
  }, []);

  const refresh = useCallback(() => {
    if (!sessionId) return;
    api
      .get<SessionDetailDTO>(`/sessions/${sessionId}`)
      .then((d) => {
        // A successful poll means we DO have fresh data — clear the escalation and reset
        // the failure count (a 401 here already triggered re-auth inside api.request).
        setDetail(d);
        failuresRef.current = 0;
        setLiveLost(false);
      })
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setDetail(null);
      setReconnecting(false);
      setLiveLost(false);
      failuresRef.current = 0;
      return;
    }
    let stopped = false;
    failuresRef.current = 0;
    setLiveLost(false);
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      setReconnecting(true);
      if (pollTimer) return;
      pollTimer = setInterval(refresh, 5_000);
    };
    const stopPolling = () => {
      setReconnecting(false);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const connect = async (): Promise<void> => {
      while (!stopped) {
        const controller = new AbortController();
        abortRef.current = controller;
        try {
          const token = await getToken();
          const res = await fetch(`${API_URL}/sessions/${sessionId}/stream`, {
            headers: token ? { authorization: `Bearer ${token}` } : {},
            signal: controller.signal,
          });
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          stopPolling();
          failuresRef.current = 0;
          setLiveLost(false);

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              for (const line of chunk.split('\n')) {
                if (line.startsWith('data: ')) {
                  try {
                    applyMessage(JSON.parse(line.slice(6)) as SSEMessage);
                  } catch {
                    /* skip malformed frame */
                  }
                }
              }
            }
          }
          throw new Error('stream closed');
        } catch {
          if (stopped) return;
          failuresRef.current += 1;
          if (failuresRef.current >= LIVE_LOST_AFTER) setLiveLost(true);
          startPolling();
          refresh();
          await new Promise((r) => setTimeout(r, 3_000));
        }
      }
    };

    refresh();
    void connect();

    return () => {
      stopped = true;
      abortRef.current?.abort();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [sessionId, applyMessage, refresh]);

  return { detail, reconnecting, liveLost, lastEvent, pulseStudentId, refresh };
}

/** 1s ticking "23:14" countdown to an ISO end time (tabular digits upstream). */
export function useCountdown(endsAt: string | null | undefined): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  if (!endsAt) return '–:––';
  const remain = Math.max(0, Math.floor((new Date(endsAt).getTime() - now) / 1000));
  return `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`;
}

/** Fraction of the session remaining, for arc geometry. */
export function useSessionProgress(startedAt?: string, endsAt?: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt || !endsAt) return 0;
  const start = new Date(startedAt).getTime();
  const end = new Date(endsAt).getTime();
  if (end <= start) return 0;
  return Math.min(1, Math.max(0, (end - now) / (end - start)));
}

export type { ParticipantDTO };

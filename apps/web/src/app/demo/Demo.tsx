'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell, CircleCheck, EyeOff, Nfc, ShieldCheck, Zap } from 'lucide-react';
import { ArcMark } from '@/components/bali/ArcMark';
import { ToastCard } from '@/components/bali/Toaster';
import { ICON_STROKE } from '@/components/bali/icons';
import { BrowserFrame } from '@/components/demo/BrowserFrame';
import { IOSFrame } from '@/components/demo/IOSFrame';
import { DEMO, ROSTER, rosterWithEmergency } from '@/components/demo/demoData';
import { DashboardLive } from '@/components/demo/screens/DashboardLive';
import { ShieldOverlay } from '@/components/demo/screens/ShieldOverlay';
import { StudentFocusActive } from '@/components/demo/screens/StudentFocusActive';
import { StudentTapIn } from '@/components/demo/screens/StudentTapIn';
import { TeacherRecap } from '@/components/demo/screens/TeacherRecap';
import { TeacherStartSession } from '@/components/demo/screens/TeacherStartSession';
import '@/styles/demo.css';

/** One clock for the whole page, so the phone and the dashboard can never
 *  disagree about how much of the period is left. */
function useDemoClock() {
  const [seconds, setSeconds] = useState(DEMO.sessionSeconds);
  useEffect(() => {
    const iv = setInterval(() => setSeconds((s) => (s <= 0 ? 0 : s - 1)), 1000);
    return () => clearInterval(iv);
  }, []);
  return seconds;
}

/** Device scale. `pinned` fits the desktop sticky column; `inline` is the
 *  per-step device shown on narrow screens, where pinning a phone over the
 *  narration covered the text it was meant to illustrate. */
function useStageScale() {
  const [scale, setScale] = useState({ pinned: 0.8, inline: 0.72 });
  useEffect(() => {
    const calc = () => {
      const vh = window.innerHeight || 800;
      const vw = window.innerWidth || 1200;
      setScale({
        // Budget: 64px nav + 88px of slack. The slack splits evenly above and below
        // the centred phone, and the bottom half has to clear the caption pill
        // (.demo-stage-caption, 30px tall at bottom: 2px) — at 40px of slack the
        // bezel sat 12px on top of it on every viewport under ~854px tall.
        pinned: Math.max(0.55, Math.min(0.86, (vh - 64 - 88) / 844)),
        inline: Math.max(0.5, Math.min(0.74, (vw - 56) / 390)),
      });
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return scale;
}

/** Which narration block is nearest the middle of the viewport. Rect-based with
 *  a poll, matching the landing page's reveal loop — IntersectionObserver alone
 *  misbehaves in embedded webviews that freeze the CSS timeline. */
function useActiveStep(count: number) {
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const steps = Array.from(root.querySelectorAll<HTMLElement>('.demo-step'));
    if (!steps.length) return;
    const stage = root.querySelector<HTMLElement>('.demo-stage');

    /** Distance past the sticky offset over which the stage fades out. A sticky
     *  element unpins at the bottom of its containing block; without this it slides
     *  up and off over most of a viewport while the column beneath it is empty. */
    const RELEASE_FADE = 240;
    const STICKY_TOP = 64;

    const measure = () => {
      const mid = (window.innerHeight || 800) / 2;
      let best = 0;
      let bestDist = Infinity;
      steps.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActive(best);

      // Hidden below 900px, where each step carries its own inline device instead.
      if (stage && stage.offsetParent !== null) {
        const past = Math.max(0, STICKY_TOP - stage.getBoundingClientRect().top);
        const op = Math.max(0, 1 - past / RELEASE_FADE);
        stage.style.opacity = String(op);
        // Opacity alone leaves the released phone hit-testable and in the tab
        // order — Tab landed on the invisible emergency-unlock control and Enter
        // fired it from apparent whitespace. `visibility`/`pointer-events` on the
        // stage are NOT enough: .demo-stage-layer.is-on sets `visibility: visible`
        // and `pointer-events: auto` explicitly, which override the inherited
        // values. `inert` applies to the whole subtree and cannot be overridden.
        const released = op === 0;
        stage.inert = released;
        stage.classList.toggle('is-released', released);
      }
    };

    measure();
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    const poll = setInterval(measure, 400);
    const stop = setTimeout(() => clearInterval(poll), 6000);
    return () => {
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [count]);

  return { active, rootRef };
}

export function Demo() {
  const seconds = useDemoClock();
  const scale = useStageScale();
  const [unlocked, setUnlocked] = useState(false);
  const [showReason, setShowReason] = useState(false);

  const roster = unlocked ? rosterWithEmergency() : ROSTER;

  const onUnlock = () => {
    setUnlocked(true);
    setShowReason(true);
  };

  /** The focus-active phone. `interactive` decides whether the reason sheet is
   *  allowed to appear — the hold itself works wherever the control is shown. */
  const focusPhone = (s: number, interactive: boolean) => (
    <IOSFrame
      dark
      time="9:56"
      scale={s}
      label={`Student iPhone — focus active, ${unlocked ? 'unlocked' : 'focused'}`}
    >
      <StudentFocusActive
        seconds={seconds}
        unlocked={unlocked}
        onUnlock={onUnlock}
        showReason={interactive && showReason}
        onPickReason={() => setShowReason(false)}
      />
    </IOSFrame>
  );

  const SCENES = [
    {
      key: 'start',
      label: 'Start',
      caption: 'Teacher app · T9',
      title: 'The teacher starts the period',
      device: (s: number) => (
        <IOSFrame time="9:54" scale={s} label="Teacher iPhone — start a session">
          <TeacherStartSession />
        </IOSFrame>
      ),
      body: (
        <>
          <p>
            Ms. Rivera opens Bali on the way to her desk. The sheet is already filled in: the next
            bell, the class&rsquo;s usual policy, and how many students to expect.
          </p>
          <p>
            A policy in Bali is <em>just a name</em> — every session is full focus. There is no
            per-class app list to maintain, and nothing to get wrong at 9:55 in the morning.
          </p>
          <Quote label="From the app">
            Sessions end automatically at the bell — every time, no teacher action needed.
          </Quote>
        </>
      ),
    },
    {
      key: 'tapin',
      label: 'Tap in',
      caption: 'Student app · S4',
      title: 'A student taps the desk tag',
      device: (s: number) => (
        <IOSFrame dark time="9:55" scale={s} label="Student iPhone — tapped in">
          <StudentTapIn />
        </IOSFrame>
      ),
      body: (
        <>
          <p>
            There&rsquo;s an NFC tag taped to the desk. One tap resolves the class and the live
            session and shows this confirmation — the breath before focus.
          </p>
          <p>
            Nothing has been paused yet. The student sees exactly what is about to happen, then
            chooses it.
          </p>
          <ul>
            <Li>No student account to create — they join a class with a code</Li>
            <Li>A printed QR under the tag works for anything without NFC</Li>
            <Li>Tapping again after the bell does nothing</Li>
          </ul>
        </>
      ),
    },
    {
      key: 'focus',
      label: 'Focus',
      caption: 'Student app · S6',
      title: 'Everything rests until the bell',
      device: (s: number) => focusPhone(s, false),
      body: (
        <>
          <p>
            One calm screen: the countdown, the apps they kept, and the emergency exit. It sits
            face-up on the desk — nothing to hide, nothing to check.
          </p>
          <p>
            The countdown is live. Shielding is Apple&rsquo;s Screen Time, granted by the student,
            and Bali says so in plain words rather than implying something stronger.
          </p>
          <Quote label="From the app">Works without Wi-Fi. Releasing early does nothing.</Quote>
        </>
      ),
    },
    {
      key: 'shield',
      label: 'The shield',
      caption: 'iOS Screen Time shield',
      title: 'This is what a paused app looks like',
      device: (s: number) => (
        <IOSFrame dark time="10:02" scale={s} label="A shielded app — the Screen Time shield">
          <ShieldOverlay />
        </IOSFrame>
      ),
      body: (
        <>
          <p>
            Open something that&rsquo;s resting and iOS shows the shield. It names the teacher and
            the time — and, every single time, the way out.
          </p>
          <p>
            The shield never traps. That subtitle is not decoration; it is the contract, and it is
            the reason the next screen exists.
          </p>
          <ul>
            <Li>Six Apple-controlled primitives — Bali cannot fake a system dialog</Li>
            <Li>Phone and Messages are never shielded</Li>
          </ul>
        </>
      ),
    },
    {
      key: 'exit',
      label: 'The exit',
      caption: 'Student app · S6 + S7',
      title: 'The exit is always unlocked',
      device: (s: number) => focusPhone(s, true),
      body: (
        <>
          <p>
            A student having a hard moment shouldn&rsquo;t negotiate with software. One hold unlocks
            everything — instantly, even offline, with zero confirmation steps.
          </p>
          <p>
            <strong>Try it.</strong> Hold the orange control on the phone for one second. Let go
            early and nothing happens — no error, no penalty. That&rsquo;s the real behaviour.
          </p>
          {/* The teacher's side of the same moment. It lives here rather than under the
              phone so the pinned stage holds one centred device in every scene. */}
          <div className={clsx('demo-narration-toast', unlocked && 'is-on')}>
            <div>
              <span className="demo-narration-toast-label">On {DEMO.teacher}&rsquo;s dashboard</span>
              <ToastCard
                toast={{
                  id: 'demo-emergency',
                  variant: 'emergency',
                  title: 'Jordan P. used Emergency Unlock',
                  sub: 'Reason pending · 10:31',
                  action: { label: 'Open student', onClick: () => {} },
                }}
                onDismiss={() => {}}
              />
            </div>
          </div>
          <ul>
            <Li>Their teacher is notified, never &ldquo;reported&rdquo;</Li>
            <Li>Sharing a reason is optional — Skip is styled exactly like the rest</Li>
            <Li>Re-focusing is one tap on the tag whenever they&rsquo;re ready</Li>
          </ul>
        </>
      ),
    },
  ];

  const { active, rootRef } = useActiveStep(SCENES.length);

  return (
    <div className="demo">
      {/* ---------------- nav ---------------- */}
      <nav className="demo-nav">
        <div className="wrap">
          <Link className="demo-wordmark" href="/">
            <ArcMark size={24} />
            Bali
          </Link>
          <span style={{ flex: 1 }} />
          <Link className="demo-navlink demo-nav-hideable" href="/#how">
            How it works
          </Link>
          <Link className="demo-navlink demo-nav-hideable" href="/privacy">
            Privacy
          </Link>
          <Link className="demo-navlink demo-nav-hideable" href="/login">
            Sign in
          </Link>
          <Link className="demo-nav-cta" href="/#demo">
            Book a demo
          </Link>
        </div>
      </nav>

      {/* ---------------- intro ---------------- */}
      <header className="demo-intro">
        <div className="wrap">
          <span className="kicker">
            <ArcMark size={15} />
            The walkthrough
          </span>
          <h1>
            One period, <em>end to end.</em>
          </h1>
          <p>
            Every screen below is the real product — the student app, the teacher app, and the
            dashboard, rebuilt here from the same design tokens and the same copy that ships. Scroll
            to move through a single 50-minute period.
          </p>
          <div className="demo-intro-meta">
            <span>
              <ShieldCheck size={14} strokeWidth={ICON_STROKE} />
              Built on Apple Screen Time
            </span>
            <span>
              <Zap size={14} strokeWidth={ICON_STROKE} />
              The emergency exit below actually works
            </span>
            <span>
              <EyeOff size={14} strokeWidth={ICON_STROKE} />
              No real students, rosters or schools
            </span>
          </div>
        </div>
      </header>

      {/* ---------------- the track ---------------- */}
      <div className="wrap">
        <div className="demo-track-inner" ref={rootRef}>
          {/* Pinned stage — desktop only; hidden under 900px. */}
          <div className="demo-stage">
            <div className="demo-stage-inner">
              {SCENES.map((sc, i) => (
                <div key={sc.key} className={clsx('demo-stage-layer', active === i && 'is-on')}>
                  {sc.device(scale.pinned)}
                </div>
              ))}
              <span className="demo-stage-caption">{SCENES[active]?.caption}</span>
            </div>
          </div>

          <div className="demo-narration">
            {SCENES.map((sc, i) => (
              <section key={sc.key} className={clsx('demo-step', active === i && 'is-active')}>
                <div className="demo-step-body">
                  <div className="demo-step-num">
                    <i>{String(i + 1).padStart(2, '0')}</i>
                    {sc.label}
                  </div>
                  <h2>{sc.title}</h2>
                  {/* Inline device — narrow screens only; the pinned stage is hidden there. */}
                  <div className="demo-step-device">{sc.device(scale.inline)}</div>
                  {sc.body}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- the live grid, full width ---------------- */}
      <LiveGridSection roster={roster} seconds={seconds} unlocked={unlocked} />

      {/* ---------------- the recap ---------------- */}
      <section className="demo-closing">
        <div className="wrap">
          <div className="demo-closing-grid">
            <div className="demo-closing-copy">
              <div className="demo-step-num">
                <i>07</i> The bell
              </div>
              <h2>What&rsquo;s left behind</h2>
              <p>
                At the bell the session closes itself and the recap appears. Counts, the one
                emergency listed plainly, and a nudge — not a verdict.
              </p>
              <p>
                No scoreboard, no ranking, no red. On a period where nothing happened, this screen
                simply says <em>&ldquo;Smooth period.&rdquo;</em> and gets out of the way.
              </p>
              <Quote label="From the app">Patterns are conversation starters, not verdicts.</Quote>
            </div>
            <div className="demo-closing-stage">
              <IOSFrame
                time="10:45"
                scale={Math.min(scale.pinned, 0.78)}
                label="Teacher iPhone — session recap"
              >
                <TeacherRecap variant="incident" />
              </IOSFrame>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section className="demo-outro">
        <div className="wrap">
          <div className="demo-outro-card">
            <h2>See it with your own roster</h2>
            <p>
              A 20-minute walkthrough with a real session — tags, the live grid, and the emergency
              exit included. Free for your first class.
            </p>
            <div className="demo-outro-actions">
              <Link className="demo-btn-solid" href="/#demo">
                Book a demo
              </Link>
              <Link className="demo-btn-outline" href="/privacy">
                Read the privacy contract
              </Link>
            </div>
            <div className="demo-outro-fine">
              Teachers see focus status, tap-in and tap-out times, and unlock times — never screens,
              app lists, messages, browsing or location.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

function Li({ children }: { children: React.ReactNode }) {
  return (
    <li>
      <CircleCheck size={16} strokeWidth={ICON_STROKE} />
      <span>{children}</span>
    </li>
  );
}

function Quote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="demo-quote">
      <b>{label}</b>
      {children}
    </div>
  );
}

function LiveGridSection({
  roster,
  seconds,
  unlocked,
}: {
  roster: ReturnType<typeof rosterWithEmergency>;
  seconds: number;
  unlocked: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const fit = el.offsetWidth / 1120;
      // Below ~0.75 the chip labels stop being readable, so narrow screens keep
      // the dashboard at a legible size and pan it sideways instead.
      const next = Math.min(1, Math.max(0.75, fit));
      setScale(next);
      setPanning(next > fit + 0.001);
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <section className="demo-feature">
      <div className="wrap">
        <div className="demo-feature-head">
          <div className="demo-step-num">
            <i>06</i> For teachers
          </div>
          <h2>&ldquo;Is anything wrong?&rdquo; — answered from six feet</h2>
          <p>
            The live grid is ambient peripheral vision, not another dashboard to manage. Every state
            is an icon plus a label, legible across the room and on a washed-out projector.
          </p>
        </div>
        <div className={clsx('demo-feature-stage', panning && 'is-panning')} ref={ref}>
          <BrowserFrame
            scale={scale}
            height={620}
            label="Teacher dashboard — live grid"
            url="app.trybali.com/app/classes/algebra-ii/live"
          >
            <DashboardLive roster={roster} seconds={seconds} toast={unlocked} />
          </BrowserFrame>
        </div>
        {panning ? <p className="demo-feature-swipe">Swipe the dashboard to see the whole room →</p> : null}
        <p className="demo-feature-note">
          {unlocked ? (
            <>
              <Bell size={14} strokeWidth={ICON_STROKE} />
              <span>
                That orange card is the unlock you just did, arriving on the teacher&rsquo;s screen
                — warm, never an alarm.
              </span>
            </>
          ) : (
            <>
              <Nfc size={14} strokeWidth={ICON_STROKE} />
              <span>
                Names light up as students tap in. Scroll back up and hold the emergency control to
                watch this grid react.
              </span>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

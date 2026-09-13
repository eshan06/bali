'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Bell, CircleCheck, EyeOff, Maximize2, Monitor, Nfc, ShieldCheck, Smartphone } from 'lucide-react';
import { ArcMark } from '@/components/bali/ArcMark';
import { ToastCard } from '@/components/bali/Toaster';
import { ICON_STROKE } from '@/components/bali/icons';
import { BrowserFrame } from '@/components/demo/BrowserFrame';
import { IOSFrame } from '@/components/demo/IOSFrame';
import { DEMO, ROSTER, rosterWithEmergency } from '@/components/demo/demoData';
import { DashboardLive } from '@/components/demo/screens/DashboardLive';
import { DashboardReports } from '@/components/demo/screens/DashboardReports';
import { TeacherHome } from '@/components/demo/screens/TeacherHome';
import { TeacherStudentSheet } from '@/components/demo/screens/TeacherStudentSheet';
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
      key: 'hub',
      label: 'The hub',
      surface: 'teacher' as const,
      ref: 'T1 · Home',
      title: 'Before the bell, it\u2019s a list',
      device: (s: number) => (
        <IOSFrame time="9:54" scale={s} label="Teacher iPhone — home">
          <TeacherHome />
        </IOSFrame>
      ),
      body: (
        <>
          <p>
            The whole teacher app at 9:54: the date, today&rsquo;s periods in the order they
            happen, and what changed since yesterday. Period 1 is finished and grey. Period 3 has a
            Start next to it.
          </p>
          <p>
            There is no setup hiding behind this screen — no per-class app list to curate, nothing
            scheduled that can quietly go wrong. A policy in Bali is just a name.
          </p>
          <ul>
            <Li>Approvals are a row, not an inbox</Li>
            <Li>A class that is neither live nor due shows no buttons at all</Li>
            <Li>Every line in the feed is an event, never a measurement</Li>
          </ul>
        </>
      ),
    },
    {
      key: 'start',
      label: 'Start',
      surface: 'teacher' as const,
      ref: 'T9 · Start session',
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
      surface: 'student' as const,
      ref: 'S4 · Tap-in',
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
      surface: 'student' as const,
      ref: 'S6 · Focus active',
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
      surface: 'ios' as const,
      ref: 'Screen Time shield',
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
      surface: 'student' as const,
      ref: 'S6 + S7 · The exit',
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
          {/* Three surfaces, named once up front — every screen below is badged. */}
          <div className="demo-legend">
            <span className="demo-legend-lead">Three surfaces:</span>
            <SurfaceBadge surface="student" />
            <SurfaceBadge surface="teacher" />
            <SurfaceBadge surface="web" />
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
              <span className="demo-stage-caption">
                <SurfaceBadge surface={SCENES[active]?.surface ?? 'student'} detail={SCENES[active]?.ref} />
              </span>
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

      {/* ---------------- one student (T3) — device left, copy right, so it
           doesn't read as a repeat of the closing two-column ---------------- */}
      <section className="demo-closing demo-closing--flip">
        <div className="wrap">
          <div className="demo-closing-grid">
            <div className="demo-closing-stage">
              <IOSFrame
                time="10:36"
                scale={Math.min(scale.pinned, 0.78)}
                label="Teacher iPhone — student detail"
              >
                <TeacherStudentSheet />
              </IOSFrame>
              <SurfaceBadge surface="teacher" detail="T3 · Student detail" />
            </div>
            <div className="demo-closing-copy">
              <div className="demo-step-num">
                <i>08</i> One student
              </div>
              <h2>Everything Bali knows about Jordan</h2>
              <p>
                This is what <strong>Open student</strong> opens. The session so far as a timeline,
                and two things a teacher can actually do: give a student time out of the room, or
                mark them without a device today.
              </p>
              <p>
                The pass ends itself. Switch to <strong>Recent</strong> and there is no score —
                five past sessions, one line each. Nothing here can be sorted, ranked or exported.
              </p>
              <ul>
                <Li>The no-device switch is for one day, not a label that follows him</Li>
                <Li>Timestamps and states are the only student-level detail that exists</Li>
                <Li>The last line of the sheet is the privacy contract, on the screen</Li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- the recap ---------------- */}
      <section className="demo-closing">
        <div className="wrap">
          <div className="demo-closing-grid">
            <div className="demo-closing-copy">
              <div className="demo-step-num">
                <i>09</i> The bell
              </div>
              <h2>What&rsquo;s left behind</h2>
              <p>
                At the bell the session closes itself and the recap appears. Counts, the one
                emergency listed plainly, and a nudge — not a verdict.
              </p>
              <p>
                Two periods, two recaps. One had an unlock in it. The other didn&rsquo;t, and the
                screen says so in two words and stops.
              </p>
              <Quote label="From the app">Patterns are conversation starters, not verdicts.</Quote>
            </div>
            <div className="demo-closing-stage demo-closing-stage--pair">
              <IOSFrame
                time="10:45"
                scale={Math.min(scale.pinned, 0.56)}
                label="Teacher iPhone — session recap with an emergency"
              >
                <TeacherRecap variant="incident" />
              </IOSFrame>
              <IOSFrame
                time="11:45"
                scale={Math.min(scale.pinned, 0.56)}
                label="Teacher iPhone — a clean session recap"
              >
                <TeacherRecap variant="clean" />
              </IOSFrame>
              <SurfaceBadge surface="teacher" detail="T10 · Session recap" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- reports: the same period, six weeks out ---------------- */}
      <ReportsSection />

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
              Shielding happens on the phone, through Apple Screen Time. Teachers see focus status,
              tap-in and tap-out times, and unlock times — never screens, app lists, messages,
              browsing or location, because iOS never hands those to us.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- small pieces ---------------- */

/** Which product a screen belongs to. Dark badges are what the STUDENT sees
 *  (their app is dark-first, and so is the system shield); light badges are the
 *  teacher's side. The label is spelled out — the icon alone can't tell two
 *  iPhone apps apart. */
export type Surface = 'student' | 'teacher' | 'web' | 'ios';

const SURFACES: Record<Surface, { label: string; Icon: typeof Smartphone; dark: boolean }> = {
  student: { label: 'Student app', Icon: Smartphone, dark: true },
  ios: { label: 'iOS system', Icon: ShieldCheck, dark: true },
  teacher: { label: 'Teacher app', Icon: Smartphone, dark: false },
  web: { label: 'Teacher dashboard · web', Icon: Monitor, dark: false },
};

function SurfaceBadge({ surface, detail }: { surface: Surface; detail?: string }) {
  const { label, Icon, dark } = SURFACES[surface];
  return (
    <span className={clsx('demo-surface', dark ? 'is-dark' : 'is-light')}>
      <Icon size={13} strokeWidth={ICON_STROKE} />
      <b>{label}</b>
      {detail ? <i>{detail}</i> : null}
    </span>
  );
}

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
  const [projector, setProjector] = useState(false);

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
            <i>07</i> For teachers
          </div>
          <h2>&ldquo;Is anything wrong?&rdquo; — answered from six feet</h2>
          <p>
            The live grid is ambient peripheral vision, not another dashboard to manage. Every state
            is an icon plus a label, legible across the room and on a washed-out projector.
          </p>
        </div>
        <div className="demo-switch" role="group" aria-label="Dashboard view">
          <button
            type="button"
            className={clsx('demo-switch-btn', !projector && 'is-on')}
            aria-pressed={!projector}
            onClick={() => setProjector(false)}
          >
            On her laptop
          </button>
          <button
            type="button"
            className={clsx('demo-switch-btn', projector && 'is-on')}
            aria-pressed={projector}
            onClick={() => setProjector(true)}
          >
            On the board
          </button>
        </div>

        <div className={clsx('demo-feature-stage', panning && 'is-panning')} ref={ref}>
          <BrowserFrame
            scale={scale}
            // Projector chips are 'proj' size; 28 of them need the extra room.
            height={projector ? 664 : 620}
            label={projector ? 'Teacher dashboard — projector mode' : 'Teacher dashboard — live grid'}
            url={
              projector
                ? 'app.trybali.com/app/classes/algebra-ii/live?projector=1'
                : 'app.trybali.com/app/classes/algebra-ii/live'
            }
          >
            <DashboardLive
              roster={roster}
              seconds={seconds}
              toast={unlocked}
              projector={projector}
            />
          </BrowserFrame>
        </div>
        <div className="demo-feature-badge">
          <SurfaceBadge surface="web" detail={projector ? 'Projector mode' : 'Live grid'} />
        </div>
        {panning ? <p className="demo-feature-swipe">Swipe the dashboard to see the whole room →</p> : null}
        <p className="demo-feature-note">
          {projector ? (
            <>
              <Maximize2 size={14} strokeWidth={ICON_STROKE} />
              <span>
                Same grid thrown on the board: four columns, twice the type size, and nothing
                clickable — projector mode can&rsquo;t open a student. The room sees exactly what
                the teacher sees.
              </span>
            </>
          ) : unlocked ? (
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

function ReportsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const fit = el.offsetWidth / 1120;
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
    <section className="demo-feature demo-feature--reports">
      <div className="wrap">
        <div className="demo-feature-head">
          <div className="demo-step-num">
            <i>10</i> Weeks later
          </div>
          <h2>Still not a scoreboard</h2>
          <p>
            Jordan&rsquo;s 10:31 shows up once more, six weeks out: one row, one reason, six small
            bars. Beside it, average focus minutes per class — averages, never students.
          </p>
        </div>
        <div className={clsx('demo-feature-stage', panning && 'is-panning')} ref={ref}>
          <BrowserFrame
            scale={scale}
            height={520}
            label="Teacher dashboard — reports"
            url="app.trybali.com/app/reports"
          >
            <DashboardReports />
          </BrowserFrame>
        </div>
        <div className="demo-feature-badge">
          <SurfaceBadge surface="web" detail="Reports" />
        </div>
        <p className="demo-feature-note">
          <EyeOff size={14} strokeWidth={ICON_STROKE} />
          <span>
            There is nothing to sort and nothing per-student to export. A month with no unlocks in
            it says so, and leaves it there.
          </span>
        </p>
      </div>
    </section>
  );
}

'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Calculator,
  Check,
  Circle,
  CircleCheck,
  Eye,
  EyeOff,
  LockOpen,
  MessageCircle,
  MessageCircleQuestion,
  Nfc,
  NotebookPen,
  Phone,
  ShieldCheck,
  Smartphone,
  Ticket,
  Zap,
} from 'lucide-react';
import { ArcMark } from '@/components/bali/ArcMark';
import { FORM_EMAIL, MAX_SUBMISSIONS, recordSubmission, submissionCount } from '@/lib/forms';
import { ICON_STROKE } from '@/components/bali/icons';
import '@/styles/landing.css';

const UNLOCK_IDLE_LABEL = 'Hold to unlock — your teacher will be notified';

/** The interactive hold-to-unlock demo (hero + dark band). 1.0s linear fill; early
 *  release springs back with no error; Enter/Space completes in one step (a11y). */
function HoldToUnlock({ doneLabel, iconSize = 15 }: { doneLabel: string; iconSize?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const fillLabelRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'idle' | 'filling' | 'springback' | 'complete'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The clipped duplicate label must match the control's width exactly.
  useEffect(() => {
    const el = elRef.current;
    const fl = fillLabelRef.current;
    if (!el || !fl) return;
    const size = () => {
      fl.style.width = `${el.offsetWidth}px`;
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const complete = () => {
    timer.current = null;
    setPhase('complete');
    resetTimer.current = setTimeout(() => setPhase('idle'), 2400);
  };

  const start = (e: React.PointerEvent) => {
    if (phase === 'complete') return;
    e.preventDefault();
    setPhase('filling');
    timer.current = setTimeout(complete, 1000);
  };

  const cancel = () => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    setPhase('springback'); // no error, no punishment
  };

  return (
    <div
      ref={elRef}
      className={clsx(
        'fc-unlock',
        phase === 'filling' && 'is-filling',
        phase === 'springback' && 'is-springback',
        phase === 'complete' && 'is-complete',
      )}
      tabIndex={0}
      role="button"
      aria-label="Emergency unlock demo. Hold for one second. Your teacher will be notified."
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (phase !== 'complete') complete();
        }
      }}
    >
      <span className="base-label">
        {phase === 'complete' ? (
          <>
            <Check size={16} strokeWidth={ICON_STROKE} />
            {doneLabel}
          </>
        ) : (
          <>
            <LockOpen size={iconSize} strokeWidth={ICON_STROKE} />
            {UNLOCK_IDLE_LABEL}
          </>
        )}
      </span>
      <span className="fill" style={{ width: phase === 'filling' ? '100%' : '0%' }}>
        <span className="fill-label" ref={fillLabelRef}>
          <LockOpen size={iconSize} strokeWidth={ICON_STROKE} />
        </span>
      </span>
      <span className="sr-only" aria-live="polite">
        {phase === 'complete' ? doneLabel : ''}
      </span>
    </div>
  );
}

/** 198px live arc: draws in once on load (1100ms), then ticks every second with the
 *  transition suppressed — tabular numerals, zero layout shift. */
function HeroArc() {
  const fillRef = useRef<SVGCircleElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const R = 94;
    const C = 2 * Math.PI * R;
    const fill = fillRef.current;
    const time = timeRef.current;
    if (!fill || !time) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let remain = 23 * 60 + 14;
    const total = 50 * 60;

    fill.style.strokeDasharray = String(C);
    fill.style.strokeDashoffset = String(reduced ? C * (1 - remain / total) : C);
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        fill.style.strokeDashoffset = String(C * (1 - remain / total));
      });
    });
    const iv = setInterval(() => {
      remain = Math.max(0, remain - 1);
      const m = Math.floor(remain / 60);
      const s = String(remain % 60).padStart(2, '0');
      time.textContent = `${m}:${s}`;
      fill.style.transition = 'none';
      fill.style.strokeDashoffset = String(C * (1 - remain / total));
    }, 1000);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="fc-arc" style={{ width: 198, height: 198 }}>
      <svg width={198} height={198}>
        <circle cx={99} cy={99} r={94} fill="none" stroke="#2E2B27" strokeWidth={9} />
        <circle
          id="heroArcFill"
          ref={fillRef}
          cx={99}
          cy={99}
          r={94}
          fill="none"
          stroke="#62A483"
          strokeWidth={9}
          strokeLinecap="round"
        />
      </svg>
      <div className="stack">
        <span className="time" ref={timeRef}>
          23:14
        </span>
        <span className="until">until 10:45</span>
      </div>
    </div>
  );
}

const KICKER_MARK = (
  <svg viewBox="0 0 20 20" fill="none" style={{ width: 15, height: 15 }} aria-hidden="true">
    <circle cx="10" cy="10" r="7.5" stroke="var(--green-200)" strokeWidth="3.4" />
    <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="var(--green-600)" strokeWidth="3.4" strokeLinecap="round" />
  </svg>
);

/** Demo-request capture. No leads backend yet, so this composes a prefilled email to
 *  the sales inbox (honest + functional) and confirms inline — not a dead anchor. */
const DEMO_EMAIL = FORM_EMAIL;

function DemoForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  // Read after mount — localStorage does not exist while rendering on the server.
  const [used, setUsed] = useState(0);
  useEffect(() => setUsed(submissionCount('demo')), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    const subject = encodeURIComponent('Bali demo request');
    const body = encodeURIComponent(
      `Hi Bali team,\n\nI'd like a demo for my classroom.\n\nSchool email: ${email}\n`,
    );
    window.location.href = `mailto:${DEMO_EMAIL}?subject=${subject}&body=${body}`;
    setUsed(recordSubmission('demo'));
    setSent(true);
  };

  if (used >= MAX_SUBMISSIONS && !sent) {
    return (
      <div className="demoform-sent" role="status">
        <Check size={18} strokeWidth={ICON_STROKE} />
        <span>
          You&rsquo;ve requested a demo {MAX_SUBMISSIONS} times from this browser. If we
          haven&rsquo;t replied, write to <a href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>.
        </span>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="demoform-sent" role="status">
        <Check size={18} strokeWidth={ICON_STROKE} />
        <span>
          Thanks — your email app should open. If not, write us at{' '}
          <a href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>.
        </span>
      </div>
    );
  }

  return (
    <form className="demoform" onSubmit={submit} noValidate>
      <input
        type="email"
        name="email"
        required
        placeholder="you@school.edu"
        aria-label="School email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="btn btn--primary btn--big" type="submit">
        Book a demo
      </button>
    </form>
  );
}

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);

  /* Scroll reveal — rect-based with a 250ms retry poll and JS snap timers.
   * IntersectionObserver alone and fixed-time retries both failed in embedded
   * webviews that freeze the CSS timeline (design doc 06 §frozen-timeline). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const risers = Array.from(root.querySelectorAll<HTMLElement>('.rise'));
    const snapTimers: Array<ReturnType<typeof setTimeout>> = [];

    function reveal(): number {
      const vh = window.innerHeight || document.documentElement.clientHeight || 800;
      let matched = 0;
      risers.forEach((el) => {
        if (el.classList.contains('in')) {
          matched++;
          return;
        }
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) {
          matched++;
          el.classList.add('in');
          el.style.opacity = '1';
          el.style.transform = 'none';
          snapTimers.push(
            setTimeout(() => {
              el.style.transition = 'none';
              el.querySelectorAll<HTMLElement>('.pop').forEach((p) => {
                p.style.transition = 'none';
                p.style.opacity = '1';
                p.style.transform = 'none';
              });
            }, 1050),
          );
        }
      });
      return matched;
    }

    window.addEventListener('scroll', reveal, { passive: true });
    window.addEventListener('resize', reveal);
    reveal();
    const poll = setInterval(() => {
      if (reveal() > 0) clearInterval(poll);
    }, 250);
    const pollStop = setTimeout(() => clearInterval(poll), 8000);
    const settle = setTimeout(() => root.classList.add('anim-settled'), 1900);

    return () => {
      window.removeEventListener('scroll', reveal);
      window.removeEventListener('resize', reveal);
      clearInterval(poll);
      clearTimeout(pollStop);
      clearTimeout(settle);
      snapTimers.forEach(clearTimeout);
    };
  }, []);

  /* Cursor tilt + chip parallax — fine pointers only, lerped rAF loop. */
  useEffect(() => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !window.matchMedia('(pointer: fine)').matches
    )
      return;
    const hero = heroRef.current;
    const stage = stageRef.current;
    const phone = phoneRef.current;
    if (!hero || !stage || !phone) return;
    const chips = Array.from(stage.querySelectorAll<HTMLElement>('.floatchip'));
    let tx = 0,
      ty = 0,
      cx = 0,
      cy = 0,
      raf: number | null = null;

    function loop() {
      raf = requestAnimationFrame(() => {
        cx += (tx - cx) * 0.085;
        cy += (ty - cy) * 0.085;
        phone!.style.transform = `perspective(1100px) rotateY(${(cx * 8).toFixed(2)}deg) rotateX(${(-cy * 6).toFixed(2)}deg)`;
        chips.forEach((ch) => {
          const d = parseFloat(ch.dataset.depth || '1');
          ch.style.translate = `${(cx * 24 * d).toFixed(1)}px ${(cy * 18 * d).toFixed(1)}px`;
        });
        if (Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002) loop();
        else raf = null;
      });
    }
    const onMove = (e: MouseEvent) => {
      const r = stage.getBoundingClientRect();
      tx = Math.max(-0.65, Math.min(0.65, (e.clientX - (r.left + r.width / 2)) / r.width));
      ty = Math.max(-0.65, Math.min(0.65, (e.clientY - (r.top + r.height / 2)) / r.height));
      if (!raf) loop();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      if (!raf) loop();
    };
    hero.addEventListener('mousemove', onMove);
    hero.addEventListener('mouseleave', onLeave);
    return () => {
      hero.removeEventListener('mousemove', onMove);
      hero.removeEventListener('mouseleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="landing" ref={rootRef}>
      <nav className="topnav">
        <div className="wrap">
          <span className="wordmark">
            <ArcMark size={24} />
            Bali
          </span>
          <span style={{ flex: 1 }} />
          <Link className="navlink" href="/demo">
            Walkthrough
          </Link>
          <Link className="navlink" href="/contact">
            Contact
          </Link>
          <a className="navlink" href="#privacy">
            Privacy
          </a>
          <a className="btn btn--primary" href="#demo" style={{ padding: '9px 18px', fontSize: 14 }}>
            Book a demo
          </a>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="hero" ref={heroRef}>
        <div className="ambient" aria-hidden="true">
          <svg className="orbit orbit-a" width="960" height="960" viewBox="0 0 960 960">
            <circle cx="480" cy="480" r="462" fill="none" stroke="var(--green-200)" strokeWidth="2" strokeDasharray="5 16" />
          </svg>
          <svg className="orbit orbit-b" width="1340" height="1340" viewBox="0 0 1340 1340">
            <circle cx="670" cy="670" r="652" fill="none" stroke="var(--stone-200)" strokeWidth="2" strokeDasharray="2 12" />
          </svg>
        </div>
        <div className="wrap">
          <div>
            <div className="kicker rise">
              {KICKER_MARK}
              Bali for schools
            </div>
            <h1 className="display rise" style={{ transitionDelay: '80ms' }}>
              Fifty focused minutes. <em>One tap.</em>
            </h1>
            <p className="lede rise" style={{ transitionDelay: '160ms' }}>
              Students tap a desk tag and their distractions rest until the bell. Teachers see one
              calm grid. And the emergency exit is always one hold away — no questions asked.
            </p>
            <div className="hero-ctas rise" style={{ transitionDelay: '240ms' }}>
              <a className="btn btn--primary btn--big" href="#demo">
                Book a demo
              </a>
              <Link className="btn btn--ghost btn--big" href="/demo">
                See the walkthrough
              </Link>
            </div>
            <div className="trustline rise" style={{ transitionDelay: '320ms' }}>
              <ShieldCheck size={15} strokeWidth={ICON_STROKE} />
              Built on Apple Screen Time · Students always hold the exit
            </div>
          </div>

          <div className="stagebox rise" style={{ transitionDelay: '200ms' }} ref={stageRef}>
            <div className="phone" ref={phoneRef}>
              <div className="cls">
                <b>Period 3 — Algebra II</b>
                <span>with Ms. Rivera · ends 10:45 AM</span>
              </div>
              <HeroArc />
              <div className="apps">
                <span className="a">
                  <Phone strokeWidth={ICON_STROKE} />
                  Phone
                </span>
                <span className="a">
                  <MessageCircle strokeWidth={ICON_STROKE} />
                  Messages
                </span>
                <span className="a">
                  <NotebookPen strokeWidth={ICON_STROKE} />
                  Notes
                </span>
                <span className="a">
                  <Calculator strokeWidth={ICON_STROKE} />
                  Calc
                </span>
              </div>
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
                <HoldToUnlock doneLabel="Unlocked — Ms. Rivera was notified" />
                <span className="fc-holdhint">Try it — hold for one second</span>
              </div>
            </div>
            <span className="fc-chip fc-chip--mini is-focused floatchip" data-depth="0.9" style={{ top: 56, left: -42 }}>
              <CircleCheck strokeWidth={ICON_STROKE} />
              <span className="lbl">Jordan P. · Focused</span>
            </span>
            <span
              className="fc-chip fc-chip--mini is-pass floatchip"
              data-depth="1.5"
              style={{ top: 168, right: -54, animationDelay: '-2.2s' }}
            >
              <Ticket strokeWidth={ICON_STROKE} />
              <span className="lbl">Pass · 4:32</span>
            </span>
            <span
              className="fc-chip fc-chip--mini is-focused floatchip"
              data-depth="1.2"
              style={{ bottom: 120, left: -64, animationDelay: '-3.8s' }}
            >
              <CircleCheck strokeWidth={ICON_STROKE} />
              <span className="lbl">22 Focused</span>
            </span>
          </div>
        </div>
      </header>

      {/* ============ HOW IT WORKS ============ */}
      <section className="band" id="how">
        <div className="wrap">
          <div className="sec-head rise">
            <div className="kicker">How it works</div>
            <h2 className="sec">A focus session is a shared agreement — made visible</h2>
            <p className="sec-sub">
              No surveillance, no lockdown theater. Bali shows everyone the same honest picture:
              who's in, until when, and that everything rests except the few apps each student keeps.
            </p>
          </div>
          <div className="steps">
            <div className="step rise">
              <div className="num">01</div>
              <div className="ic pop">
                <Nfc strokeWidth={ICON_STROKE} />
              </div>
              <h3>Tap the desk tag</h3>
              <p>
                Students tap an NFC tag (or scan its QR) as they sit down. Apple Screen Time quiets
                every app except the few each student kept for themselves — and the Phone app always stays.
              </p>
            </div>
            <div className="step rise" style={{ transitionDelay: '100ms' }}>
              <div className="num">02</div>
              <div className="ic pop" style={{ transitionDelay: '80ms' }}>
                <CircleCheck strokeWidth={ICON_STROKE} />
              </div>
              <h3>Focus together</h3>
              <p>
                Each phone shows one calm screen: the countdown, the apps they kept, and the emergency
                exit. It sits face-up on the desk — nothing to hide, nothing to check.
              </p>
            </div>
            <div className="step rise" style={{ transitionDelay: '200ms' }}>
              <div className="num">03</div>
              <div className="ic pop" style={{ transitionDelay: '160ms' }}>
                <Bell strokeWidth={ICON_STROKE} />
              </div>
              <h3>The bell ends it</h3>
              <p>
                Sessions end automatically at the bell — every time, no teacher action needed.
                Passes for the nurse or office return shields on their own, too.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TRUST / EMERGENCY ============ */}
      <section className="band" id="trust" style={{ paddingTop: 24 }}>
        <div className="wrap">
          <div className="darkband rise">
            <div>
              <div className="kicker" style={{ color: 'var(--orange-300)' }}>
                The part we designed first
              </div>
              <h2 className="sec">The exit is always unlocked</h2>
              <p className="sec-sub">
                A student having a hard moment shouldn't negotiate with software. One hold unlocks
                everything — instantly, even offline, with zero confirmation steps. Their teacher is
                notified, never "reported."
              </p>
              <ul>
                <li>
                  <Zap strokeWidth={ICON_STROKE} />
                  Works without Wi-Fi or signal — the unlock is on the device
                </li>
                <li>
                  <MessageCircleQuestion strokeWidth={ICON_STROKE} />
                  Sharing a reason afterwards is optional; Skip is a first-class answer
                </li>
                <li>
                  <Eye strokeWidth={ICON_STROKE} />
                  Honest by design: shielding is consent-based Screen Time, and we say so
                </li>
              </ul>
            </div>
            <div className="holdwrap">
              <HoldToUnlock doneLabel="Unlocked — that's the whole flow" iconSize={17} />
              <span className="fc-holdhint">
                Live demo — hold for one second, or let go early (nothing happens)
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TEACHER GLANCE ============ */}
      <section className="band">
        <div className="wrap twocol">
          <div className="rise">
            <div className="kicker">For teachers</div>
            <h2 className="sec">"Is anything wrong?" — answered from six feet</h2>
            <p className="sec-sub">
              The live grid is ambient peripheral vision, not another dashboard to manage. A summary
              strip carries the one-second read; every state is an icon plus a label, legible across
              the room and on a washed-out projector.
            </p>
            <div style={{ marginTop: 28 }}>
              <Link className="btn btn--ghost" href="/demo">
                See the live grid in the walkthrough
              </Link>
            </div>
          </div>
          <div className="glance rise" style={{ transitionDelay: '120ms' }}>
            <div className="gsum">
              <span className="fc-chip fc-chip--mini is-focused">
                <CircleCheck strokeWidth={ICON_STROKE} />
                <span className="lbl">22 Focused</span>
              </span>
              <span className="fc-chip fc-chip--mini is-notjoined">
                <Circle strokeWidth={ICON_STROKE} />
                <span className="lbl">2 Not in</span>
              </span>
              <span className="fc-chip fc-chip--mini is-pass">
                <Ticket strokeWidth={ICON_STROKE} />
                <span className="lbl">1 Pass</span>
              </span>
              <span className="fc-chip fc-chip--mini is-emergency">
                <LockOpen strokeWidth={ICON_STROKE} />
                <span className="lbl">1 Unlocked</span>
              </span>
            </div>
            <div className="ggrid">
              {(
                [
                  ['focused', 'Jordan P.', 0],
                  ['focused', 'Lena W.', 50],
                  ['pass', 'Aisha K.', 100],
                  ['emergency', 'Sam T.', 150],
                  ['focused', 'Noor H.', 200],
                  ['notjoined', 'Maya R.', 250],
                  ['focused', 'Tavi O.', 300],
                  ['focused', 'Ethan C.', 350],
                  ['focused', 'Zoe B.', 400],
                ] as Array<[string, string, number]>
              ).map(([state, name, delay]) => (
                <span
                  key={name}
                  className={`fc-chip is-${state} pop`}
                  style={delay ? { transitionDelay: `${delay}ms` } : undefined}
                >
                  {state === 'focused' ? (
                    <CircleCheck strokeWidth={ICON_STROKE} />
                  ) : state === 'pass' ? (
                    <Ticket strokeWidth={ICON_STROKE} />
                  ) : state === 'emergency' ? (
                    <LockOpen strokeWidth={ICON_STROKE} />
                  ) : (
                    <Circle strokeWidth={ICON_STROKE} />
                  )}
                  {name}
                </span>
              ))}
            </div>
            <div className="gfoot">Live view · Period 3 — Algebra II · ends 10:45</div>
          </div>
        </div>
      </section>

      {/* ============ PRIVACY ============ */}
      <section className="band" id="privacy" style={{ paddingTop: 30 }}>
        <div className="wrap">
          <div className="sec-head rise">
            <div className="kicker">The privacy contract</div>
            <h2 className="sec">Students read the whole list on day one</h2>
            <p className="sec-sub">
              This exact card appears in onboarding and again in Settings. It never grows without
              asking again.
            </p>
          </div>
          <div className="contract rise" style={{ transitionDelay: '100ms' }}>
            <div>
              <div className="clabel" style={{ color: 'var(--green-700)' }}>
                A teacher sees
              </div>
              <ul>
                <li>
                  <CircleCheck strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  Focus status — focused, on a pass, or unlocked
                </li>
                <li>
                  <CircleCheck strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  When a student taps in and out
                </li>
                <li>
                  <CircleCheck strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  Unlock times, and a reason if the student shares one
                </li>
              </ul>
            </div>
            <div>
              <div className="clabel" style={{ color: 'var(--text-tertiary)' }}>
                Never sees
              </div>
              <ul style={{ color: 'var(--text-secondary)' }}>
                <li>
                  <EyeOff strokeWidth={ICON_STROKE} style={{ color: 'var(--text-tertiary)' }} />
                  Screens, or anything on them
                </li>
                <li>
                  <EyeOff strokeWidth={ICON_STROKE} style={{ color: 'var(--text-tertiary)' }} />
                  App lists, messages, or browsing
                </li>
                <li>
                  <EyeOff strokeWidth={ICON_STROKE} style={{ color: 'var(--text-tertiary)' }} />
                  Location — Bali never asks for it
                </li>
              </ul>
            </div>
            <div>
              <div className="clabel" style={{ color: 'var(--green-700)' }}>
                Because it&rsquo;s on-device
              </div>
              <ul>
                <li>
                  <Smartphone strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  Apple Screen Time does the shielding
                </li>
                <li>
                  <Smartphone strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  iOS never hands that data to us
                </li>
                <li>
                  <Smartphone strokeWidth={ICON_STROKE} style={{ color: 'var(--green-600)' }} />
                  Only focus status and times leave the phone
                </li>
              </ul>
            </div>
          </div>
          <div className="rise" style={{ marginTop: 24, textAlign: 'center' }}>
            <Link className="navlink" href="/privacy" style={{ fontWeight: 600 }}>
              Read the full privacy policy →
            </Link>
          </div>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="band" id="demo" style={{ paddingTop: 20 }}>
        <div className="wrap">
          <div className="ctaband rise">
            <h2>Bring Bali to your classroom</h2>
            <p>
              A 20-minute walkthrough with a real session — tags, the live grid, and the emergency
              exit included.
            </p>
            <DemoForm />
            <div className="fine">
              Free for your first class · No student accounts, no credit card
            </div>
          </div>
        </div>
      </section>

      <footer>
        <div className="wrap">
          <span className="wordmark" style={{ fontSize: 16 }}>
            <ArcMark size={19} />
            Bali
          </span>
          <span style={{ font: "400 13px/18px var(--font-ui)", color: 'var(--text-tertiary)' }}>
            Focus sessions for classrooms
          </span>
          <div className="links">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/contact">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

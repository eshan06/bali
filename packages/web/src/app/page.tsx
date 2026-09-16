'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthContext } from '@/components/auth/AuthProvider';
import DrawArrow from '@/components/landing/DrawArrow';
import FloatingPhone from '@/components/landing/FloatingPhone';

// `position` is the CSS background-position focal point for each photo so the
// crop stays centered on the main subject at any aspect ratio.
const HERO_IMAGES = [
  { src: 'https://images.unsplash.com/photo-1588072432836-e10032774350?w=1920', position: '65% 40%' }, // boy in glasses writing
  { src: 'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=1920', position: '62% 35%' }, // standing student with notebook
  { src: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1920', position: '50% 35%' }, // teacher at the board
  { src: 'https://images.unsplash.com/photo-1491308056676-205b7c9a7dc1?w=1920', position: '75% 60%' }, // student with red backpack
  { src: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1920', position: '38% 55%' }, // laughing group at laptop
];

export default function LandingPage() {
  const { isAuthenticated, isLoading, role } = useAuthContext();
  const router = useRouter();
  const [slide, setSlide] = useState(0);

  // Intro: the hero starts scaled up to cover the whole viewport (no nav, no
  // text, no rounded corners), holds briefly, then zooms out into its box
  // while the nav and headline fade in.
  const heroRef = useRef<HTMLElement>(null);
  const focusModeRef = useRef<HTMLElement>(null);
  const howItWorksRef = useRef<HTMLElement>(null);
  const attendanceRef = useRef<HTMLElement>(null);
  const [intro, setIntro] = useState(true);
  const [introTransform, setIntroTransform] = useState('');

  // Sticky nav turns brand blue once the page is scrolled.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (isLoading) return;
    const el = heroRef.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setIntro(false);
      return;
    }
    const r = el.getBoundingClientRect();
    const scale = Math.max(window.innerWidth / r.width, window.innerHeight / r.height);
    const dx = window.innerWidth / 2 - (r.left + r.width / 2);
    const dy = window.innerHeight / 2 - (r.top + r.height / 2);
    setIntroTransform(`translate(${dx}px, ${dy}px) scale(${scale})`);
    const t = setTimeout(() => setIntro(false), 800);
    return () => clearTimeout(t);
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    if (role === 'teacher') router.replace('/dashboard/');
    else if (role === 'student') router.replace('/student/');
    // role === 'unset' users stay on the landing page
  }, [isAuthenticated, isLoading, role, router]);

  useEffect(() => {
    const id = setInterval(() => {
      setSlide((s) => (s + 1) % HERO_IMAGES.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="animate-spin h-8 w-8 border-4 border-brand border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-white text-black ${intro ? 'overflow-hidden' : ''}`}>

      {/* ── NAVBAR ─────────────────────────────────────────────────────── */}
      <nav
        className="sticky top-0 z-50 w-full"
        style={{
          opacity: intro ? 0 : 1,
          backgroundColor: scrolled ? '#2E5BD0' : '#fff',
          transition: 'opacity 1400ms, background-color 300ms',
        }}
      >
        <div className="w-full px-6 py-3.5 flex items-center justify-between">
          {/* logo */}
          <img
            src="/logo.png"
            alt="bali"
            className="h-10 w-auto rounded-md"
          />

          {/* center nav links */}
          <div className="hidden md:flex items-center gap-8">
            {[
              { label: 'Mission', href: '#about' },
              { label: 'How it Works', href: '#how-it-works' },
              { label: 'Contact Us', href: 'mailto:contact@baliedu.com' },
            ].map(({ label, href }) => (
              <a
                key={label}
                href={href}
                className="text-sm font-medium transition-colors duration-300 hover:opacity-70"
                style={{ color: scrolled ? '#fff' : '#374151' }}
              >
                {label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <Link
            href="/login/"
            className="rounded-full px-6 py-3 text-sm font-semibold text-white transition-opacity duration-300 hover:opacity-85"
            style={{ backgroundColor: '#111' }}
          >
            Log In
          </Link>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────────────────────────── */}
      {/* Scroll stack: the hero stays pinned while the two sections below slide up over it. */}
      <div className="relative">
      <div className="sticky w-full px-6 pb-6" style={{ top: 72 }}>
      <section
        ref={heroRef}
        className={`relative min-h-[calc(100vh-96px)] flex items-center justify-center overflow-hidden ${
          intro ? '' : 'transition-[transform,border-radius] duration-[2000ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
        }`}
        style={{
          transform: intro ? introTransform : 'none',
          borderRadius: intro ? 0 : 24,
        }}
      >

        {/* crossfade slideshow */}
        {HERO_IMAGES.map(({ src, position }, i) => (
          <div
            key={src}
            className="absolute inset-0 bg-cover transition-opacity duration-1000"
            style={{
              backgroundImage: `url(${src})`,
              backgroundPosition: position,
              opacity: i === slide ? 1 : 0,
            }}
          />
        ))}

        {/* 65% dark overlay */}
        <div className="absolute inset-0 bg-black/65" />

        {/* content */}
        <div
          className="relative z-10 text-center text-white px-6 max-w-5xl mx-auto transition-opacity duration-[1400ms] delay-[700ms]"
          style={{ opacity: intro ? 0 : 1 }}
        >
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] text-white drop-shadow-md">
            The #1 solution to combat in-class phone usage
          </h1>
          <p className="mt-5 text-xl font-normal text-white opacity-90">
            Phone-free classrooms. Automatic attendance.
          </p>
          <div className="mt-10 flex items-center justify-center">
            <a
              href="mailto:contact@baliedu.com?subject=Request%20a%20Demo"
              className="rounded-full px-8 py-3.5 text-base font-bold transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#2E5BD0', color: '#fff' }}
            >
              Request a demo
            </a>
          </div>
        </div>

        {/* scroll cue */}
        <div
          className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/50 transition-opacity duration-[1400ms] delay-[700ms]"
          style={{ opacity: intro ? 0 : 1 }}
        >
          <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>
      </div>

      {/* ── MISSION ────────────────────────────────────────────────────── */}
      <section id="about" className="relative z-10 rounded-t-3xl" style={{ backgroundColor: '#EEF2FC' }}>
        <div className="max-w-7xl mx-auto px-8 pt-12 pb-12 text-center">
          <h2 className="text-4xl md:text-5xl font-black text-black tracking-tight">
            Why Bali?
          </h2>
          <p className="mt-3 text-lg text-gray-500">
            Bali creates phone-free classrooms so students can focus on learning.
          </p>

          {/* stat cards */}
          <div className="mt-8 grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              { value: '< 30', unit: 's', text: 'average time for a student to check in by tapping their phone at the door' },
              { value: '100', unit: '%', text: 'of attendance recorded automatically for every class, every day' },
              { value: '1', unit: 'app', text: 'for students to install — nothing extra to carry or remember' },
            ].map(({ value, unit, text }) => (
              <div
                key={text}
                className="rounded-2xl px-6 py-6 flex flex-col items-center bg-white"
                style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -16px rgba(46,91,208,0.18)' }}
              >
                <div
                  className="rounded-xl px-5 py-2 flex items-baseline gap-1"
                  style={{ backgroundColor: 'rgba(46,91,208,0.08)' }}
                >
                  <span className="text-4xl font-black tracking-tight" style={{ color: '#2E5BD0' }}>{value}</span>
                  <span className="text-lg font-bold" style={{ color: '#2E5BD0' }}>{unit}</span>
                </div>
                <p className="mt-4 text-sm text-gray-700 leading-snug max-w-[240px]">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHY IT MATTERS ─────────────────────────────────────────────── */}
      <section className="relative z-10 bg-white">
        <div className="max-w-7xl mx-auto px-8 pt-12 pb-12 text-center">
          <h2 className="text-4xl md:text-5xl font-black text-black tracking-tight">
            We believe phones are the problem
          </h2>

          <div className="mt-8 grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              {
                value: '62',
                unit: '%',
                text: "Students who didn't use phones wrote down 62% more notes and scored a full letter grade higher on tests.",
                source: 'London School of Economics',
              },
              {
                value: '1',
                unit: 'phone',
                text: 'Even a phone face-down on a desk reduces cognitive capacity and impairs thinking.',
                source: 'University of Texas at Austin',
              },
              {
                value: '$13',
                unit: 'B',
                text: 'U.S. districts lose $13B annually to chronic absenteeism.',
                source: 'Attendance Works',
              },
            ].map(({ value, unit, text, source }) => (
              <div
                key={source}
                className="rounded-2xl px-6 py-6 flex flex-col items-center"
                style={{ backgroundColor: '#F7F7F7' }}
              >
                <div
                  className="rounded-xl px-5 py-2 flex items-baseline gap-1"
                  style={{ backgroundColor: 'rgba(46,91,208,0.08)' }}
                >
                  <span className="text-4xl font-black tracking-tight" style={{ color: '#2E5BD0' }}>{value}</span>
                  <span className="text-lg font-bold" style={{ color: '#2E5BD0' }}>{unit}</span>
                </div>
                <p className="mt-4 text-sm text-gray-700 leading-snug max-w-[260px] flex-1">{text}</p>
                <p className="mt-3 text-xs font-black uppercase tracking-wide text-gray-900">{source}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-xs text-gray-400 italic">
            Referenced in The Atlantic, The New York Times, and Jonathan Haidt's <em>The Anxious Generation</em>.
          </p>
        </div>
      </section>
      </div>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <section ref={howItWorksRef} className="bg-white" id="how-it-works">
        <div className="max-w-7xl mx-auto px-8 py-28">
          {/* heading */}
          <div className="text-center mb-20">
            <p className="text-xs font-black tracking-widest uppercase mb-4" style={{ color: '#2E5BD0' }}>
              Simple by design
            </p>
            <h2 className="text-5xl md:text-6xl font-black text-black tracking-tight">
              How it works
            </h2>
          </div>

          {/* three columns */}
          <div className="relative grid md:grid-cols-3 gap-12">

            {/* curved connectors between the columns, drawn in on scroll */}
            <DrawArrow
              className="hidden md:block absolute pointer-events-none"
              style={{ left: 'calc(33.333% - 8px)', top: 96, marginLeft: -70 }}
            />
            <DrawArrow
              flip
              className="hidden md:block absolute pointer-events-none"
              style={{ left: 'calc(66.667% + 8px)', top: 96, marginLeft: -70 }}
            />

            {/* 1 — Tap */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>1</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <FloatingPhone targetRef={howItWorksRef} drift={12} duration={3.6} delay={0} tilt={-12} fullWidth>
                  <img
                    src="/tap-card-hero.png"
                    alt="Tap"
                    className="rounded-2xl object-contain"
                    style={{ maxHeight: 450, width: '100%' }}
                  />
                </FloatingPhone>
              </div>
              <h3 className="text-2xl font-black text-black mb-3">Tap</h3>
              <p className="text-gray-500 text-base leading-loose max-w-xs">
                A Bali card is mounted outside every classroom. Students tap their phone as they walk in.
              </p>
            </div>

            {/* 2 — Lock */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>2</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <FloatingPhone targetRef={howItWorksRef} drift={12} duration={3.6} delay={0.6} tilt={10} fullWidth>
                  <img
                    src="/lock-step.webp"
                    alt="Lock"
                    className="rounded-2xl object-contain"
                    style={{ maxHeight: 450, width: '100%' }}
                  />
                </FloatingPhone>
              </div>
              <h3 className="text-2xl font-black text-black mb-3">Lock</h3>
              <p className="text-gray-500 text-base leading-loose max-w-xs">
                Bali instantly enters focus mode — distracting apps blocked, camera and notepad still available.
              </p>
            </div>

            {/* 3 — Track */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>3</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <FloatingPhone targetRef={howItWorksRef} drift={12} duration={3.6} delay={1.2} tilt={-12} fullWidth>
                  <img
                    src="/dashboard-preview.webp"
                    alt="Track"
                    className="rounded-2xl object-contain"
                    style={{ maxHeight: 450, width: '100%' }}
                  />
                </FloatingPhone>
              </div>
              <h3 className="text-2xl font-black text-black mb-3">Track</h3>
              <p className="text-gray-500 text-base leading-loose max-w-xs">
                The teacher dashboard updates in real time: who's present, who's late, and who's absent.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ── FOCUS MODE ─────────────────────────────────────────────────── */}
      <section ref={focusModeRef} className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-28">
          <div className="grid md:grid-cols-2 gap-20 items-center">

            {/* left — image */}
            <div className="flex justify-center">
              <FloatingPhone targetRef={focusModeRef}>
                <img
                  src="/lock-step.webp"
                  alt="Bali focus mode lock screen"
                  className="w-full rounded-3xl object-cover"
                  style={{ maxWidth: 320 }}
                />
              </FloatingPhone>
            </div>

            {/* right — text */}
            <div>
              <p className="text-xs font-bold tracking-widest uppercase mb-5" style={{ color: '#2E5BD0' }}>
                Focus Mode
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-black leading-tight tracking-tight mb-10">
                Focus Mode.
              </h2>

              <ul className="space-y-5">
                {[
                  'Social media, games, and iMessage blocked',
                  'Camera and Notepad stay on',
                  'Emergency override instantly unlocks and alerts teacher',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: '#2E5BD0' }}
                    >
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </span>
                    <span className="text-gray-800 text-base leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* ── ATTENDANCE ─────────────────────────────────────────────────── */}
      <section ref={attendanceRef} id="for-districts" className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-36">
          <div className="grid md:grid-cols-2 gap-24 items-center">

            {/* left — image */}
            <div className="flex justify-center">
              <FloatingPhone targetRef={attendanceRef} tilt={12} fullWidth>
                <img
                  src="/dashboard-preview.webp"
                  alt="Class dashboard"
                  className="w-full rounded-3xl object-cover"
                  style={{ maxWidth: 620 }}
                />
              </FloatingPhone>
            </div>

            {/* right — text */}
            <div>
              <p className="text-xs font-bold tracking-widest uppercase mb-5" style={{ color: '#2E5BD0' }}>
                Attendance Tracking
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-black leading-tight tracking-tight mb-12">
                Automatic Attendance.
              </h2>

              <ul className="space-y-7">
                {[
                  'Present, late, and absent — tracked automatically',
                  'Syncs with Canvas, Google Classroom, and Blackboard',
                  'Zero extra work for teachers',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-4">
                    <span
                      className="mt-1 flex-shrink-0 h-5 w-5 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: '#2E5BD0' }}
                    >
                      <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </span>
                    <span className="text-gray-800 text-lg leading-snug">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>
      </section>

      {/* ── VIDEO ──────────────────────────────────────────────────────── */}
      <section className="bg-[#0f0f0f]">
        <div className="max-w-7xl mx-auto px-8 py-28 text-center">
          <h2 className="text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
            See Bali in action
          </h2>
          <p className="mt-4 text-lg text-white/50 max-w-xl mx-auto">
            Watch how one device transforms your school's phone policy.
          </p>
          <div className="mt-12 mx-auto" style={{ maxWidth: 900 }}>
            <div
              className="relative w-full overflow-hidden rounded-2xl"
              style={{ paddingBottom: '56.25%' }}
            >
              <iframe
                className="absolute inset-0 h-full w-full"
                src="https://www.youtube.com/embed/QR-k56YwHVo"
                title="Bali demo"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section id="cta" style={{ backgroundColor: '#2E5BD0' }}>
        <div className="max-w-7xl mx-auto px-8 py-32 text-center">
          <h2 className="text-6xl font-black text-white tracking-tight leading-tight mb-6">
            Ready to take back<br />your classroom?
          </h2>
          <Link
            href="/signup/"
            className="inline-block rounded-lg px-10 py-4 text-base font-bold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#fff', color: '#2E5BD0' }}
          >
            Get Started Free
          </Link>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer style={{ backgroundColor: '#0f0f0f' }}>
        <div className="max-w-7xl mx-auto px-8 py-10 flex items-center justify-between">
          <span className="text-lg font-black text-white tracking-tight">bali</span>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="https://baliedu.com" className="hover:text-gray-300 transition-colors">baliedu.com</a>
            <a href="mailto:contact@baliedu.com" className="hover:text-gray-300 transition-colors">contact@baliedu.com</a>
          </div>
          <span className="text-sm text-gray-500">© 2025 Bali. Built for schools.</span>
        </div>
      </footer>

    </div>
  );
}

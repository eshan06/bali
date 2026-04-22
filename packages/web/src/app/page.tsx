'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthContext } from '@/components/auth/AuthProvider';

const HERO_IMAGES = [
  'https://images.unsplash.com/photo-1509062522246-3755977927d7?w=1920',
  'https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=1920',
  'https://images.unsplash.com/photo-1588072432836-e10032774350?w=1920',
  'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=1920',
  'https://images.unsplash.com/photo-1606761568499-6d2451b23c66?w=1920',
];

export default function LandingPage() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const router = useRouter();
  const [slide, setSlide] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/dashboard/');
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    const id = setInterval(() => {
      setSlide((s) => (s + 1) % HERO_IMAGES.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > window.innerHeight * 0.8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="animate-spin h-8 w-8 border-4 border-brand border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">

      {/* ── NAVBAR ─────────────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
        style={{
          backgroundColor: scrolled ? 'rgba(255,255,255,0.96)' : 'transparent',
          backdropFilter: scrolled ? 'blur(16px)' : 'none',
          borderBottom: scrolled ? '1px solid #f3f4f6' : 'none',
        }}
      >
        <div className="max-w-7xl mx-auto px-8 py-5 flex items-center justify-between">
          {/* wordmark */}
          <span
            className="text-2xl font-sans font-black tracking-tight transition-colors duration-300"
            style={{ color: scrolled ? '#000' : '#fff' }}
          >
            bali
          </span>

          {/* center nav links */}
          <div className="hidden md:flex items-center gap-8">
            {['How It Works', 'About', 'For Districts', 'Press'].map((label) => (
              <a
                key={label}
                href="#"
                className="text-sm font-medium transition-colors duration-300 hover:opacity-70"
                style={{ color: scrolled ? '#374151' : '#fff' }}
              >
                {label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <a
            href="mailto:jonbani2006@gmail.com?subject=Bali Demo Request"
            className="rounded-full px-6 py-2.5 text-sm font-bold transition-all duration-300"
            style={
              scrolled
                ? { backgroundColor: '#2E5BD0', color: '#fff', border: '2px solid #2E5BD0' }
                : { backgroundColor: 'transparent', color: '#fff', border: '2px solid rgba(255,255,255,0.85)' }
            }
            onMouseEnter={(e) => {
              if (!scrolled) {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = '#fff';
                (e.currentTarget as HTMLAnchorElement).style.color = '#000';
              }
            }}
            onMouseLeave={(e) => {
              if (!scrolled) {
                (e.currentTarget as HTMLAnchorElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLAnchorElement).style.color = '#fff';
              }
            }}
          >
            Request a Demo
          </a>
        </div>
      </nav>

      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">

        {/* crossfade slideshow */}
        {HERO_IMAGES.map((src, i) => (
          <div
            key={src}
            className="absolute inset-0 bg-cover bg-center transition-opacity duration-1000"
            style={{
              backgroundImage: `url(${src})`,
              opacity: i === slide ? 1 : 0,
            }}
          />
        ))}

        {/* 65% dark overlay */}
        <div className="absolute inset-0 bg-black/65" />

        {/* top gradient so navbar text always pops */}
        <div
          className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
          style={{ height: 150, background: 'linear-gradient(to bottom, rgba(0,0,0,0.4), transparent)' }}
        />

        {/* content */}
        <div className="relative z-10 text-center text-white px-6 max-w-5xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] text-white drop-shadow-md">
            The #1 solution to combat in-class phone usage
          </h1>
          <p className="mt-5 text-xl font-normal text-white opacity-90">
            Phone-free classrooms. Automatic attendance.
          </p>
          <div className="mt-10">
            <a
              href="mailto:jonbani2006@gmail.com?subject=Bali Demo Request"
              className="inline-block rounded-lg px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white hover:text-black"
              style={{ border: '1.5px solid rgba(255,255,255,0.85)', backgroundColor: 'transparent' }}
            >
              Request a Demo
            </a>
          </div>
        </div>

        {/* scroll cue */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-white/50">
          <svg className="w-5 h-5 animate-bounce" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </section>

      {/* ── MISSION ────────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: '#1a1a1a' }}>
        <div className="max-w-4xl mx-auto px-8 py-32 text-center">
          <div className="mx-auto mb-8 rounded-full" style={{ width: 64, height: 3, backgroundColor: '#2E5BD0' }} />
          <h2 className="text-5xl md:text-6xl font-black text-white uppercase leading-tight tracking-tight mb-8">
            Bali creates phone-free classrooms
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
            Bali works with school districts across the country to create phone-free classrooms where students can focus, connect, and learn — without distraction.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <section className="bg-white" id="how-it-works">
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
          <div className="grid md:grid-cols-3 gap-12">

            {/* 1 — Tap */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>1</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <img
                  src="/40abf499-4465-4750-90f9-a72a03d96651%20copy.png"
                  alt="Tap"
                  className="rounded-2xl object-contain"
                  style={{ maxHeight: 450, width: '100%' }}
                />
              </div>
              <h3 className="text-2xl font-black text-black mb-3">Tap</h3>
              <p className="text-gray-500 text-base leading-loose max-w-xs">
                A Bali device is mounted outside every classroom. Students tap their phone as they walk in — the device lights up green to confirm.
              </p>
            </div>

            {/* 2 — Lock */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>2</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <img
                  src="/lock-step.png"
                  alt="Lock"
                  className="rounded-2xl object-contain"
                  style={{ maxHeight: 450, width: '100%' }}
                />
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
                <img
                  src="/dbbd3005-86a3-4939-8357-e42a1afcedef%20copy.png"
                  alt="Track"
                  className="rounded-2xl object-contain"
                  style={{ maxHeight: 450, width: '100%' }}
                />
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
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-28">
          <div className="grid md:grid-cols-2 gap-20 items-center">

            {/* left — image */}
            <div className="flex justify-center">
              <img
                src="/lock-step.png"
                alt="Bali focus mode lock screen"
                className="w-full rounded-3xl object-cover"
                style={{ maxWidth: 320, boxShadow: '0 32px 80px rgba(0,0,0,0.14)' }}
              />
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
      <section id="features" className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-28">
          <div className="grid md:grid-cols-2 gap-20 items-center">

            {/* left — image */}
            <div className="flex justify-center">
              <img
                src="/dbbd3005-86a3-4939-8357-e42a1afcedef%20copy.png"
                alt="Class dashboard"
                className="w-full rounded-3xl object-cover"
                style={{ maxWidth: 550, boxShadow: '0 32px 80px rgba(0,0,0,0.14)' }}
              />
            </div>

            {/* right — text */}
            <div>
              <p className="text-xs font-bold tracking-widest uppercase mb-5" style={{ color: '#2E5BD0' }}>
                Attendance Tracking
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-black leading-tight tracking-tight mb-10">
                Automatic Attendance.
              </h2>

              <ul className="space-y-5">
                {[
                  'Present, late, and absent — tracked automatically',
                  'Exact minutes late recorded per student',
                  'Bathroom breaks logged with timestamp',
                  'Syncs directly with Canvas, Google Classroom, Blackboard, and more',
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

      {/* ── STATS ──────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-16">
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            {[
              { value: '< 30s', label: 'Average check-in time' },
              { value: '100%', label: 'Automated attendance' },
              { value: '0', label: 'Apps required by students' },
            ].map((stat) => (
              <div key={stat.label} className="px-12 first:pl-0 last:pr-0 text-center">
                <p className="text-5xl font-black text-black tracking-tight">{stat.value}</p>
                <p className="mt-2 text-sm text-gray-400 font-medium">{stat.label}</p>
              </div>
            ))}
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
          <div className="mt-12 mx-auto relative" style={{ maxWidth: 900 }}>
            {/* play button overlay — clicking it removes the overlay and plays */}
            <div
              id="video-overlay"
              className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl cursor-pointer"
              style={{ background: 'rgba(0,0,0,0.25)' }}
              onClick={() => {
                const overlay = document.getElementById('video-overlay');
                const vid = document.getElementById('bali-video') as HTMLVideoElement | null;
                if (overlay) overlay.style.display = 'none';
                if (vid) vid.play();
              }}
            >
              <div
                className="flex items-center justify-center rounded-full"
                style={{ width: 72, height: 72, backgroundColor: '#fff' }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <polygon points="6,3 20,12 6,21" fill="#2E5BD0" />
                </svg>
              </div>
            </div>
            <video
              id="bali-video"
              controls
              playsInline
              poster={"/Screenshot 2026-04-22 at 1.29.27 AM.png"}
              className="w-full rounded-2xl block"
              style={{ height: 500, width: '100%', objectFit: 'cover' }}
            >
              <source src="/Bali%20video%20copy.mov" type="video/mp4" />
              <source src="/Bali%20video%20copy.mov" type="video/quicktime" />
            </video>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      {/* ── RESEARCH ───────────────────────────────────────────────────── */}
      <section className="bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-28 text-center">
          <h2 className="text-4xl md:text-5xl font-black text-black tracking-tight leading-tight mb-4">
            The Research Is Clear
          </h2>
          <div className="grid md:grid-cols-3 gap-6 text-left mb-12">
            {[
              {
                quote: "Students who didn't use phones wrote down 62% more notes and scored a full letter grade higher on tests.",
                source: '— London School of Economics',
              },
              {
                quote: 'Even a phone face-down on a desk reduces cognitive capacity and impairs thinking.',
                source: '— University of Texas at Austin',
              },
              {
                quote: 'Banning phones improved grades most for low-income students and those who struggle most.',
                source: '— Education Endowment Foundation',
              },
            ].map(({ quote, source }) => (
              <div key={source} className="rounded-xl py-8 px-8 flex flex-col" style={{ backgroundColor: '#F7F7F7' }}>
                <span className="text-5xl font-black leading-none mb-4" style={{ color: '#2E5BD0' }}>"</span>
                <p className="text-base text-gray-700 italic leading-relaxed flex-1 mb-6">{quote}</p>
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{source}</p>
              </div>
            ))}
          </div>

          <p className="text-sm text-gray-400 italic">
            Referenced in The Atlantic, The New York Times, and Jonathan Haidt's <em>The Anxious Generation</em>.
          </p>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section style={{ backgroundColor: '#2E5BD0' }}>
        <div className="max-w-7xl mx-auto px-8 py-32 text-center">
          <h2 className="text-6xl font-black text-white tracking-tight leading-tight mb-6">
            Ready to take back<br />your classroom?
          </h2>
          <a
            href="mailto:jonbani2006@gmail.com?subject=Bali Demo Request"
            className="inline-block rounded-lg px-10 py-4 text-base font-bold hover:opacity-90 transition-opacity"
            style={{ backgroundColor: '#fff', color: '#2E5BD0' }}
          >
            Request a Demo
          </a>
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

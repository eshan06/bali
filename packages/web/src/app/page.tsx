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
            The #1 solution to put phones away and bring learning back.
          </h1>
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
                Student taps their phone on the Bali device entering class. The device lights up green.
              </p>
            </div>

            {/* 2 — Lock */}
            <div className="flex flex-col items-center text-center">
              <span className="text-5xl font-black mb-6" style={{ color: '#2E5BD0' }}>2</span>
              <div className="w-full flex items-center justify-center mb-8" style={{ height: 450 }}>
                <img
                  src={encodeURI('/Screenshot 2026-04-05 at 7.13.38 PM copy.png')}
                  alt="Lock"
                  className="rounded-2xl object-contain"
                  style={{ maxHeight: 450, width: '100%' }}
                />
              </div>
              <h3 className="text-2xl font-black text-black mb-3">Lock</h3>
              <p className="text-gray-500 text-base leading-loose max-w-xs">
                The moment class starts, Bali locks distracting apps. Students enter focus mode — camera and notepad still available.
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
                See exactly who's present, who's late and by how many minutes, and who's absent — all updating in real time on your dashboard.
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
            <div>
              <img
                src="/bali-lock-screen.png"
                alt="Bali focus mode lock screen"
                className="w-full rounded-3xl object-cover"
                style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.14)' }}
              />
            </div>

            {/* right — text */}
            <div>
              <p className="text-xs font-bold tracking-widest uppercase mb-5" style={{ color: '#2E5BD0' }}>
                Focus Mode
              </p>
              <h2 className="text-4xl md:text-5xl font-bold text-black leading-tight tracking-tight mb-10">
                Students stay focused.<br />Teachers stay in control.
              </h2>

              <ul className="space-y-5 mb-10">
                {[
                  'Camera stays on — for photos and scanning',
                  'Notepad stays on — for notes and studying',
                  'Social media, games, and distracting apps blocked',
                  'Teachers can customize exactly which apps are allowed',
                  'Emergency override button — students can unlock instantly in any emergency, teacher is alerted immediately',
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

              <p className="text-gray-400 text-base leading-relaxed">
                Every school is different. Bali lets administrators set the exact policy that works for their district.
              </p>
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

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      <section id="features" className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-32">
          <div className="max-w-2xl mb-20">
            <p className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-4">Features</p>
            <h2 className="text-5xl font-black text-black tracking-tight leading-tight">
              Everything you need.<br />Nothing you don't.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-px bg-gray-100">
            {[
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                title: 'Instant Attendance',
                desc: 'Students tap in with their device and attendance is recorded automatically. No roll calls, no paper.',
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                  </svg>
                ),
                title: 'Phone Lockdown',
                desc: 'The moment class starts, distracting apps are blocked. One click. No student opt-out.',
              },
              {
                icon: (
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6.75v6.75" />
                  </svg>
                ),
                title: 'Live Dashboard',
                desc: "See who's in, who's late, and whose device is locked — all in real time from one screen.",
              },
            ].map((feature) => (
              <div key={feature.title} className="bg-white p-12">
                <div className="h-12 w-12 rounded-2xl bg-gray-50 flex items-center justify-center text-black mb-8">
                  {feature.icon}
                </div>
                <h3 className="text-xl font-bold text-black mb-3">{feature.title}</h3>
                <p className="text-gray-500 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────────────────── */}
      <section id="how-it-works" className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-7xl mx-auto px-8 py-32">
          <div className="max-w-2xl mb-20">
            <p className="text-sm font-semibold tracking-widest text-gray-400 uppercase mb-4">How it works</p>
            <h2 className="text-5xl font-black text-black tracking-tight leading-tight">
              Up and running<br />in minutes.
            </h2>
          </div>

          <div className="grid md:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Create a class', desc: 'Add your students manually or import a CSV in seconds.' },
              { step: '02', title: 'Set your policy', desc: 'Choose what to block — social, games, everything, or a custom list.' },
              { step: '03', title: 'Start a session', desc: 'Blocking activates instantly. Students tap in from their phone.' },
              { step: '04', title: 'Just teach', desc: "Monitor attendance and focus from your dashboard. That's it." },
            ].map((item) => (
              <div key={item.step}>
                <p className="text-6xl font-black text-gray-100 leading-none mb-6">{item.step}</p>
                <h3 className="text-lg font-bold text-black mb-2">{item.title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────── */}
      <section className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-40 text-center">
          <h2 className="text-6xl font-black text-black tracking-tight leading-tight mb-6">
            Ready to take back<br />your classroom?
          </h2>
          <p className="text-xl text-gray-400 max-w-lg mx-auto mb-12">
            No apps. No setup for students. No excuses.
          </p>
          <a
            href="mailto:jonbani2006@gmail.com?subject=Bali Demo Request"
            className="inline-block rounded-full bg-brand px-10 py-4 text-base font-bold text-white hover:opacity-90 transition-opacity"
          >
            Request a Demo
          </a>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-8 py-10 flex items-center justify-between">
          <span className="text-lg font-black text-black tracking-tight">bali</span>
          <span className="text-sm text-gray-400">Built for teachers, by students.</span>
        </div>
      </footer>

    </div>
  );
}

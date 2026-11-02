// The canvas's component script without the canvas runtime: fit the scenes, drive the chapters from the
// scroll, and run Skip, Contact, Watch, the copy button and the video.
(() => {
  const root = document.querySelector('.bw');
  const first = root.querySelector('.b-ch-1 .b-wrap');
  const veil = root.querySelector('.b-veil');
  const EMAIL = 'eshan.shah@vanderbilt.edu';

  // Fit each chapter's scene (760 x 560) beside the headline, and record where the ring's centre lands.
  const fit = () => {
    const w = first.offsetWidth;
    const h = first.offsetHeight;
    if (!w) return;
    const k = Math.max(0.3, Math.min(w / 760, h / 560, 2));
    root.style.setProperty('--k', k.toFixed(4));
    root.style.setProperty('--sh', (innerWidth > 767 ? (w - 760 * k) / 2 : 0).toFixed(1) + 'px');
    root.style.setProperty('--d', (560 * k).toFixed(1) + 'px');
    root.style.setProperty('--cx', (first.offsetLeft + w / 2).toFixed(1) + 'px');
    root.style.setProperty('--cy', (first.offsetTop + h / 2).toFixed(1) + 'px');
  };

  // The chapter on screen at a scroll position (in vh): the last one at least half open.
  const opens = [60, 240, 420, 640, 820, 1000];
  const chapterAt = (at) => opens.reduce((n, open, i) => (at >= open + 60 ? i + 2 : n), 1);
  // Only that chapter takes keyboard focus: in live mode the others sit stacked under it, and Tab would
  // land on links nobody can see. They stay readable to screen readers. 0 lets every chapter take focus.
  const chapters = [...root.querySelectorAll('.b-ch')];
  // In live mode only the chapters that can show draw their ring and screens (the heavy part): one opening
  // until the next has fully covered it. Drawing all seven made the browser fall behind on fast scrolls and
  // show stale pieces (the owner's Chrome, 2026-11-02). The pictures are aria-hidden; their labels stay.
  // `at` null draws every chapter (the stacked layout).
  let drawn = '';
  const draw = (at) => {
    const show = chapters.map((c, i) => at === null || ((i === 0 || at > opens[i - 1] - 1) && (i === 6 || at < opens[i] + 121)));
    const key = show.join();
    if (key === drawn) return;
    drawn = key;
    chapters.forEach((chapter, i) => chapter.classList.toggle('b-off', !show[i]));
  };
  let focusable = -1;
  const letFocus = (n) => {
    if (n === focusable) return;
    focusable = n;
    chapters.forEach((chapter, i) => {
      for (const el of chapter.querySelectorAll('a[href], button')) {
        if (n && i + 1 !== n) el.setAttribute('tabindex', '-1');
        else el.removeAttribute('tabindex');
      }
    });
  };

  // The small fades, rises and draws inside the scenes are set straight from the scroll, not by CSS
  // animations: paused opacity and transform animations there made Chrome leave parts of the chapter changes
  // undrawn, so the chapters beneath showed through (the owner saw it scrolling back up fast, 2026-11-02).
  // [elements, start, length] in vh of scroll, and how each looks at t (0 to 1); null clears them.
  const rise = (el, t) => {
    el.style.opacity = t;
    el.style.transform = 'translateY(' + 18 * (1 - t) + 'px)';
  };
  const small = [
    ['.b-cue', 0, 30, (el, t) => { el.style.opacity = 1 - t; }],
    ['.b-ch-4 .b-lay-b', 585, 20, (el, t) => { el.style.opacity = t; }],
    ['.b-ch-4 .b-card', 600, 25, rise],
    ['.b-ch-5 .b-p-side figure', 770, 30, rise],
    ['.b-ch-6 .mline .ln', 900, 90, (el, t) => { el.style.transform = 'scaleX(' + t + ')'; }],
    ['.b-ch-6 .mline .mk', 950, 45, (el, t) => {
      el.style.opacity = t;
      el.style.transform = 'scale(' + (0.4 + 0.6 * t) + ')';
    }],
  ].map(([sel, start, length, apply]) => [[...root.querySelectorAll(sel)], start, length, apply]);
  const setSmall = (at) => {
    for (const [els, start, length, apply] of small) {
      for (const el of els) {
        if (at === null) {
          el.style.opacity = '';
          el.style.transform = '';
        } else apply(el, Math.min(1, Math.max(0, (at - start) / length)));
      }
    }
  };

  // Live mode: every b- animation is paused, and its time is the eased scroll position, in vh (1ms = 1vh).
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const fits = matchMedia('(max-height: 1600px)');
  let anims = null;
  let pos = null;
  let shown = null;
  let last = 0;
  const decide = () => {
    root.classList.toggle('is-live', !still.matches && fits.matches);
    anims = null;
    pos = null;
    if (!root.classList.contains('is-live')) {
      letFocus(0);
      draw(null);
      setSmall(null);
    }
    fit();
  };
  still.addEventListener('change', decide);
  fits.addEventListener('change', decide);
  addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(first);
  decide();
  const tick = (now) => {
    const dt = last ? Math.min(64, now - last) : 16.7;
    last = now;
    if (root.classList.contains('is-live')) {
      const target = scrollY / (innerHeight / 100);
      if (pos === null) pos = target;
      pos += (target - pos) * (1 - Math.pow(0.915, dt / 16.7));
      if (Math.abs(target - pos) < 0.02) pos = target;
      letFocus(chapterAt(pos));
      draw(pos);
      if (!anims) {
        anims = document.getAnimations().filter((a) => a.animationName && a.animationName.indexOf('b-') === 0);
        shown = null;
      }
      if (pos !== shown) {
        for (const a of anims) a.currentTime = pos;
        setSmall(pos);
        shown = pos;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Past the story, the top bar gets its own ground and Skip goes; near Talk to us, Contact us steps aside.
  const after = root.querySelector('.b-after');
  const contact = document.getElementById('contact');
  let queued = false;
  const place = () => {
    queued = false;
    root.classList.toggle('is-past', after.getBoundingClientRect().top <= 72);
    root.classList.toggle('is-near', contact.getBoundingClientRect().top < innerHeight * 0.8);
  };
  const placeSoon = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(place);
    }
  };
  addEventListener('scroll', placeSoon, { passive: true });
  addEventListener('resize', placeSoon);
  place();

  // Skip, Contact and Watch: in the story, the ring's bar speeds round behind the screens, breaks off in a
  // straight line and flies off as the page clears, then the page lands on the section. Elsewhere, or with
  // Reduce Motion, it just goes there. The bar is drawn in the ring's own coordinates (200 x 200, centre
  // 100,100, radius 90).
  let flying = false;
  const fly = (id, event) => {
    event.preventDefault();
    if (flying) return;
    const target = document.getElementById(id);
    const land = (behavior) => {
      target.scrollIntoView({ behavior, block: 'start' });
      const heading = target.querySelector('[tabindex="-1"]');
      if (heading) heading.focus({ preventScroll: true });
    };
    if (still.matches) return land('auto');
    const at = typeof pos === 'number' ? pos : scrollY / (innerHeight / 100);
    if (!root.classList.contains('is-live') || at > 1180) return land('smooth');
    const sec = root.querySelector('.b-ch-' + chapterAt(at));
    const svg = sec.querySelector('.b-emblem svg');
    const arc = sec.querySelector('.b-arc');
    const path = sec.querySelector('.b-slingp');
    const k = svg.getBoundingClientRect().width / 200;
    const m = getComputedStyle(sec.querySelector('.b-arcrot')).transform;
    let rot = 0;
    if (m && m !== 'none') {
      const v = m.slice(m.indexOf('(') + 1, -1).split(',').map(parseFloat);
      rot = Math.atan2(v[1], v[0]);
    }
    const C = 2 * Math.PI * 90;
    const span = (2 * Math.PI * Math.min(parseFloat(getComputedStyle(arc).strokeDasharray) || 518, C)) / C;
    // Angles run clockwise from three o'clock; the bar's tail starts at twelve, turned by the scroll.
    // It lets go at six o'clock and flies off to the left, under the headline, clear of the screens.
    const tail = rot - Math.PI / 2;
    const exit = Math.PI;
    let rel = exit - Math.PI / 2;
    while (rel < tail + span + Math.PI / 2) rel += 2 * Math.PI;
    const f = (n) => n.toFixed(2);
    const point = (a) => f(100 + 90 * Math.cos(a)) + ' ' + f(100 + 90 * Math.sin(a));
    let d = 'M' + point(tail);
    for (let a = tail; a < rel - 1e-6; ) {
      const b = Math.min(a + Math.PI * 0.9, rel);
      d += ' A90 90 0 0 1 ' + point(b);
      a = b;
    }
    // Far enough, in the ring's units, to leave the screen from anywhere on it.
    const away = Math.hypot(innerWidth, innerHeight) / k;
    const len = 90 * span;
    const out = away + len + 10;
    d += ' L' + f(100 + 90 * Math.cos(rel) + Math.cos(exit) * out) + ' ' + f(100 + 90 * Math.sin(rel) + Math.sin(exit) * out);
    const around = 90 * (rel - tail);
    path.setAttribute('d', d);
    path.style.strokeDasharray = f(len) + ' ' + f(around + out + len);
    path.style.setProperty('--travel', f(around + away + 9) + 'px');
    flying = true;
    root.classList.add('is-slinging');
    setTimeout(() => {
      land('auto');
      pos = null;
      root.classList.remove('is-slinging');
      path.removeAttribute('d');
      anims = null;
      veil.hidden = false;
      setTimeout(() => {
        veil.hidden = true;
        flying = false;
      }, 420);
    }, 1000);
  };
  root.querySelector('.b-skip').addEventListener('click', (e) => fly('details', e));
  root.querySelector('.b-fab').addEventListener('click', (e) => fly('contact', e));
  root.querySelector('.b-watch').addEventListener('click', (e) => fly('watch', e));

  // Copy address: says what happened either way; on failure the address stays on screen to copy by hand.
  const copyText = root.querySelector('.b-copytext');
  const copyMsg = root.querySelector('.b-copymsg');
  let copyTimer = 0;
  const copied = (ok) => {
    copyText.textContent = ok ? 'Copied' : 'Couldn’t copy';
    copyMsg.textContent = ok ? 'Email address copied.' : 'Couldn’t copy. The address is shown above.';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copyText.textContent = 'Copy address';
      copyMsg.textContent = '';
    }, 2400);
  };
  copyText.closest('button').addEventListener('click', () => {
    try {
      navigator.clipboard.writeText(EMAIL).then(() => copied(true), () => copied(false));
    } catch (e) {
      copied(false);
    }
  });

  // The video: nothing loads from YouTube until someone presses play, and then only the privacy-enhanced player,
  // in the poster's box (the canvas's VideoPlaying board). Without this script the poster opens YouTube in a
  // new tab, as its label in the page says; with it, the video plays here.
  const poster = root.querySelector('.b-poster[data-video]');
  poster.setAttribute('aria-label', 'Play the Bali classroom demo');
  poster.addEventListener('click', (e) => {
    e.preventDefault();
    const box = document.createElement('div');
    box.className = 'b-poster b-player';
    const player = document.createElement('iframe');
    player.src = 'https://www.youtube-nocookie.com/embed/' + poster.dataset.video + '?autoplay=1&rel=0';
    player.title = 'Bali classroom demo';
    player.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    player.allowFullscreen = true;
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    box.appendChild(player);
    poster.replaceWith(box);
    player.focus();
  });
})();

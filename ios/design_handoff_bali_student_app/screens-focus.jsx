// screens-focus.jsx — NFC check-in sheet, Focus Mode (dark), emergency unlock, session ended, policy preview
// Exports: NfcSheet, FocusActiveScreen, EmergencySheet, SessionEndedOverlay, FocusPreviewScreen, FocusIdleScreen, AppTile

function AppTile({ app, locked, dark }) {
  return (
    <div className={'app-tile' + (locked ? ' app-locked' : '')}>
      <div className="app-ico" style={{ background: app.color }}>
        {app.icon ? <Icon name={app.icon} size={28} /> : <span>{app.glyph}</span>}
        {locked && <span className="app-lockbadge"><Icon name="lock" size={12} style={{ color: '#fff' }} /></span>}
      </div>
      <span className="app-name" style={{ color: dark ? (locked ? 'rgba(234,240,255,.45)' : 'var(--focus-text-2)') : (locked ? 'var(--ink-4)' : 'var(--ink-3)') }}>{app.name}</span>
    </div>
  );
}

// ── NFC check-in — Apple-Pay style sheet ───────────────────────────────
function NfcSheet({ app }) {
  const { classId, forced } = app.state.checkIn;
  const cls = app.data.classes.find(c => c.id === classId);
  const [phase, setPhase] = React.useState('waiting'); // waiting | reading | <result>

  React.useEffect(() => {
    let t;
    if (phase === 'waiting') t = setTimeout(() => setPhase('reading'), 2100);
    else if (phase === 'reading') t = setTimeout(() => {
      const result = forced || (cls && cls.session.active ? 'present' : 'noSession');
      setPhase(result);
    }, 1500);
    else if (phase === 'present' || phase === 'late') t = setTimeout(() => app.completeCheckIn(classId, phase), 1700);
    return () => clearTimeout(t);
  }, [phase]);

  const isResult = !['waiting', 'reading'].includes(phase);
  const good = phase === 'present' || phase === 'late';

  const header = (
    <div className="rowflex between" style={{ marginBottom: 18 }}>
      <div className="rowflex gap10">
        <Logo size={22} />
        <span style={{ width: 1, height: 18, background: 'var(--line)' }} />
        <span className="body-strong" style={{ fontSize: 15 }}>Check in</span>
      </div>
      <button onClick={() => app.closeSheet()} style={{ border: 0, background: '#EEF0F5', width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="x" size={16} style={{ color: 'var(--ink-3)' }} /></button>
    </div>
  );

  return (
    <>
      <div className="scrim" onClick={() => { if (isResult && !good) app.closeSheet(); }} />
      <div className="sheet">
        <div className="grabber" />
        {header}

        {/* context card */}
        {cls && <div className="rowflex gap12" style={{ background: 'var(--bg)', borderRadius: 16, padding: '12px 14px', marginBottom: 22 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: cls.color, display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="school" size={19} /></div>
          <div className="grow"><div className="body-strong" style={{ fontSize: 15 }}>{cls.name}</div><div className="foot">{cls.session.active ? cls.session.blockName + ' · ' + cls.teacher : cls.teacher}</div></div>
        </div>}

        {/* phase visuals */}
        <div className="center col tc" style={{ minHeight: 230, justifyContent: 'center' }}>
          {phase === 'waiting' && <>
            <div style={{ position: 'relative', display: 'grid', placeItems: 'center', marginBottom: 26 }}>
              <div className="radar" style={{ position: 'absolute', width: 200, height: 200 }}><div className="wave" /><div className="wave" /><div className="wave" /></div>
              <NfcMark size={120} />
            </div>
            <div className="h2">Hold near your Bali block</div>
            <div className="body mt8" style={{ maxWidth: 280 }}>Rest the top of your iPhone on the block at {cls?.session.blockName || 'your desk'}.</div>
          </>}

          {phase === 'reading' && <>
            <div style={{ position: 'relative', display: 'grid', placeItems: 'center', marginBottom: 26 }}>
              <NfcMark size={120} />
            </div>
            <div className="h2">Reading Bali block…</div>
            <div className="body mt8">Verifying the tag and your device.</div>
            <div style={{ width: 140, height: 4, borderRadius: 4, background: 'var(--line)', marginTop: 18, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: 'var(--blue)', borderRadius: 4, animation: 'loadbar 1.5s ease forwards' }} />
            </div>
          </>}

          {(phase === 'present' || phase === 'late') && <>
            <div className="check-circle" style={{ width: 116, height: 116, borderRadius: '50%', marginBottom: 22,
              background: phase === 'late' ? 'var(--amber)' : 'var(--green)', display: 'grid', placeItems: 'center',
              boxShadow: phase === 'late' ? '0 16px 36px rgba(224,138,18,.4)' : '0 16px 36px rgba(21,169,116,.4)' }}>
              <Icon name="check" size={60} sw={2.5} style={{ color: '#fff' }} />
            </div>
            <div className="h1">{phase === 'late' ? 'Checked in late' : 'Checked in'}</div>
            <div className="body mt8">{cls?.name} · {phase === 'late' ? '9:07 AM' : new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</div>
            <div className="rowflex gap8 mt16" style={{ color: 'var(--blue)', fontWeight: 650, fontSize: 14.5 }}><Icon name="shield" size={18} /> Starting Focus Mode…</div>
          </>}

          {phase === 'failed' && <>
            <div className="check-circle" style={{ width: 116, height: 116, borderRadius: '50%', marginBottom: 22, background: 'var(--coral-tint)', display: 'grid', placeItems: 'center' }}>
              <Icon name="x" size={56} sw={2.5} style={{ color: 'var(--coral)' }} />
            </div>
            <div className="h1">Check-in failed</div>
            <div className="body mt8" style={{ maxWidth: 280 }}>Couldn’t reach the Bali server. Move closer to the block and try again.</div>
            <Btn kind="primary" block icon="nfc" style={{ marginTop: 22 }} onClick={() => setPhase('waiting')}>Try again</Btn>
          </>}

          {phase === 'notAssigned' && <>
            <div style={{ width: 116, height: 116, borderRadius: '50%', marginBottom: 22, background: 'var(--amber-tint)', display: 'grid', placeItems: 'center' }}>
              <Icon name="device" size={52} style={{ color: 'var(--amber)' }} />
            </div>
            <div className="h1">Device not assigned</div>
            <div className="body mt8" style={{ maxWidth: 290 }}>{cls?.teacher} hasn’t linked this iPhone to your seat yet. Ask them to assign your device, then tap again.</div>
            <Btn kind="ghost" block style={{ marginTop: 22 }} onClick={() => app.closeSheet()}>Got it</Btn>
          </>}

          {phase === 'noSession' && <>
            <div style={{ width: 116, height: 116, borderRadius: '50%', marginBottom: 22, background: '#EEF0F5', display: 'grid', placeItems: 'center' }}>
              <Icon name="clock" size={52} style={{ color: 'var(--ink-4)' }} />
            </div>
            <div className="h1">No active session</div>
            <div className="body mt8" style={{ maxWidth: 280 }}>There’s no class running on this block right now. Check in once your teacher starts the session.</div>
            <Btn kind="ghost" block style={{ marginTop: 22 }} onClick={() => app.closeSheet()}>Close</Btn>
          </>}
        </div>
      </div>
    </>
  );
}

// ── Focus Mode active — dark takeover ──────────────────────────────────
function useCountdown(endLabel) {
  // demo: fixed remaining time that ticks down
  const [secs, setSecs] = React.useState(33 * 60 + 12);
  React.useEffect(() => { const t = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, []);
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function FocusActiveScreen({ app }) {
  const cls = app.data.classes.find(c => c.session.active) || app.data.classes[0];
  const pol = POLICIES[cls.policy];
  const ci = app.state.checkedIn[cls.id] || 'present';
  const remaining = useCountdown();
  const blocked = pol.blocks.map(appById);
  const allowed = pol.allows.map(appById).filter(Boolean);

  return (
    <div className="screen on-dark scr-enter" style={{ background: 'radial-gradient(120% 90% at 50% -10%, #142152 0%, var(--focus-bg-2) 42%, var(--focus-bg) 100%)' }}>
      <div className="topbar">
        <button className="icon-btn dark" onClick={() => app.setTab('home')}><Icon name="chevron-down" size={20} /></button>
        <div className="grow" />
        <span className="badge" style={{ background: 'rgba(21,169,116,.18)', color: '#7CEBBF' }}><span className="live-dot" style={{ width: 7, height: 7 }} />BLOCKING APPLIED</span>
      </div>

      <div className="screen-scroll" style={{ paddingTop: 96 }}>
        {/* hero */}
        <div className="center col tc">
          <div style={{ position: 'relative', display: 'grid', placeItems: 'center', marginBottom: 6 }}>
            <div style={{ position: 'absolute', width: 220, height: 220, borderRadius: '50%', background: 'radial-gradient(circle, rgba(46,92,255,.35), transparent 65%)' }} />
            <div style={{ position: 'relative', width: 128, height: 128, borderRadius: 40, background: 'linear-gradient(150deg,#335CFF,#1E3FCC)', display: 'grid', placeItems: 'center', boxShadow: '0 18px 50px rgba(46,92,255,.5)' }}>
              <Icon name="shield" size={62} style={{ color: '#fff' }} />
            </div>
          </div>
          <span className="badge mt20" style={{ background: 'rgba(46,92,255,.2)', color: '#B9CBFF' }}>FOCUS MODE ACTIVE</span>
          <div className="h-display mt12" style={{ color: '#fff' }}>{cls.name}</div>
          <div className="rowflex gap8 mt8" style={{ color: 'var(--focus-text-2)', fontSize: 14.5 }}>
            <Icon name={ci==='late'?'clock':'check-circle'} size={16} style={{ color: ci==='late'?'#FFD18A':'#7CEBBF' }} />
            {ci === 'late' ? 'Checked in late · 9:07 AM' : 'Checked in · 9:01 AM'}
          </div>
        </div>

        {/* unlock countdown */}
        <div className="mt24" style={{ borderRadius: 20, padding: 18, background: 'var(--focus-card)', boxShadow: 'inset 0 0 0 1px var(--focus-line)' }}>
          <div className="rowflex between">
            <div>
              <div className="foot" style={{ color: 'var(--focus-text-2)' }}>Apps unlock in</div>
              <div className="h-display tnum" style={{ color: '#fff', fontSize: 38, marginTop: 2 }}>{remaining}</div>
            </div>
            <div className="tc">
              <div className="foot" style={{ color: 'var(--focus-text-2)' }}>Session ends</div>
              <div className="h3 mt4" style={{ color: '#fff' }}>{cls.session.endsAt}</div>
            </div>
          </div>
          <div className="rowflex gap8 mt16" style={{ color: 'var(--focus-text-2)', fontSize: 13 }}>
            <Icon name="info" size={15} /> Set by {cls.teacher}’s session — not editable here.
          </div>
        </div>

        {/* blocked apps */}
        <div className="rowflex between mt32 mb16">
          <div className="h3" style={{ color: '#fff' }}>Paused right now</div>
          <span className="foot" style={{ color: 'var(--focus-text-2)' }}>{pol.name}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', rowGap: 18 }}>
          {blocked.map(a => <AppTile key={a.id} app={a} locked dark />)}
        </div>

        {/* allowed apps */}
        <div className="h3 mt32 mb16" style={{ color: '#fff' }}>Still available</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', rowGap: 18 }}>
          {allowed.slice(0, 8).map(a => <AppTile key={a.id} app={a} dark />)}
        </div>

        {/* emergency */}
        <button className="btn btn-block btn-glass" style={{ marginTop: 30, height: 54 }} onClick={() => app.openSheet('emergency')}>
          <Icon name="hand" size={19} /> Request emergency unlock
        </button>
        <div className="tc foot mt12" style={{ color: 'rgba(234,240,255,.4)', paddingBottom: 6 }}>
          Phone & Messages stay available for emergencies.
        </div>
      </div>
    </div>
  );
}

// ── Emergency unlock request sheet ─────────────────────────────────────
function EmergencySheet({ app }) {
  const [reason, setReason] = React.useState('');
  const [sent, setSent] = React.useState(false);
  const reasons = ['Family / urgent call', 'Medical', 'Need a specific app for class', 'Other'];
  const [picked, setPicked] = React.useState(null);

  if (sent) return (
    <>
      <div className="scrim" />
      <div className="sheet dark">
        <div className="grabber" style={{ background: 'rgba(255,255,255,.2)' }} />
        <div className="center col tc" style={{ padding: '14px 0 6px' }}>
          <div className="check-circle" style={{ width: 92, height: 92, borderRadius: '50%', background: 'rgba(46,92,255,.22)', display: 'grid', placeItems: 'center', marginBottom: 18 }}>
            <Icon name="check" size={48} sw={2.4} style={{ color: '#7CA0FF' }} />
          </div>
          <div className="h2" style={{ color: '#fff' }}>Request sent</div>
          <div className="body mt8" style={{ color: 'var(--focus-text-2)', maxWidth: 290 }}>Your teacher has been notified. Apps stay paused until they approve — nothing was bypassed.</div>
          <Btn kind="glass-strong" block style={{ marginTop: 22 }} onClick={() => app.closeSheet()}>Back to Focus</Btn>
        </div>
      </div>
    </>
  );

  return (
    <>
      <div className="scrim" onClick={() => app.closeSheet()} />
      <div className="sheet">
        <div className="grabber" />
        <div className="rowflex gap12 mb16" style={{ marginTop: 4 }}>
          <Tile tone="coral" icon="hand" />
          <div className="grow"><div className="h3">Emergency unlock</div><div className="foot">Sends a request to your teacher to review.</div></div>
        </div>

        <div className="card card-pad" style={{ background: 'var(--amber-tint)', boxShadow: 'none', marginBottom: 18 }}>
          <div className="rowflex gap10"><Icon name="info" size={18} style={{ color: '#9A5C05', flexShrink: 0, marginTop: 1 }} />
            <span className="foot" style={{ color: '#7A4A04' }}>This won’t silently bypass blocking. Your teacher sees the request and decides.</span></div>
        </div>

        <span className="label">Reason</span>
        <div className="col gap8 mb16">
          {reasons.map(r => (
            <button key={r} onClick={() => setPicked(r)} className="rowflex between"
              style={{ border: 0, cursor: 'pointer', background: picked===r ? 'var(--blue-tint)' : '#F4F5F8', borderRadius: 14, padding: '14px 16px', boxShadow: picked===r ? 'inset 0 0 0 1.5px var(--blue)' : 'none' }}>
              <span className="body-strong" style={{ fontSize: 15, color: picked===r ? 'var(--blue-700)' : 'var(--ink)' }}>{r}</span>
              {picked===r && <Icon name="check-circle" size={20} style={{ color: 'var(--blue)' }} />}
            </button>
          ))}
        </div>

        <span className="label">Add a note (optional)</span>
        <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Tell your teacher what you need…" rows={2}
          style={{ width: '100%', border: 0, background: '#F4F5F8', borderRadius: 14, padding: 14, fontFamily: 'var(--font)', fontSize: 15.5, resize: 'none', outline: 'none', color: 'var(--ink)' }} />

        <Btn kind="danger" block size="lg" disabled={!picked} style={{ marginTop: 16 }} onClick={() => setSent(true)}>Send request to teacher</Btn>
        <button className="btn btn-block" style={{ background: 'none', color: 'var(--ink-3)', boxShadow: 'none', marginTop: 2 }} onClick={() => app.closeSheet()}>Cancel</button>
      </div>
    </>
  );
}

// ── Session ended overlay ──────────────────────────────────────────────
function SessionEndedOverlay({ app }) {
  return (
    <>
      <div className="scrim" style={{ background: 'rgba(8,14,28,0.55)' }} />
      <div className="sheet">
        <div className="grabber" />
        <div className="center col tc" style={{ padding: '12px 0 6px' }}>
          <div className="check-circle" style={{ width: 104, height: 104, borderRadius: '50%', background: 'var(--green-tint)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
            <Icon name="unlock" size={50} style={{ color: 'var(--green)' }} />
          </div>
          <div className="h1">Focus Mode ended</div>
          <div className="body mt8" style={{ maxWidth: 290 }}>Your teacher ended the session. All your apps are available again.</div>
          <div className="card card-pad fw mt20 rowflex gap12" style={{ background: 'var(--bg)', boxShadow: 'none' }}>
            <Tile tone="green" icon="check" size={40} iconSize={20} />
            <div className="grow" style={{ textAlign: 'left' }}><div className="body-strong">7 apps unlocked</div><div className="foot">AP Biology · 9:52 AM</div></div>
          </div>
          <Btn kind="primary" block size="lg" style={{ marginTop: 20 }} onClick={() => app.dismissSessionEnded()}>Done</Btn>
        </div>
      </div>
    </>
  );
}

// ── Focus policy preview (from class detail) ───────────────────────────
function FocusPreviewScreen({ app, params }) {
  const cls = app.data.classes.find(c => c.id === params.id);
  const pol = POLICIES[cls.policy];
  const blocked = pol.blocks.map(appById);
  const allowed = pol.allows.map(appById).filter(Boolean);
  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar"><button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button></div>
      <div className="screen-scroll no-tab" style={{ paddingTop: 100 }}>
        <Eyebrow>{cls.name} · Focus policy</Eyebrow>
        <div className="h-display mt4">{pol.name}</div>
        <div className="body mt8">{pol.desc} Your teacher controls this — you can’t change it during class.</div>

        <div className="h3 mt24 mb14">Paused during class · {blocked.length}</div>
        <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', rowGap: 18 }}>
          {blocked.map(a => <AppTile key={a.id} app={a} locked />)}
        </div>

        <div className="h3 mt24 mb14">Always available · {allowed.length}</div>
        <div className="card card-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', rowGap: 18 }}>
          {allowed.map(a => <AppTile key={a.id} app={a} />)}
        </div>
        <div style={{ height: 10 }} />
      </div>
    </div>
  );
}

// ── Focus tab when nothing is active ───────────────────────────────────
function FocusIdleScreen({ app }) {
  const live = app.data.classes.find(c => c.session.active && app.state.checkedIn[c.id]);
  if (live) return <FocusActiveScreen app={app} />;
  const liveNotCheckedIn = app.data.classes.find(c => c.session.active);
  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      <div className="screen-scroll">
        <Eyebrow muted>Focus</Eyebrow>
        <div className="h-display mt4 mb20">Focus Mode</div>
        <div className="card center col tc" style={{ padding: '36px 24px' }}>
          <div style={{ width: 96, height: 96, borderRadius: 28, background: 'var(--blue-tint)', display: 'grid', placeItems: 'center', marginBottom: 18 }}>
            <Icon name="moon" size={46} style={{ color: 'var(--blue)' }} />
          </div>
          <div className="h2">Focus is resting</div>
          <div className="body mt8" style={{ maxWidth: 280 }}>{liveNotCheckedIn ? 'A class is live — tap your block to start Focus Mode.' : 'Focus Mode turns on automatically when you check in to a live class.'}</div>
          {liveNotCheckedIn && <Btn kind="primary" icon="nfc" style={{ marginTop: 20 }} onClick={() => app.startCheckIn(liveNotCheckedIn.id)}>Tap to check in</Btn>}
        </div>

        <div className="h3 mt24 mb12" style={{ paddingLeft: 4 }}>How it works</div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {[['nfc','Tap your Bali block','Check in the moment class starts.'],
            ['shield','Apps pause automatically','Using your teacher’s session policy.'],
            ['unlock','Everything unlocks','The second the session ends.']].map(([ic,t,d],i) => (
            <div key={i} className="rowflex gap14" style={{ padding: '15px 16px', boxShadow: i ? 'inset 0 1px 0 var(--line-2)' : 'none' }}>
              <Tile tone="blue" icon={ic} size={40} iconSize={20} />
              <div className="grow"><div className="body-strong">{t}</div><div className="foot mt2">{d}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { NfcSheet, FocusActiveScreen, EmergencySheet, SessionEndedOverlay, FocusPreviewScreen, FocusIdleScreen, AppTile, useCountdown });

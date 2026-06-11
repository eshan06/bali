// screens-auth.jsx — Login + device registration + permissions onboarding
// Exports: LoginScreen, RegisterDeviceScreen, PermissionsScreen, PendingAssignScreen

function Field({ icon, type = 'text', placeholder, value, onChange, trailing }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <div className={'field' + (focus ? ' focus' : '')}>
      {icon && <Icon name={icon} size={19} style={{ color: focus ? 'var(--blue)' : 'var(--ink-4)' }} />}
      <input type={type} placeholder={placeholder} value={value}
        onChange={e => onChange && onChange(e.target.value)}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
      {trailing}
    </div>
  );
}

function GoogleG({ size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      <path fill="#4285F4" d="M45 24c0-1.4-.1-2.7-.4-4H24v8h11.8c-.5 2.8-2.1 5.1-4.4 6.7v5.6h7.1C42.7 36.3 45 30.7 45 24Z"/>
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.6c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.8C8.1 41.2 15.4 46 24 46Z"/>
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.8H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.8Z"/>
      <path fill="#EA4335" d="M24 11.4c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.8 29.9 2.7 24 2.7 15.4 2.7 8.1 7.5 4.5 14.6l7.3 5.8c1.7-5.2 6.5-9 12.2-9Z"/>
    </svg>
  );
}

function LoginScreen({ app }) {
  const [email, setEmail] = React.useState('maya.chen@lincoln.edu');
  const [pw, setPw] = React.useState('••••••••••');
  const [show, setShow] = React.useState(false);
  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      {/* hero band */}
      <div style={{ position: 'relative', height: 312, flexShrink: 0, overflow: 'hidden',
        background: 'linear-gradient(160deg, #2E5CFF 0%, #1E3FCC 60%, #16308f 100%)' }}>
        <div style={{ position: 'absolute', inset: 0, opacity: .5,
          background: 'radial-gradient(420px 220px at 80% 0%, rgba(255,255,255,.28), transparent 60%)' }} />
        <div style={{ position: 'absolute', left: 28, top: 78 }}>
          <span style={{ fontWeight: 800, fontSize: 40, letterSpacing: '-0.04em', color: '#fff' }}>bali</span>
          <div style={{ marginTop: 14, maxWidth: 250 }}>
            <div className="h2" style={{ color: '#fff', fontWeight: 700 }}>Focus, made effortless.</div>
            <div style={{ color: 'rgba(255,255,255,.78)', fontSize: 15.5, marginTop: 8, lineHeight: 1.4 }}>
              Tap in. Lock in. Bali handles the rest while you’re in class.
            </div>
          </div>
        </div>
      </div>

      <div className="screen-scroll no-tab" style={{ paddingTop: 26, marginTop: -26,
        background: 'var(--bg)', borderRadius: '26px 26px 0 0', position: 'relative', zIndex: 2 }}>
        <Eyebrow>Student sign in</Eyebrow>
        <div className="mt12 col gap12">
          <div>
            <span className="label">School email</span>
            <Field icon="mail" placeholder="you@school.edu" value={email} onChange={setEmail} />
          </div>
          <div>
            <span className="label">Password</span>
            <Field icon="lock" type={show ? 'text' : 'password'} placeholder="Password" value={pw} onChange={setPw}
              trailing={<button onClick={() => setShow(s => !s)} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'var(--ink-4)', display: 'grid', placeItems: 'center' }}><Icon name="eye" size={19} /></button>} />
          </div>
        </div>

        <div className="rowflex between mt12" style={{ marginBottom: 6 }}>
          <label className="foot rowflex gap6" style={{ cursor: 'pointer' }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--blue)', display: 'grid', placeItems: 'center' }}><Icon name="check" size={13} style={{ color: '#fff' }} /></span>
            Keep me signed in
          </label>
          <span className="foot" style={{ color: 'var(--blue)', fontWeight: 600 }}>Forgot?</span>
        </div>

        <Btn kind="primary" block size="lg" iconRight="arrow-right" style={{ marginTop: 14 }} onClick={() => app.signIn()}>Sign in</Btn>

        <div className="rowflex gap12 mt20 mb20" style={{ color: 'var(--ink-4)' }}>
          <div className="grow" style={{ height: 1, background: 'var(--line)' }} />
          <span className="foot">or</span>
          <div className="grow" style={{ height: 1, background: 'var(--line)' }} />
        </div>

        <Btn kind="ghost" block icon={null} onClick={() => app.signIn()} style={{ gap: 10 }}>
          <GoogleG /> Continue with Google
        </Btn>

        <div className="tc foot mt24" style={{ lineHeight: 1.5 }}>
          Bali is for <b style={{ color: 'var(--ink-2)' }}>students</b>. Teachers manage classes on the web dashboard.
        </div>
      </div>
    </div>
  );
}

function RegisterDeviceScreen({ app }) {
  const [phase, setPhase] = React.useState('intro'); // intro | generating | done
  const u = app.data.user;
  React.useEffect(() => {
    if (phase === 'generating') { const t = setTimeout(() => setPhase('done'), 1900); return () => clearTimeout(t); }
  }, [phase]);
  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      <div className="screen-scroll no-tab center" style={{ display: 'flex', flexDirection: 'column', textAlign: 'center', paddingTop: 90 }}>
        <div style={{ position: 'relative', marginBottom: 28 }}>
          {phase !== 'done'
            ? <div style={{ width: 132, height: 132, borderRadius: 36, background: 'linear-gradient(150deg,#fff,#EEF1F8)', boxShadow: 'var(--sh-2)', display: 'grid', placeItems: 'center' }}>
                <Icon name="device" size={56} style={{ color: 'var(--blue)' }} />
                {phase === 'generating' && <div className="radar" style={{ position: 'absolute', width: 180, height: 180, top: -24, left: -24 }}><div className="wave" /><div className="wave" /><div className="wave" /></div>}
              </div>
            : <div className="check-circle" style={{ width: 132, height: 132, borderRadius: '50%', background: 'var(--green)', display: 'grid', placeItems: 'center', boxShadow: '0 18px 40px rgba(21,169,116,.4)' }}>
                <Icon name="check" size={64} sw={2.4} style={{ color: '#fff' }} />
              </div>}
        </div>

        {phase === 'intro' && <>
          <Eyebrow>Step 1 of 2 · Device</Eyebrow>
          <div className="h1 mt8">Make this your<br/>Bali phone</div>
          <div className="body mt12" style={{ maxWidth: 290 }}>We’ll register this iPhone so your teacher can pair it with the Bali block on your desk. One phone, one student.</div>
          <div className="card card-pad mt24 fw" style={{ textAlign: 'left' }}>
            <div className="rowflex gap12">
              <Tile tone="blue" icon="device" />
              <div className="grow"><div className="body-strong">{u.deviceModel}</div><div className="foot">This device · iOS 26</div></div>
              <Badge tone="green" dot="green">Ready</Badge>
            </div>
          </div>
          <Btn kind="primary" block size="lg" style={{ marginTop: 22 }} onClick={() => setPhase('generating')}>Register this iPhone</Btn>
        </>}

        {phase === 'generating' && <>
          <Eyebrow>Generating secure device ID</Eyebrow>
          <div className="h2 mt8">Pairing your phone…</div>
          <div className="body mt8">Creating a stable ID that stays with this device.</div>
        </>}

        {phase === 'done' && <>
          <Eyebrow style={{ color: 'var(--green)' }}>Device registered</Eyebrow>
          <div className="h1 mt8">You’re paired</div>
          <div className="card card-pad mt20 fw" style={{ textAlign: 'left' }}>
            <div className="foot">Your device ID</div>
            <div className="rowflex between mt4">
              <span className="h3 tnum" style={{ letterSpacing: '0.02em' }}>{u.deviceId}</span>
              <Badge tone="blue">Stable</Badge>
            </div>
          </div>
          <Btn kind="primary" block size="lg" iconRight="arrow-right" style={{ marginTop: 22 }} onClick={() => app.go('permissions')}>Continue</Btn>
        </>}
      </div>
    </div>
  );
}

function PermissionsScreen({ app, onboarding }) {
  const [granted, setGranted] = React.useState(app.data.user.permissionsGranted && !onboarding ? true : false);
  const [asking, setAsking] = React.useState(false);
  const grant = () => { setAsking(true); setTimeout(() => { setAsking(false); setGranted(true); app.data.user.permissionsGranted = true; }, 1200); };
  const items = [
    { icon: 'shield', t: 'Pause distracting apps', d: 'During class only — never outside session times.' },
    { icon: 'clock', t: 'Use your teacher’s policy', d: 'Bali applies the session’s rules, not your settings.' },
    { icon: 'lock', t: 'Auto-unlock when class ends', d: 'Everything returns the moment the session stops.' },
  ];
  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      {!onboarding && <div className="topbar"><button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button></div>}
      <div className="screen-scroll no-tab" style={{ paddingTop: onboarding ? 90 : 100 }}>
        <div className="center col tc">
          <div style={{ width: 96, height: 96, borderRadius: 28, background: granted ? 'var(--green-tint)' : 'var(--blue-tint)', display: 'grid', placeItems: 'center', marginBottom: 20 }}>
            <Icon name={granted ? 'check-circle' : 'shield'} size={48} style={{ color: granted ? 'var(--green)' : 'var(--blue)' }} />
          </div>
          {onboarding && <Eyebrow>Step 2 of 2 · Permissions</Eyebrow>}
          <div className="h1 mt8">{granted ? 'Focus is ready' : 'Allow Focus blocking'}</div>
          <div className="body mt8" style={{ maxWidth: 300 }}>
            {granted ? 'Bali can now pause apps during class and unlock them automatically afterward.'
              : 'Bali needs Screen Time access to pause apps during class. Here’s exactly what that does:'}
          </div>
        </div>

        {!granted && <div className="card mt24" style={{ overflow: 'hidden' }}>
          {items.map((it, i) => (
            <div key={i} className="rowflex gap14" style={{ padding: '16px 16px', boxShadow: i ? 'inset 0 1px 0 var(--line-2)' : 'none' }}>
              <Tile tone="blue" icon={it.icon} size={40} iconSize={20} />
              <div className="grow"><div className="body-strong">{it.t}</div><div className="foot mt4">{it.d}</div></div>
            </div>
          ))}
        </div>}

        {granted && <div className="card card-pad mt24 rowflex gap12">
          <Tile tone="green" icon="check" /><div className="grow"><div className="body-strong">Screen Time access granted</div><div className="foot">You can revoke this anytime in Settings.</div></div>
        </div>}

        <div style={{ marginTop: 24 }}>
          {!granted
            ? <Btn kind="primary" block size="lg" disabled={asking} onClick={grant}>{asking ? 'Requesting…' : 'Allow access'}</Btn>
            : <Btn kind="primary" block size="lg" iconRight="arrow-right" onClick={() => app.finishOnboarding()}>{onboarding ? 'Enter Bali' : 'Done'}</Btn>}
          {!granted && onboarding && <button className="btn btn-block" style={{ background: 'none', color: 'var(--ink-3)', marginTop: 6, boxShadow: 'none' }} onClick={() => app.finishOnboarding()}>Maybe later</button>}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginScreen, RegisterDeviceScreen, PermissionsScreen, Field, GoogleG });

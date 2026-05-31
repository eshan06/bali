// screens-home.jsx — Home, Classes list, Class detail, Join class
// Exports: HomeScreen, ClassesScreen, ClassDetailScreen, JoinClassScreen, AttendanceRing, ClassCard

function AttendanceRing({ pct, size = 56, color = 'var(--blue)', track = '#E7EAF0', label }) {
  const stroke = 6, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct/100)}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
        fontSize: size > 50 ? 15 : 12.5, fontWeight: 750, letterSpacing: '-0.02em' }}>
        {label != null ? label : pct + '%'}
      </div>
    </div>
  );
}

function sessionStatus(cls, app) {
  const ci = app.state.checkedIn[cls.id];
  if (cls.session.active) {
    if (ci === 'present') return { tone: 'green', dot: 'green', text: 'Checked in', live: true };
    if (ci === 'late') return { tone: 'amber', dot: 'amber', text: 'Checked in late', live: true };
    return { tone: 'blue', dot: 'blue', text: 'Live now · tap in', live: true };
  }
  if (cls.session.nextAt) return { tone: 'gray', dot: 'gray', text: 'Next ' + cls.session.nextAt };
  return { tone: 'gray', dot: 'gray', text: 'No session' };
}

function ClassCard({ cls, app, onClick }) {
  const st = sessionStatus(cls, app);
  const pol = POLICIES[cls.policy];
  return (
    <button className="card card-pad fw" onClick={onClick}
      style={{ border: 0, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 18, bottom: 18, width: 4, borderRadius: 4, background: cls.color }} />
      <div className="rowflex between" style={{ paddingLeft: 10 }}>
        <div className="grow">
          <div className="rowflex gap8">
            <Eyebrow style={{ color: cls.color }}>{cls.period}</Eyebrow>
            {st.live && <span className="badge b-blue" style={{ height: 20, padding: '0 8px', fontSize: 11, background: st.tone==='blue'?'var(--blue-tint)':st.tone==='green'?'var(--green-tint)':'var(--amber-tint)', color: st.tone==='blue'?'var(--blue-700)':st.tone==='green'?'#0E7a52':'#9A5C05' }}>{st.live && <span className="live-dot" style={{ width:6, height:6, background: 'var(--'+(st.tone==='blue'?'blue':st.tone)+')' }} />}LIVE</span>}
          </div>
          <div className="h2 mt4">{cls.name}</div>
          <div className="foot mt4">{cls.teacher}</div>
        </div>
        <AttendanceRing pct={cls.attendance} color={cls.color} />
      </div>
      <div className="rowflex between mt16" style={{ paddingLeft: 10, paddingTop: 14, boxShadow: 'inset 0 1px 0 var(--line-2)' }}>
        <span className="rowflex gap6 foot"><Icon name="lock" size={15} style={{ color: 'var(--ink-4)' }} /><b style={{ color: 'var(--ink-2)', fontWeight: 600 }}>{pol.name}</b></span>
        <span className="badge" style={{ background: 'none', padding: 0, color: 'var(--'+st.dot+', var(--ink-3))' }}>
          <span className={'dot dot-' + st.dot} />
          <span className="foot" style={{ color: st.dot==='gray' ? 'var(--ink-3)' : 'var(--ink-2)', fontWeight: 600 }}>{st.text}</span>
        </span>
      </div>
    </button>
  );
}

function HomeScreen({ app }) {
  const { user, classes, invites } = app.data;
  const live = classes.find(c => c.session.active);
  const ci = live && app.state.checkedIn[live.id];
  const avgAtt = Math.round(classes.reduce((s, c) => s + c.attendance, 0) / classes.length);
  const hour = 9;
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      <div className="screen-scroll">
        {/* header */}
        <div className="rowflex between" style={{ marginTop: 4 }}>
          <div>
            <div className="foot" style={{ fontWeight: 600 }}>{greet},</div>
            <div className="h-display">{user.firstName}.</div>
          </div>
          <button onClick={() => app.go('notifications')} style={{ position: 'relative', border: 0, background: '#fff', width: 46, height: 46, borderRadius: '50%', boxShadow: 'var(--sh-1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="bell" size={21} />
            <span style={{ position: 'absolute', top: 9, right: 10, width: 9, height: 9, borderRadius: '50%', background: 'var(--coral)', border: '2px solid #fff' }} />
          </button>
        </div>

        {/* hero: live session OR focus active OR all-clear */}
        {live && ci ? (
          <button className="fw scr-enter" onClick={() => app.go('focus')} style={{ border: 0, cursor: 'pointer', textAlign: 'left', marginTop: 18, borderRadius: 24, overflow: 'hidden',
            background: 'linear-gradient(155deg, #0C1430, #070C1A)', boxShadow: '0 18px 40px rgba(10,20,48,.34)', padding: 20, position: 'relative' }}>
            <div style={{ position: 'absolute', right: -30, top: -30, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle, rgba(46,92,255,.45), transparent 70%)' }} />
            <div className="rowflex between" style={{ position: 'relative' }}>
              <span className="badge" style={{ background: 'rgba(46,92,255,.22)', color: '#B9CBFF' }}><span className="live-dot" style={{ width: 7, height: 7 }} />FOCUS ACTIVE</span>
              <Icon name="chevron" size={18} style={{ color: 'rgba(255,255,255,.5)' }} />
            </div>
            <div className="h1 mt16" style={{ color: '#fff' }}>{live.name}</div>
            <div style={{ color: 'rgba(234,240,255,.66)', fontSize: 14.5, marginTop: 6 }}>Apps unlock when the session ends · {live.session.endsAt}</div>
            <div className="rowflex gap16 mt16" style={{ position: 'relative' }}>
              <span className="rowflex gap6" style={{ color: '#fff', fontSize: 13.5, fontWeight: 600 }}><Icon name="lock" size={16} />{POLICIES[live.policy].blocks.length} apps paused</span>
              <span className="rowflex gap6" style={{ color: ci==='late'?'#FFD18A':'#8DEBC4', fontSize: 13.5, fontWeight: 600 }}><Icon name="check" size={16} />{ci === 'late' ? 'Checked in late' : 'Checked in'}</span>
            </div>
          </button>
        ) : live ? (
          <button className="fw scr-enter" onClick={() => app.startCheckIn(live.id)} style={{ border: 0, cursor: 'pointer', textAlign: 'left', marginTop: 18, borderRadius: 24,
            background: 'linear-gradient(150deg, #2E5CFF, #1E3FCC)', boxShadow: 'var(--sh-blue)', padding: 20, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', right: -20, top: -20, opacity: .25 }}><Icon name="nfc" size={150} style={{ color: '#fff' }} /></div>
            <span className="badge" style={{ background: 'rgba(255,255,255,.22)', color: '#fff' }}><span className="live-dot" style={{ width: 7, height: 7, background: '#fff' }} />CLASS IS LIVE</span>
            <div className="h1 mt16" style={{ color: '#fff' }}>{live.name} started</div>
            <div style={{ color: 'rgba(255,255,255,.82)', fontSize: 14.5, marginTop: 6 }}>Tap your Bali block at {live.session.blockName} to check in.</div>
            <div className="rowflex gap8 mt16" style={{ background: '#fff', color: 'var(--blue)', borderRadius: 9999, padding: '12px 18px', width: 'fit-content', fontWeight: 700, fontSize: 15.5 }}>
              <Icon name="nfc" size={20} /> Tap to check in
            </div>
          </button>
        ) : (
          <div className="card card-pad mt16 rowflex gap14">
            <Tile tone="green" icon="check-circle" />
            <div className="grow"><div className="body-strong">You’re all set</div><div className="foot mt4">No live sessions. Next: World History · 11:15 AM.</div></div>
          </div>
        )}

        {/* stat row */}
        <div className="rowflex gap12 mt16">
          <div className="card card-pad grow" style={{ padding: 16 }}>
            <AttendanceRing pct={avgAtt} size={48} />
            <div className="body-strong mt12" style={{ fontSize: 14 }}>Attendance</div>
            <div className="foot">across {classes.length} classes</div>
          </div>
          <div className="card card-pad grow" style={{ padding: 16 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'var(--amber-tint)', display: 'grid', placeItems: 'center' }}><Icon name="flame" size={26} style={{ color: 'var(--amber)' }} /></div>
            <div className="body-strong mt12" style={{ fontSize: 14 }}>{user.streak}-day streak</div>
            <div className="foot">on-time check-ins</div>
          </div>
        </div>

        {/* classes */}
        <div className="rowflex between mt32 mb12">
          <div className="h2">Your classes</div>
          <button onClick={() => app.setTab('classes')} style={{ border: 0, background: 'none', color: 'var(--blue)', fontWeight: 650, fontSize: 14.5, cursor: 'pointer' }}>See all</button>
        </div>
        <div className="col gap12">
          {classes.map(c => <ClassCard key={c.id} cls={c} app={app} onClick={() => app.go('class', { id: c.id })} />)}
        </div>

        {/* pending invites */}
        {invites.length > 0 && <>
          <div className="h2 mt32 mb12">Pending invite</div>
          {invites.map(iv => (
            <div key={iv.id} className="card card-pad rowflex gap14">
              <Tile tone="amber" icon="mail" />
              <div className="grow"><div className="body-strong">{iv.name}</div><div className="foot mt4">{iv.teacher} · {iv.period}</div></div>
              <Btn kind="secondary" size="sm" onClick={() => app.go('join', { invite: iv })}>Review</Btn>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}

function ClassesScreen({ app }) {
  const { classes } = app.data;
  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      <div className="screen-scroll">
        <div className="rowflex between" style={{ marginTop: 4 }}>
          <div><Eyebrow muted>Your roster</Eyebrow><div className="h-display mt4">Classes</div></div>
          <button onClick={() => app.go('join', {})} style={{ border: 0, background: 'var(--blue)', color: '#fff', width: 46, height: 46, borderRadius: '50%', display: 'grid', placeItems: 'center', boxShadow: 'var(--sh-blue)', cursor: 'pointer' }}><Icon name="plus" size={22} /></button>
        </div>
        <div className="body mt8 mb20">Tap a class to see attendance, sessions, and focus policy.</div>
        <div className="col gap12">
          {classes.map(c => <ClassCard key={c.id} cls={c} app={app} onClick={() => app.go('class', { id: c.id })} />)}
        </div>
        <button className="card card-pad fw mt12 rowflex gap14 center" onClick={() => app.go('join', {})}
          style={{ border: '2px dashed var(--line)', boxShadow: 'none', background: 'none', cursor: 'pointer', padding: 18 }}>
          <Icon name="plus" size={20} style={{ color: 'var(--blue)' }} />
          <span className="body-strong" style={{ color: 'var(--blue)' }}>Join a class</span>
        </button>
      </div>
    </div>
  );
}

function StatRow({ icon, tone, label, value, sub, onClick }) {
  return (
    <div className="rowflex gap14" style={{ padding: '14px 0', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <Tile tone={tone} icon={icon} size={40} iconSize={20} />
      <div className="grow"><div className="foot">{label}</div><div className="body-strong">{value}</div></div>
      {sub}
    </div>
  );
}

function ClassDetailScreen({ app, params }) {
  const cls = app.data.classes.find(c => c.id === params.id);
  const pol = POLICIES[cls.policy];
  const st = sessionStatus(cls, app);
  const ci = app.state.checkedIn[cls.id];
  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button>
        <div className="grow" />
        <button className="icon-btn"><Icon name="info" size={19} /></button>
      </div>
      <div className="screen-scroll" style={{ paddingTop: 100 }}>
        {/* header card */}
        <div style={{ borderRadius: 24, padding: 22, color: '#fff', position: 'relative', overflow: 'hidden',
          background: `linear-gradient(155deg, ${cls.color}, color-mix(in oklab, ${cls.color} 70%, #0A1430))` }}>
          <div style={{ position: 'absolute', right: -24, top: -24, width: 130, height: 130, borderRadius: '50%', background: 'rgba(255,255,255,.14)' }} />
          <Eyebrow style={{ color: 'rgba(255,255,255,.85)' }}>{cls.period}</Eyebrow>
          <div className="h1 mt8" style={{ color: '#fff' }}>{cls.name}</div>
          <div className="rowflex gap16 mt12" style={{ color: 'rgba(255,255,255,.86)', fontSize: 14, fontWeight: 500 }}>
            <span className="rowflex gap6"><Icon name="profile" size={16} />{cls.teacher}</span>
            <span className="rowflex gap6"><Icon name="school" size={16} />{cls.school}</span>
          </div>
        </div>

        {/* live session state */}
        {cls.session.active ? (
          <div className="card card-pad mt16" style={{ boxShadow: '0 0 0 1.5px var(--blue), var(--sh-1)' }}>
            <div className="rowflex between">
              <span className="badge b-blue"><span className="live-dot" style={{ width: 7, height: 7 }} />SESSION LIVE</span>
              <span className="foot tnum">{cls.session.startedAt}–{cls.session.endsAt}</span>
            </div>
            {!ci ? <>
              <div className="h3 mt12">Check in at {cls.session.blockName}</div>
              <div className="foot mt4">Tap your Bali block to mark yourself present and start Focus Mode.</div>
              <Btn kind="primary" block icon="nfc" style={{ marginTop: 14 }} onClick={() => app.startCheckIn(cls.id)}>Tap to check in</Btn>
            </> : <>
              <div className="rowflex gap12 mt12">
                <Tile tone={ci==='late'?'amber':'green'} icon="check" />
                <div className="grow"><div className="body-strong">{ci === 'late' ? 'Checked in late' : 'Checked in'}</div><div className="foot">Focus Mode is active · {pol.name}</div></div>
              </div>
              <Btn kind="dark" block icon="shield" style={{ marginTop: 14 }} onClick={() => app.go('focus')}>View Focus Mode</Btn>
            </>}
          </div>
        ) : (
          <div className="card card-pad mt16 rowflex gap14">
            <Tile tone="gray" icon="clock" />
            <div className="grow"><div className="body-strong">No active session</div><div className="foot">{cls.session.nextAt ? 'Next session at ' + cls.session.nextAt : 'Check back during class'}</div></div>
          </div>
        )}

        {/* stats */}
        <div className="rowflex gap12 mt16">
          <div className="card card-pad grow center col"><AttendanceRing pct={cls.attendance} color={cls.color} size={62} /><div className="foot mt8">Attendance</div></div>
          <div className="card card-pad grow center col tc">
            <div className="h-display" style={{ color: cls.color }}>{cls.present}</div>
            <div className="foot">of {cls.total} sessions present</div>
          </div>
        </div>

        {/* assigned device + policy */}
        <div className="card mt16" style={{ padding: '4px 18px' }}>
          <StatRow icon="device" tone="blue" label="Assigned device" value={cls.device.name}
            sub={<Badge tone={cls.device.assigned ? 'green' : 'amber'} dot={cls.device.assigned ? 'green' : 'amber'}>{cls.device.assigned ? 'Linked' : 'Pending'}</Badge>} />
          <div style={{ height: 1, background: 'var(--line-2)' }} />
          <StatRow icon="lock" tone="violet" label="Focus policy" value={pol.name}
            onClick={() => app.go('focusPreview', { id: cls.id })}
            sub={<Icon name="chevron" size={16} style={{ color: 'var(--ink-4)' }} />} />
        </div>

        {/* recent sessions */}
        <div className="h3 mt24 mb10" style={{ paddingLeft: 4 }}>Recent sessions</div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {cls.recent.map((r, i) => {
            const map = { present: ['green','Present'], late: ['amber','Late'], absent: ['coral','Absent'] };
            const [tone, txt] = map[r.status];
            return (
              <div key={i} className="rowflex gap12" style={{ padding: '14px 16px', boxShadow: i ? 'inset 0 1px 0 var(--line-2)' : 'none' }}>
                <span className={'dot dot-' + tone} style={{ width: 9, height: 9 }} />
                <div className="grow body-strong" style={{ fontSize: 15 }}>{r.date}</div>
                <span className="foot tnum">{r.time || '—'}</span>
                <Badge tone={tone} style={{ minWidth: 64, justifyContent: 'center' }}>{txt}</Badge>
              </div>
            );
          })}
        </div>
        <div style={{ height: 8 }} />
      </div>
    </div>
  );
}

function JoinClassScreen({ app, params }) {
  const invite = params.invite;
  const [method, setMethod] = React.useState(invite ? 'link' : 'code');
  const [code, setCode] = React.useState('');
  const [found, setFound] = React.useState(invite || null);
  const fakeClass = invite || { name: 'AP Chemistry', teacher: 'Dr. Patel', period: 'Period 2', school: 'Lincoln High', color: '#E08A12' };

  const tryCode = (v) => { setCode(v); if (v.replace(/\s/g,'').length >= 6) setFound(fakeClass); else setFound(null); };

  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar"><button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button></div>
      <div className="screen-scroll no-tab" style={{ paddingTop: 100 }}>
        <Eyebrow>Add a class</Eyebrow>
        <div className="h-display mt4 mb16">Join class</div>

        <div className="seg mb20">
          {[['code','Code'],['link','Link'],['qr','QR']].map(([k,l]) => (
            <button key={k} className={method===k?'on':''} onClick={() => setMethod(k)}>{l}</button>
          ))}
        </div>

        {method === 'code' && <div>
          <span className="label">Class code from your teacher</span>
          <Field icon="hand" placeholder="e.g. 7K2-Q9F" value={code} onChange={tryCode} />
          <div className="foot mt8">Enter the 6-character code shown on the board.</div>
        </div>}

        {method === 'link' && <div className="card card-pad rowflex gap12">
          <Tile tone="blue" icon="link" />
          <div className="grow"><div className="body-strong">Invite link detected</div><div className="foot mt4">bali.app/join/{(invite?.id||'chem')}</div></div>
        </div>}

        {method === 'qr' && <div className="card center col" style={{ padding: 28 }}>
          <div style={{ width: 200, height: 200, borderRadius: 20, background: '#0D1526', display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden' }}>
            <Icon name="qr" size={120} style={{ color: '#fff' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: 'var(--blue)', boxShadow: '0 0 12px var(--blue)', top: '50%', animation: 'scanline 2s ease-in-out infinite' }} />
          </div>
          <div className="foot mt16 tc">Point your camera at the QR code on the board.</div>
        </div>}

        {/* confirm card */}
        {(found || method === 'link') && <div className="scr-enter">
          <div className="h3 mt32 mb10">Confirm before joining</div>
          <div className="card card-pad">
            <div className="rowflex gap14">
              <div style={{ width: 48, height: 48, borderRadius: 14, background: fakeClass.color, display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="school" size={24} /></div>
              <div className="grow">
                <div className="h3">{fakeClass.name}</div>
                <div className="foot mt4">{fakeClass.teacher} · {fakeClass.period}</div>
              </div>
            </div>
            <div className="rowflex gap8 mt16" style={{ paddingTop: 14, boxShadow: 'inset 0 1px 0 var(--line-2)' }}>
              <Icon name="school" size={16} style={{ color: 'var(--ink-4)' }} /><span className="foot">{fakeClass.school}</span>
            </div>
          </div>
          <Btn kind="primary" block size="lg" icon="plus" style={{ marginTop: 16 }} onClick={() => app.joinClass(fakeClass)}>Join {fakeClass.name}</Btn>
          <button className="btn btn-block" style={{ background: 'none', color: 'var(--ink-3)', boxShadow: 'none', marginTop: 4 }} onClick={() => app.back()}>Cancel</button>
        </div>}
      </div>
    </div>
  );
}

Object.assign(window, { HomeScreen, ClassesScreen, ClassDetailScreen, JoinClassScreen, AttendanceRing, ClassCard, sessionStatus });

// app.jsx — orchestrator: state, navigation, tab bar, device frame, jump-nav
const { useState, useRef, useEffect } = React;

function TabBar({ app, dark }) {
  const tabs = [
    { id: 'home', icon: 'home', label: 'Home' },
    { id: 'classes', icon: 'classes', label: 'Classes' },
    { id: 'focus', icon: 'shield', label: 'Focus' },
    { id: 'profile', icon: 'profile', label: 'Profile' },
  ];
  const left = tabs.slice(0, 2), right = tabs.slice(2);
  const live = app.data.classes.find(c => c.session.active) || app.data.classes[0];
  const Tab = (t) => (
    <button key={t.id} className={'tab' + (app.s.tab === t.id && app.s.stack.length === 0 ? ' active' : '')} onClick={() => app.setTab(t.id)}>
      <Icon name={t.icon} size={25} sw={app.s.tab === t.id ? 2.2 : 1.9} />
      <span>{t.label}</span>
    </button>
  );
  return (
    <div className="tabbar">
      {left.map(Tab)}
      <div className="tab-fab">
        <button className="fab" onClick={() => app.startCheckIn(live.id)} title="Tap to check in">
          <Icon name="nfc" size={30} />
        </button>
      </div>
      {right.map(Tab)}
    </div>
  );
}

function App() {
  const dataRef = useRef(null);
  if (!dataRef.current) dataRef.current = structuredClone(BALI_DATA);
  const initial = { phase: 'app', onbStep: 'register', tab: 'home', stack: [], sheet: null, checkIn: null, checkedIn: {}, sessionEnded: false };
  const [s, setS] = useState(initial);
  const [, force] = useState(0);
  const rerender = () => force(x => x + 1);
  const update = (p) => setS(prev => ({ ...prev, ...p }));

  const app = {
    data: dataRef.current, s, state: s, rerender,
    go(name, params = {}) {
      if (name === 'focus') return update({ tab: 'focus', stack: [] });
      if (name === 'permissions' && s.phase === 'onboarding') return update({ onbStep: 'permissions' });
      setS(prev => ({ ...prev, stack: [...prev.stack, { name, params }] }));
    },
    back() {
      if (s.phase === 'onboarding') { if (s.onbStep === 'permissions') return update({ onbStep: 'register' }); return update({ phase: 'auth' }); }
      update({ stack: s.stack.slice(0, -1) });
    },
    setTab(tab) { update({ tab, stack: [] }); },
    openSheet(name, params = {}) { update({ sheet: { name, params } }); },
    closeSheet() { update({ sheet: null, checkIn: null }); },
    signIn() { update({ phase: 'onboarding', onbStep: 'register' }); },
    finishOnboarding() { dataRef.current.user.deviceRegistered = true; dataRef.current.user.deviceAssigned = true; update({ phase: 'app', tab: 'home', stack: [] }); },
    startCheckIn(classId, forced = null) { update({ checkIn: { classId, forced }, sheet: { name: 'nfc' } }); },
    completeCheckIn(classId, status) {
      update({ checkedIn: { ...s.checkedIn, [classId]: status }, sheet: null, checkIn: null, tab: 'focus', stack: [] });
    },
    joinClass(cls) {
      const d = dataRef.current;
      if (!d.classes.find(c => c.name === cls.name)) {
        d.classes.push({ id: cls.id || cls.name.toLowerCase().replace(/\s/g,''), name: cls.name, teacher: cls.teacher, period: cls.period,
          school: cls.school, color: cls.color, policy: 'social', attendance: 100, present: 0, total: 0,
          device: { assigned: true, name: d.user.deviceModel, id: d.user.deviceId },
          session: { active: false, nextAt: '—' }, recent: [] });
        d.invites = d.invites.filter(i => i.name !== cls.name);
      }
      update({ stack: [], tab: 'classes' });
    },
    endSession() { const live = dataRef.current.classes.find(c => c.session.active); if (live) live.session.active = false; update({ sessionEnded: true, sheet: null }); },
    dismissSessionEnded() { update({ sessionEnded: false, checkedIn: {}, tab: 'home', stack: [] }); },
    markAllRead() { dataRef.current.notifications.forEach(n => n.unread = false); rerender(); },
    signOut() { dataRef.current = structuredClone(BALI_DATA); setS({ ...initial, phase: 'auth' }); },
    resetDemo() { dataRef.current = structuredClone(BALI_DATA); setS(initial); },
  };

  // ── resolve dark mode ──
  const focusActiveVisible = s.phase === 'app' && s.stack.length === 0 && s.tab === 'focus'
    && dataRef.current.classes.some(c => c.session.active && s.checkedIn[c.id]);
  const dark = focusActiveVisible;
  const showTabBar = s.phase === 'app' && s.stack.length === 0 && !dark;

  // ── render screens ──
  const renderRoot = () => {
    switch (s.tab) {
      case 'home': return <HomeScreen app={app} />;
      case 'classes': return <ClassesScreen app={app} />;
      case 'focus': return <FocusIdleScreen app={app} />;
      case 'profile': return <ProfileScreen app={app} />;
      default: return <HomeScreen app={app} />;
    }
  };
  const renderStack = (top) => {
    const map = {
      class: ClassDetailScreen, join: JoinClassScreen, settings: SettingsScreen,
      profile: ProfileScreen, notifications: NotificationsScreen, permissions: PermissionsScreen,
      focusPreview: FocusPreviewScreen, deviceInfo: DeviceInfoScreen,
    };
    const C = map[top.name];
    return C ? <C app={app} params={top.params} /> : null;
  };
  const top = s.stack[s.stack.length - 1];

  return (
    <div className="app-root" style={{ position: 'relative', height: 874, width: 402, overflow: 'hidden' }}>
      {s.phase === 'auth' && <LoginScreen app={app} />}
      {s.phase === 'onboarding' && (s.onbStep === 'register'
        ? <RegisterDeviceScreen app={app} />
        : <PermissionsScreen app={app} onboarding />)}
      {s.phase === 'app' && <>
        <div key={s.tab} style={{ height: '100%' }}>{renderRoot()}</div>
        {top && <div key={s.stack.length + top.name} style={{ position: 'absolute', inset: 0, zIndex: 20 }}>{renderStack(top)}</div>}
        {showTabBar && <TabBar app={app} dark={dark} />}
      </>}

      {s.sheet && s.sheet.name === 'nfc' && <NfcSheet app={app} />}
      {s.sheet && s.sheet.name === 'emergency' && <EmergencySheet app={app} />}
      {s.sessionEnded && <SessionEndedOverlay app={app} />}

      {/* expose for jump-nav */}
      {(window.__bali = app) && null}
    </div>
  );
}

// ── jump-nav rail (reviewer tool, lives outside the phone) ──
function JumpRail() {
  const [open, setOpen] = useState(true);
  const [cur, setCur] = useState('Home');
  const a = () => window.__bali;
  const jump = (label, fn) => () => { setCur(label); fn(a()); };
  const groups = [
    ['Onboarding', [
      ['Login', x => x.signOut()],
      ['Register device', x => { x.signOut(); x.signIn(); }],
      ['Permissions', x => { x.signIn(); setTimeout(() => window.__bali.go('permissions'), 0); }],
    ]],
    ['Main tabs', [
      ['Home', x => { x.finishOnboarding(); x.setTab('home'); }],
      ['Classes', x => { x.finishOnboarding(); x.setTab('classes'); }],
      ['Profile', x => { x.finishOnboarding(); x.setTab('profile'); }],
      ['Settings', x => { x.finishOnboarding(); x.go('settings'); }],
      ['Notifications', x => { x.finishOnboarding(); x.go('notifications'); }],
    ]],
    ['Classes & joining', [
      ['Class detail (live)', x => { x.finishOnboarding(); x.go('class', { id: 'bio' }); }],
      ['Class detail (idle)', x => { x.finishOnboarding(); x.go('class', { id: 'hist' }); }],
      ['Focus policy preview', x => { x.finishOnboarding(); x.go('focusPreview', { id: 'bio' }); }],
      ['Join class', x => { x.finishOnboarding(); x.go('join', {}); }],
      ['Device info', x => { x.finishOnboarding(); x.go('deviceInfo', {}); }],
    ]],
    ['NFC check-in states', [
      ['Tap → checked in', x => { x.finishOnboarding(); x.startCheckIn('bio'); }],
      ['Checked in late', x => { x.finishOnboarding(); x.startCheckIn('bio', 'late'); }],
      ['Check-in failed', x => { x.finishOnboarding(); x.startCheckIn('bio', 'failed'); }],
      ['Device not assigned', x => { x.finishOnboarding(); x.startCheckIn('bio', 'notAssigned'); }],
      ['No active session', x => { x.finishOnboarding(); x.startCheckIn('bio', 'noSession'); }],
    ]],
    ['Focus mode', [
      ['Focus Mode active', x => { x.finishOnboarding(); x.completeCheckIn('bio', 'present'); }],
      ['Focus (resting)', x => { x.finishOnboarding(); x.setTab('focus'); }],
      ['Emergency unlock', x => { x.finishOnboarding(); x.completeCheckIn('bio', 'present'); setTimeout(() => window.__bali.openSheet('emergency'), 60); }],
      ['Session ended', x => { x.finishOnboarding(); x.completeCheckIn('bio', 'present'); setTimeout(() => window.__bali.endSession(), 60); }],
    ]],
    ['', [['↺ Reset demo', x => { x.resetDemo(); setCur('Home'); }]]],
  ];
  return (
    <>
      <button className="rail-toggle" onClick={() => setOpen(o => !o)}>
        <Icon name={open ? 'x' : 'grid-apps'} size={15} /> {open ? 'Hide' : 'Screens'}
      </button>
      <div className={'rail' + (open ? ' open' : '')}>
        <div style={{ padding: '4px 6px 12px' }}><Logo size={24} /><span className="foot" style={{ marginLeft: 8 }}>student app</span></div>
        {groups.map(([h, items], i) => (
          <div key={i}>
            {h && <h4>{h}</h4>}
            {items.map(([label, fn]) => (
              <button key={label} className={'jump' + (cur === label ? ' cur' : '')} onClick={jump(label, fn)}>{label}</button>
            ))}
          </div>
        ))}
        <div style={{ height: 20 }} />
      </div>
    </>
  );
}

// ── mount: device frame + scaling ──
function Root() {
  const wrapRef = useRef(null);
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current; if (!el) return;
      const margin = 32;
      const scale = Math.min(1, (window.innerHeight - margin) / 874, (window.innerWidth - 300) / 402);
      el.style.transform = `scale(${Math.max(0.4, scale)})`;
    };
    fit(); window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const [dark, setDark] = useState(false);
  // observe app dark state via polling (cheap) for frame chrome
  useEffect(() => {
    const t = setInterval(() => {
      const a = window.__bali; if (!a) return;
      const d = a.s.phase === 'app' && a.s.stack.length === 0 && a.s.tab === 'focus'
        && a.data.classes.some(c => c.session.active && a.s.checkedIn[c.id]);
      setDark(prev => prev === d ? prev : d);
    }, 120);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <JumpRail />
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 16, paddingLeft: 240 }}>
        <div className="phone-wrap" ref={wrapRef}>
          <IOSDevice dark={dark}>
            <App />
          </IOSDevice>
        </div>
      </div>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<Root />);

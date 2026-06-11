// screens-misc.jsx — Profile, Settings, Notifications
// Exports: ProfileScreen, SettingsScreen, NotificationsScreen

function ProfileScreen({ app }) {
  const u = app.data.user;
  const [first, setFirst] = React.useState(u.firstName);
  const [last, setLast] = React.useState(u.lastName);
  const [grade, setGrade] = React.useState(String(u.grade));
  const [saved, setSaved] = React.useState(false);
  const dirty = first !== u.firstName || last !== u.lastName || grade !== String(u.grade);
  const save = () => { u.firstName = first; u.lastName = last; u.grade = Number(grade); setSaved(true); setTimeout(() => setSaved(false), 1600); };

  return (
    <div className="screen scr-enter" style={{ background: 'var(--bg)' }}>
      <div className="screen-scroll">
        <div className="rowflex between" style={{ marginTop: 4 }}>
          <div><Eyebrow muted>Account</Eyebrow><div className="h-display mt4">Profile</div></div>
          <button onClick={() => app.go('settings')} style={{ border: 0, background: '#fff', width: 46, height: 46, borderRadius: '50%', boxShadow: 'var(--sh-1)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}><Icon name="gear" size={22} /></button>
        </div>

        {/* avatar */}
        <div className="center col tc mt20 mb24">
          <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'linear-gradient(150deg,#335CFF,#1E3FCC)', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 34, fontWeight: 750, boxShadow: 'var(--sh-blue)' }}>
            {u.firstName[0]}{u.lastName[0]}
          </div>
          <div className="h2 mt12">{u.firstName} {u.lastName}</div>
          <div className="foot mt2">Grade {u.grade} · {u.school}</div>
          <div className="rowflex gap8 mt12">
            <Badge tone="green" dot="green">Device linked</Badge>
            <Badge tone="blue"><Icon name="flame" size={13} />{u.streak}-day streak</Badge>
          </div>
        </div>

        {/* editable fields */}
        <Eyebrow muted style={{ paddingLeft: 4, marginBottom: 10 }}>Personal details</Eyebrow>
        <div className="col gap12">
          <div className="rowflex gap12">
            <div className="grow"><span className="label">First name</span><Field value={first} onChange={setFirst} /></div>
            <div className="grow"><span className="label">Last name</span><Field value={last} onChange={setLast} /></div>
          </div>
          <div><span className="label">Grade</span>
            <div className="seg">{['9','10','11','12'].map(g => <button key={g} className={grade===g?'on':''} onClick={() => setGrade(g)}>{g}</button>)}</div>
          </div>
          <div><span className="label">School email <span style={{ color: 'var(--ink-4)', fontWeight: 500 }}>· read only</span></span>
            <div className="field" style={{ background: '#EFF1F5', boxShadow: 'none' }}>
              <Icon name="mail" size={19} style={{ color: 'var(--ink-4)' }} />
              <span style={{ color: 'var(--ink-3)', fontSize: 16 }}>{u.email}</span>
              <Icon name="lock" size={17} style={{ color: 'var(--ink-4)' }} />
            </div>
          </div>
        </div>

        <Btn kind={saved ? 'secondary' : 'primary'} block size="lg" disabled={!dirty && !saved} icon={saved ? 'check' : null} style={{ marginTop: 18 }} onClick={save}>
          {saved ? 'Saved' : 'Save changes'}
        </Btn>
      </div>
    </div>
  );
}

function SettingsScreen({ app }) {
  const u = app.data.user;
  const Group = ({ header, children }) => (
    <div className="mt24"><Eyebrow muted style={{ paddingLeft: 4, marginBottom: 10 }}>{header}</Eyebrow>
      <div className="card" style={{ overflow: 'hidden', padding: '0 0' }}>{children}</div></div>
  );
  const Row = ({ icon, tone, label, value, valueTone, onClick, last, chevron }) => (
    <div className="rowflex gap14" onClick={onClick} style={{ padding: '14px 16px', cursor: onClick ? 'pointer' : 'default', boxShadow: last ? 'none' : 'inset 0 -1px 0 var(--line-2)' }}>
      <Tile tone={tone} icon={icon} size={36} iconSize={19} />
      <div className="grow body-strong" style={{ fontSize: 15.5 }}>{label}</div>
      {value && (valueTone ? <Badge tone={valueTone} dot={valueTone === 'green' ? 'green' : valueTone === 'amber' ? 'amber' : undefined}>{value}</Badge> : <span className="foot tnum">{value}</span>)}
      {chevron && <Icon name="chevron" size={16} style={{ color: 'var(--ink-4)' }} />}
    </div>
  );

  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar"><button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button></div>
      <div className="screen-scroll" style={{ paddingTop: 100 }}>
        <Eyebrow muted>Manage</Eyebrow>
        <div className="h-display mt4">Settings</div>

        <Group header="Account">
          <Row icon="profile" tone="blue" label="Profile" onClick={() => app.go('profile')} chevron />
          <Row icon="mail" tone="violet" label="Email" value={u.email} last />
        </Group>

        <Group header="Device & focus">
          <Row icon="device" tone="ink" label="Registered device" value={u.deviceModel} chevron onClick={() => app.go('deviceInfo')} />
          <Row icon="lock" tone="amber" label="Focus permissions" value={u.permissionsGranted ? 'Granted' : 'Off'} valueTone={u.permissionsGranted ? 'green' : 'amber'} onClick={() => app.go('permissions')} />
          <Row icon="school" tone="green" label="Class assignment" value="Linked" valueTone="green" last />
        </Group>

        <Group header="Notifications">
          <Row icon="bell" tone="blue" label="Class & focus alerts" value="On" valueTone="green" last />
        </Group>

        <Group header="About">
          <Row icon="info" tone="blue" label="Help & support" chevron />
          <Row icon="shield" tone="violet" label="Privacy" chevron />
          <Row icon="sparkle" tone="amber" label="App version" value="2.4.0 (118)" last />
        </Group>

        <button className="btn btn-block btn-danger-soft" style={{ marginTop: 24, height: 54 }} onClick={() => app.signOut()}>
          <Icon name="signout" size={19} /> Sign out
        </button>
        <div className="tc foot mt16" style={{ paddingBottom: 8 }}>Bali for Students · {u.school}</div>
      </div>
    </div>
  );
}

function DeviceInfoScreen({ app }) {
  const u = app.data.user;
  const rows = [
    ['device', 'ink', 'Model', u.deviceModel],
    ['sparkle', 'blue', 'Device ID', u.deviceId],
    ['check-circle', 'green', 'Registration', 'Active'],
    ['school', 'violet', 'Assigned seat', 'Lab Bench 3'],
  ];
  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar"><button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button></div>
      <div className="screen-scroll no-tab" style={{ paddingTop: 100 }}>
        <Eyebrow>This device</Eyebrow>
        <div className="h-display mt4 mb20">Registered device</div>
        <div className="card center col tc" style={{ padding: '30px 20px', marginBottom: 18 }}>
          <div style={{ width: 88, height: 88, borderRadius: 26, background: 'linear-gradient(150deg,#fff,#EEF1F8)', boxShadow: 'var(--sh-1)', display: 'grid', placeItems: 'center' }}>
            <Icon name="device" size={44} style={{ color: 'var(--blue)' }} />
          </div>
          <div className="h3 mt16">{u.deviceModel}</div>
          <Badge tone="green" dot="green" style={{ marginTop: 8 }}>Registered & linked</Badge>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {rows.map(([ic, tone, l, v], i) => (
            <div key={i} className="rowflex gap14" style={{ padding: '14px 16px', boxShadow: i ? 'inset 0 1px 0 var(--line-2)' : 'none' }}>
              <Tile tone={tone} icon={ic} size={36} iconSize={19} />
              <div className="grow body-strong" style={{ fontSize: 15.5 }}>{l}</div>
              <span className="foot tnum">{v}</span>
            </div>
          ))}
        </div>
        <div className="foot mt16 tc" style={{ lineHeight: 1.5 }}>Your device ID stays stable across sign-ins so teachers can keep your seat linked.</div>
      </div>
    </div>
  );
}

function NotificationsScreen({ app }) {
  const list = app.data.notifications;
  const icons = { session: 'nfc', focus: 'shield', attendance: 'check-circle', ended: 'unlock' };
  const tones = { blue: ['tile-blue', 'var(--blue)'], green: ['tile-green', 'var(--green)'], gray: ['tile-blue', 'var(--ink-4)'] };
  return (
    <div className="screen push-enter" style={{ background: 'var(--bg)' }}>
      <div className="topbar">
        <button className="icon-btn" onClick={() => app.back()}><Icon name="chevron-left" size={20} /></button>
        <div className="grow" />
        <button className="icon-btn" style={{ width: 'auto', padding: '0 14px', borderRadius: 9999, fontSize: 13, fontWeight: 600, gap: 6 }} onClick={() => app.markAllRead()}>Mark read</button>
      </div>
      <div className="screen-scroll no-tab" style={{ paddingTop: 100 }}>
        <Eyebrow muted>Activity</Eyebrow>
        <div className="h-display mt4 mb20">Notifications</div>
        <div className="col gap10">
          {list.map(n => (
            <div key={n.id} className="card card-pad rowflex gap14" style={{ position: 'relative', boxShadow: n.unread ? '0 0 0 1.5px var(--blue-tint-2), var(--sh-1)' : 'var(--sh-1)' }}>
              <Tile tone={n.tone === 'green' ? 'green' : n.tone === 'gray' ? 'blue' : 'blue'} icon={icons[n.kind]} />
              <div className="grow">
                <div className="rowflex between"><div className="body-strong">{n.title}</div><span className="foot">{n.time}</span></div>
                <div className="foot mt4">{n.body}</div>
              </div>
              {n.unread && <span style={{ position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)' }} />}
            </div>
          ))}
        </div>
        <div className="tc foot mt24">You’re all caught up.</div>
      </div>
    </div>
  );
}

Object.assign(window, { ProfileScreen, SettingsScreen, NotificationsScreen, DeviceInfoScreen });

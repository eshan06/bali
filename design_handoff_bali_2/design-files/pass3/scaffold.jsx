// Bali — Pass 3 scaffold: sheet + frame + FC React helpers.
// Load AFTER React, lucide, ios-frame.jsx. Exports to window at the bottom.

function Icon({ name, size = 18, color, style = {} }) {
  return (
    <i
      data-lucide={name}
      style={{ width: size, height: size, color, display: "inline-flex", flex: "none", ...style }}
    ></i>
  );
}

function Arc({ size = 240, stroke = 10, pct = 0.47, fill = "var(--arc-fill)", track = "var(--arc-track)", children, style = {} }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="fc-arc" style={{ width: size, height: size, ...style }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke}></circle>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fill} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c * (1 - pct)}`}></circle>
      </svg>
      {children && <div className="stack">{children}</div>}
    </div>
  );
}

const STATE_ICONS = {
  notjoined: "circle", focused: "circle-check", pass: "ticket",
  emergency: "lock-open", revoked: "shield-off", nodevice: "smartphone", ended: "flag",
};

function Chip({ state, size = "mini", name, label, stale, extra = "", noicon }) {
  return (
    <span className={`fc-chip fc-chip--${size} is-${state} ${extra}`}>
      {!noicon && <Icon name={STATE_ICONS[state]} size={size === "grid" ? 18 : 13} />}
      {name ? name + " " : ""}
      <span className="lbl">{label}</span>
      {stale && <span className="stale">{stale}</span>}
    </span>
  );
}

function Unlock({ fill = 0, label = "Hold to unlock — your teacher will be notified", hint = "Works without Wi-Fi. Releasing early does nothing.", width = 353 }) {
  return (
    <div className="vstack" style={{ gap: 10, width: "100%" }}>
      <div className="fc-unlock" style={{ height: 64 }}>
        <span className="base-label" style={{ whiteSpace: "normal", textAlign: "center", fontSize: 15, lineHeight: "20px", maxWidth: 300 }}><Icon name="lock-open" size={18} />{label}</span>
        <span className="fill" style={{ width: fill + "%" }}>
          <span className="fill-label" style={{ width, whiteSpace: "normal", textAlign: "center", fontSize: 15, lineHeight: "20px" }}><Icon name="lock-open" size={18} />{label}</span>
        </span>
      </div>
      {hint && <span className="fc-holdhint">{hint}</span>}
    </div>
  );
}

const POLICY_APPS = [
  ["phone", "Phone"], ["message-circle", "Messages"], ["notebook-pen", "Notes"],
  ["camera", "Camera"], ["calculator", "Calculator"],
];
function AppsRow({ apps = POLICY_APPS, size = 48 }) {
  return (
    <div className="fc-apps" style={{ justifyContent: "center" }}>
      {apps.map(([ic, label]) => (
        <div className="app" key={label}>
          <div className="ic" style={{ width: size, height: size }}><Icon name={ic} size={21} /></div>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function BigButton({ children, kind = "primary", style = {} }) {
  return <div className={`fc-btn fc-btn--${kind} fc-btn--lg`} style={{ borderRadius: 14, ...style }}>{children}</div>;
}

function Frame({ label, sub, note, dark = true, title, keyboard, children, w = 393, h = 852, light, time = "10:22" }) {
  const isDark = light ? false : dark;
  return (
    <div className="frame-cell" style={{ width: w }}>
      <div className="frame-label">{label}{sub && <small>{sub}</small>}</div>
      <IOSDevice width={w} height={h} dark={isDark} title={title} keyboard={keyboard} time={time}>
        <div className="scr" data-theme={isDark ? "dark" : null}>{children}</div>
      </IOSDevice>
      {note && <div className="frame-note">{note}</div>}
    </div>
  );
}

function Sheet({ num, title, intro, here, children }) {
  const PAGES = [
    ["S1", "pass3/S1 Onboarding.html"], ["S2", "pass3/S2 Join Class.html"],
    ["S3", "pass3/S3 Home.html"], ["S4", "pass3/S4 Tap-In.html"],
    ["S5", "pass3/S5 Policy Setup.html"], ["S6", "pass3/S6 Focus Active.html"],
    ["S7–S9", "pass3/S7-S9 Sheet History Settings.html"], ["S10", "pass3/S10 Shield.html"],
    ["T1–T2", "pass3/T1-T2 Teacher Home Live.html"], ["T3–T5", "pass3/T3-T5 Teacher Detail Tags.html"],
  ];
  return (
    <div className="sheet">
      <header className="masthead">
        <div className="kicker">
          <svg className="arc-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" stroke="var(--stone-200)" strokeWidth="3"></circle>
            <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="var(--green-600)" strokeWidth="3" strokeLinecap="round"></path>
          </svg>
          Bali · Pass 3 of 4 · iOS
        </div>
        <h1>{num} · {title}</h1>
        <p>{intro}</p>
        <nav className="crumbs">
          {PAGES.map(([l, href]) => (
            <a key={l} className={l === here ? "here" : ""} href={"../" + href}>{l}</a>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

function mountSheet(App) {
  const root = ReactDOM.createRoot(document.getElementById("root"));
  root.render(<App />);
  // lucide swap after paint (static mockups — no re-render afterwards)
  const tick = () => {
    if (window.lucide && document.querySelector("[data-lucide]")) {
      lucide.createIcons({ attrs: { "stroke-width": 1.75 } });
    }
  };
  setTimeout(tick, 50); setTimeout(tick, 350); setTimeout(tick, 900);
}

Object.assign(window, {
  Icon, Arc, Chip, Unlock, AppsRow, BigButton, Frame, Sheet, mountSheet,
  STATE_ICONS, POLICY_APPS,
});

// Bali — Pass 5 scaffold: addendum sheet chrome + shared teacher pieces.
// Load AFTER React, lucide, ios-frame.jsx, scaffold.jsx. Exports to window at the bottom.

function Sheet5({ num, title, intro, here, children }) {
  const PAGES = [
    ["T1 rev", "T1 Teacher Home rev.html", true],
    ["T6", "T6 Class Detail.html", true],
    ["T9–T10", "T9-T10 Start Session Recap.html", true],
    ["T7–T8", "T7-T8 Roster Policies.html", true],
    ["T12", "T12 Create Class.html", true],
    ["T3 rev", "T3 Student Detail rev.html", true],
  ];
  return (
    <div className="sheet">
      <header className="masthead">
        <div className="kicker">
          <svg className="arc-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" stroke="var(--stone-200)" strokeWidth="3"></circle>
            <path d="M 10 2.5 A 7.5 7.5 0 1 1 3.5 13.75" stroke="var(--green-600)" strokeWidth="3" strokeLinecap="round"></path>
          </svg>
          Bali · Teacher iOS Addendum · full-control
        </div>
        <h1>{num} · {title}</h1>
        <p>{intro}</p>
        <nav className="crumbs">
          <a href="../pass3/T1-T2 Teacher Home Live.html">Brief T1–T2</a>
          <a href="../pass3/T3-T5 Teacher Detail Tags.html">Brief T3–T5</a>
          {PAGES.map(([l, href, built]) =>
            built
              ? <a key={l} className={l === here ? "here" : ""} href={href}>{l}</a>
              : <a key={l} style={{ opacity: 0.45, pointerEvents: "none" }} title="next in the working order">{l}</a>
          )}
        </nav>
      </header>
      {children}
    </div>
  );
}

/* uppercase section label used across teacher list screens */
function SectionLabel({ children, style = {} }) {
  return (
    <div className="t-footnote ter" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600, ...style }}>
      {children}
    </div>
  );
}

/* white grouped card */
function Card5({ children, style = {} }) {
  return <div style={{ background: "var(--surface-card)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow-1)", ...style }}>{children}</div>;
}

function LiveDot() {
  return <span className="live-dot"></span>;
}

/* §6 summary chips — the 28-student distribution, mini scale */
function SummaryChips({ style = {} }) {
  return (
    <div className="hstack" style={{ gap: 5, flexWrap: "wrap", ...style }}>
      <Chip state="focused" label="22" />
      <Chip state="notjoined" label="2" />
      <Chip state="pass" label="1" />
      <Chip state="emergency" label="1" />
      <Chip state="revoked" label="1" />
      <Chip state="nodevice" label="1" />
    </div>
  );
}

Object.assign(window, { Sheet5, SectionLabel, Card5, LiveDot, SummaryChips });

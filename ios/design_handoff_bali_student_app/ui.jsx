// ui.jsx — shared icons + primitives for the bali student app
// Exports to window: Icon, Eyebrow, Btn, Badge, Tile, Logo, NfcMark, FocusMark

const I = (p, path) => (
  <svg viewBox="0 0 24 24" width={p.size || 24} height={p.size || 24} fill="none"
       stroke={p.fill ? 'none' : 'currentColor'} strokeWidth={p.sw || 1.9}
       strokeLinecap="round" strokeLinejoin="round" style={p.style}>{path}</svg>
);

function Icon({ name, size = 24, sw, fill, style }) {
  const p = { size, sw, fill, style };
  switch (name) {
    case 'home': return I(p, <><path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/><path d="M10 20v-5h4v5"/></>);
    case 'classes': return I(p, <><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></>);
    case 'focus': return I(p, <><path d="M12 3c2.5 2 5 3 8 3 0 7-3 11-8 13C7 17 4 13 4 6c3 0 5.5-1 8-3Z"/><path d="m9 11.5 2 2 4-4.5"/></>);
    case 'profile': return I(p, <><circle cx="12" cy="8" r="4"/><path d="M4.5 20c.7-3.7 3.8-6 7.5-6s6.8 2.3 7.5 6"/></>);
    case 'bell': return I(p, <><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 19a2 2 0 0 0 4 0"/></>);
    case 'nfc': return I(p, <><path d="M5.5 8.5c-1.2 1-2 2.4-2 3.5s.8 2.5 2 3.5"/><path d="M8.5 6c-2 1.4-3.3 3.6-3.3 6s1.3 4.6 3.3 6"/><path d="M15.5 18c2-1.4 3.3-3.6 3.3-6s-1.3-4.6-3.3-6"/><path d="M18.5 15.5c1.2-1 2-2.4 2-3.5s-.8-2.5-2-3.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></>);
    case 'lock': return I(p, <><rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></>);
    case 'unlock': return I(p, <><rect x="5" y="10.5" width="14" height="10" rx="2.4"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7"/></>);
    case 'check': return I(p, <path d="m5 12.5 4.5 4.5L19 7"/>);
    case 'check-circle': return I(p, <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16 9"/></>);
    case 'x': return I(p, <path d="M6 6l12 12M18 6 6 18"/>);
    case 'x-circle': return I(p, <><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></>);
    case 'chevron': return I(p, <path d="m9 5 7 7-7 7"/>);
    case 'chevron-left': return I(p, <path d="m15 5-7 7 7 7"/>);
    case 'chevron-down': return I(p, <path d="m5 9 7 7 7-7"/>);
    case 'plus': return I(p, <path d="M12 5v14M5 12h14"/>);
    case 'qr': return I(p, <><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M20 14v6M14 20h2M18 18h2"/></>);
    case 'link': return I(p, <><path d="M10 14a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7L11 7.3"/><path d="M14 10a4 4 0 0 0-5.7 0L6 12.3a4 4 0 0 0 5.7 5.7L13 16.7"/></>);
    case 'scan': return I(p, <><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M4 12h16"/></>);
    case 'clock': return I(p, <><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></>);
    case 'calendar': return I(p, <><rect x="4" y="5" width="16" height="16" rx="2.4"/><path d="M4 9.5h16M8 3v4M16 3v4"/></>);
    case 'phone': return I(p, <path d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z"/>);
    case 'message': return I(p, <path d="M4 5.5h16a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4 3.5V17H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1Z"/>);
    case 'camera': return I(p, <><path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2l1.2-2h7.6L17 7h2a1.5 1.5 0 0 1 1.5 1.5V18A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18Z"/><circle cx="12" cy="13" r="3.2"/></>);
    case 'map': return I(p, <><path d="m9 4 6 2 5-2v14l-5 2-6-2-5 2V6Z"/><path d="M9 4v14M15 6v14"/></>);
    case 'shield': return I(p, <path d="M12 3c2.5 2 5 3 8 3 0 7-3 11-8 13C7 17 4 13 4 6c3 0 5.5-1 8-3Z"/>);
    case 'sparkle': return I(p, <path d="M12 3.5 13.7 9 19 10.7 13.7 12.4 12 18l-1.7-5.6L5 10.7 10.3 9Z" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'}/>);
    case 'device': return I(p, <><rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 18h2"/></>);
    case 'school': return I(p, <><path d="m12 4 9 4-9 4-9-4 9-4Z"/><path d="M6 10v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/></>);
    case 'info': return I(p, <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></>);
    case 'gear': return I(p, <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/></>);
    case 'signout': return I(p, <><path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8"/><path d="m18 8 4 4-4 4M22 12H10"/></>);
    case 'mail': return I(p, <><rect x="3.5" y="5.5" width="17" height="13" rx="2.2"/><path d="m4 7 8 5.5L20 7"/></>);
    case 'eye': return I(p, <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.6"/></>);
    case 'play': return I(p, <path d="M8 5.5v13l11-6.5Z" fill="currentColor" stroke="none"/>);
    case 'stop': return I(p, <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" stroke="none"/>);
    case 'alert': return I(p, <><path d="M12 4 2.8 19.5h18.4Z"/><path d="M12 10v4M12 17h.01"/></>);
    case 'wifi': return I(p, <><path d="M2.5 9a14 14 0 0 1 19 0M6 12.5a9 9 0 0 1 12 0M9.5 16a4 4 0 0 1 5 0"/><circle cx="12" cy="19" r="0.6" fill="currentColor" stroke="none"/></>);
    case 'arrow-right': return I(p, <path d="M5 12h14M13 6l6 6-6 6"/>);
    case 'arrow-up': return I(p, <path d="M12 19V5M6 11l6-6 6 6"/>);
    case 'flame': return I(p, <path d="M12 3c1 3 4 4 4 8a4 4 0 0 1-8 0c0-1.2.4-2 1-2.5C9 11 12 9 12 3Z"/>);
    case 'grid-apps': return I(p, <><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></>);
    case 'pencil': return I(p, <path d="M4 20h4L19 9l-4-4L4 16Z"/>);
    case 'moon': return I(p, <path d="M20 13.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 13.5Z"/>);
    case 'hand': return I(p, <path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7-2.5 0-4-1-5.5-3l-2.5-4a1.6 1.6 0 0 1 2.7-1.6L8 13"/>);
    default: return I(p, <circle cx="12" cy="12" r="8"/>);
  }
}

function Eyebrow({ children, muted, style }) {
  return <div className={'eyebrow' + (muted ? ' muted' : '')} style={style}>{children}</div>;
}

function Btn({ kind = 'primary', size, block, icon, iconRight, onClick, disabled, children, style }) {
  const cls = ['btn', 'btn-' + kind];
  if (size) cls.push('btn-' + size);
  if (block) cls.push('btn-block');
  return (
    <button className={cls.join(' ')} onClick={onClick} disabled={disabled} style={style}>
      {icon && <Icon name={icon} size={size === 'sm' ? 17 : 19} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 17 : 19} />}
    </button>
  );
}

function Badge({ tone = 'gray', dot, children, style }) {
  return (
    <span className={'badge b-' + tone} style={style}>
      {dot && <span className={'dot dot-' + dot} />}
      {children}
    </span>
  );
}

function Tile({ tone = 'blue', icon, size = 44, iconSize = 22, style, children }) {
  return (
    <div className={'tile tile-' + tone} style={{ width: size, height: size, ...style }}>
      {icon ? <Icon name={icon} size={iconSize} /> : children}
    </div>
  );
}

// bali wordmark
function Logo({ size = 30, color = 'var(--ink)' }) {
  return <span style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.04em', color }}>bali</span>;
}

// NFC block mark — the physical tag motif
function NfcMark({ size = 120, glow = true, color = 'var(--blue)' }) {
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {glow && <div style={{ position: 'absolute', inset: -size * 0.18, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(46,92,255,0.28), transparent 70%)' }} />}
      <div style={{
        position: 'relative', width: size, height: size, borderRadius: size * 0.28,
        background: 'linear-gradient(150deg, #335CFF, #1E3FCC)',
        display: 'grid', placeItems: 'center',
        boxShadow: '0 18px 40px rgba(46,92,255,0.4), inset 0 1px 0 rgba(255,255,255,0.3)',
      }}>
        <Icon name="nfc" size={size * 0.5} sw={1.7} style={{ color: '#fff' }} />
      </div>
    </div>
  );
}

Object.assign(window, { Icon, Eyebrow, Btn, Badge, Tile, Logo, NfcMark });

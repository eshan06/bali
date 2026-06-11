// data.jsx — mock data for the bali student app
// Exports to window: BALI_DATA, APP_CATALOG, POLICIES

// generic (non-branded) app catalog — colored tiles + glyph
const APP_CATALOG = [
  { id: 'chatter',  name: 'Chatter',   cat: 'social', color: '#FF5A7A', glyph: '◓' },
  { id: 'glimpse',  name: 'Glimpse',   cat: 'social', color: '#9B5CFF', glyph: '◉' },
  { id: 'pulse',    name: 'Pulse',     cat: 'social', color: '#FF8A3D', glyph: '✦' },
  { id: 'loop',     name: 'Loop',      cat: 'social', color: '#1FB6C9', glyph: '∞' },
  { id: 'streamly', name: 'Streamly',  cat: 'video',  color: '#E8453C', glyph: '▶' },
  { id: 'tapquest', name: 'Tap Quest', cat: 'games',  color: '#16B364', glyph: '◆' },
  { id: 'blockrush',name: 'Block Rush',cat: 'games',  color: '#6366F1', glyph: '▣' },
  // essentials (allow-listed)
  { id: 'phone',    name: 'Phone',     cat: 'essential', color: '#34C759', icon: 'phone' },
  { id: 'messages', name: 'Messages',  cat: 'essential', color: '#34C759', icon: 'message' },
  { id: 'camera',   name: 'Camera',    cat: 'essential', color: '#3A3A3C', icon: 'camera' },
  { id: 'maps',     name: 'Maps',      cat: 'essential', color: '#5AC8FA', icon: 'map' },
  { id: 'calc',     name: 'Calculator',cat: 'tool', color: '#1C1C1E', glyph: '=' },
  { id: 'notes',    name: 'Notes',     cat: 'tool', color: '#FFCC4D', glyph: '≡' },
  { id: 'books',    name: 'Reader',    cat: 'tool', color: '#FF7043', glyph: '❧' },
  { id: 'clock',    name: 'Clock',     cat: 'tool', color: '#0A0A0A', icon: 'clock' },
];

const appById = (id) => APP_CATALOG.find(a => a.id === id);

const POLICIES = {
  full:   { id: 'full',   name: 'Full Focus',      desc: 'Only class essentials. Everything else paused.',
            blocks: ['chatter','glimpse','pulse','loop','streamly','tapquest','blockrush'],
            allows: ['phone','messages','camera','calc','notes','clock'] },
  social: { id: 'social', name: 'No Social Media',  desc: 'Social apps paused. The rest stays open.',
            blocks: ['chatter','glimpse','pulse','loop'],
            allows: ['phone','messages','camera','maps','calc','notes','books','clock','streamly'] },
  games:  { id: 'games',  name: 'No Games',         desc: 'Games paused so you can stay on task.',
            blocks: ['tapquest','blockrush'],
            allows: ['phone','messages','camera','maps','calc','notes','books','clock'] },
};

const BALI_DATA = {
  user: {
    firstName: 'Maya', lastName: 'Chen', grade: 11,
    email: 'maya.chen@lincoln.edu',
    deviceId: 'BALI-7F3A-22C9',
    deviceModel: 'iPhone 15',
    deviceRegistered: true,
    deviceAssigned: true,        // teacher has linked this phone
    permissionsGranted: true,    // Screen Time / focus blocking
    streak: 14,
    school: 'Lincoln High School',
  },

  classes: [
    {
      id: 'bio', name: 'AP Biology', teacher: 'Mr. Okafor', period: 'Period 1',
      school: 'Lincoln High', color: '#2E5CFF', policy: 'full',
      attendance: 96, present: 41, total: 43,
      device: { assigned: true, name: 'iPhone 15', id: 'BALI-7F3A-22C9' },
      session: {                 // LIVE session — the hero state
        active: true, startedAt: '9:02 AM', endsAt: '9:52 AM',
        blockName: 'Lab Bench 3', late: false,
      },
      recent: [
        { date: 'Yesterday', status: 'present', time: '9:01 AM' },
        { date: 'Wed', status: 'present', time: '9:00 AM' },
        { date: 'Tue', status: 'late', time: '9:07 AM' },
        { date: 'Mon', status: 'present', time: '8:59 AM' },
      ],
    },
    {
      id: 'hist', name: 'World History', teacher: 'Ms. Reyes', period: 'Period 3',
      school: 'Lincoln High', color: '#7C5CFF', policy: 'social',
      attendance: 88, present: 37, total: 42,
      device: { assigned: true, name: 'iPhone 15', id: 'BALI-7F3A-22C9' },
      session: { active: false, nextAt: '11:15 AM' },
      recent: [
        { date: 'Yesterday', status: 'present', time: '11:14 AM' },
        { date: 'Wed', status: 'absent', time: null },
        { date: 'Mon', status: 'present', time: '11:13 AM' },
      ],
    },
    {
      id: 'alg', name: 'Algebra II', teacher: 'Mr. Stein', period: 'Period 5',
      school: 'Lincoln High', color: '#15A974', policy: 'games',
      attendance: 92, present: 39, total: 42,
      device: { assigned: true, name: 'iPhone 15', id: 'BALI-7F3A-22C9' },
      session: { active: false, nextAt: '1:30 PM' },
      recent: [
        { date: 'Yesterday', status: 'present', time: '1:29 PM' },
        { date: 'Thu', status: 'present', time: '1:30 PM' },
      ],
    },
  ],

  invites: [
    { id: 'chem', name: 'AP Chemistry', teacher: 'Dr. Patel', period: 'Period 2', school: 'Lincoln High', color: '#E08A12' },
  ],

  notifications: [
    { id: 'n1', kind: 'session', title: 'AP Biology started', body: 'Tap your Bali block to check in.', time: 'now', unread: true, tone: 'blue' },
    { id: 'n2', kind: 'focus', title: 'Focus Mode is active', body: 'Apps unlock when Mr. Okafor ends the session.', time: '2m', unread: true, tone: 'blue' },
    { id: 'n3', kind: 'attendance', title: 'Checked in on time', body: 'World History · 11:14 AM yesterday', time: '1d', unread: false, tone: 'green' },
    { id: 'n4', kind: 'ended', title: 'Apps are available again', body: 'Algebra II session ended.', time: '1d', unread: false, tone: 'gray' },
  ],
};

Object.assign(window, { BALI_DATA, APP_CATALOG, POLICIES, appById });

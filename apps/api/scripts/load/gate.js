/* global __ENV, crypto, open */
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';

/*
 * The one-address load gate (Phase 4, L2b; ISSUES #1): `load:serve`'s school at the bell, from one
 * address. The 600 tap within the minute before it, so each waits; each teacher's Start joins
 * their 30 at the bell, and every class starts, for `load:sweep` to end all 30. Each phone then
 * reads the truth every 30 s (decision 7): `GET /v1/me` while it waits, a check-in once joined.
 * Five of the classes follow a live lesson (Phase 7, L4b): their teacher asks a question once the
 * Start has joined them, and each student follows it on a phone and a laptop, each polling the
 * presentation every 2 s beside the check-ins; each phone answers it once.
 * Meanwhile one account asks `GET /v1/me` 50 times a second. Thresholds below; why: DECISIONS.
 */

const SCHOOL_FILE = __ENV.LOAD_SCHOOL_FILE || './school.json';
const API = __ENV.API_URL || 'http://127.0.0.1:3001';
/** The school's one address, as Railway's edge reports it (`X-Real-IP`, L1). */
const SCHOOL_ADDRESS = '203.0.113.7';
/**
 * In seconds from the doors opening: the taps before 55, the Starts at 60, the reads to 180. Two
 * margins are spent on purpose: 5 s so every tap lands before its Start (else it joins, and the
 * check fails), and ~60 s after a phone's last read for the API to stop before its own minute
 * sweep marks that phone silent (else `load:sweep` refuses the bell). CI stops it at once.
 */
const TAPS_BEFORE = 55;
const BELL = 60;
const CADENCE = 30;
const END = 180;
const LESSON = { durationMinutes: 50 };
const P95_MS = 500;
/** A Start joins its 30 in one transaction, the bell's 30 Starts sharing 10 connections. */
const START_P95_MS = 1000;
/** The flood: one account at 50 a second for a minute, against its budget (`BUDGETS.account`). */
const FLOOD_RATE = 50;
const FLOOD_SECONDS = 60;
const ACCOUNT_BURST = 120;
const ACCOUNT_PER_SECOND = 2;
/** The most `200`s that budget allows the flood, plus a few for requests in flight at the end. */
const FLOOD_ANSWERED_MAX = ACCOUNT_BURST + ACCOUNT_PER_SECOND * FLOOD_SECONDS + 5;
/**
 * The live lesson: the first 5 teachers' classes, each device opening it within 30 s of the bell,
 * as a phone learns of its session at its next 30 s read, and polling every 2 s to the end. None
 * in the bell's first 5 s, while the Starts hold the database's 10 connections: there the devices'
 * first reads pushed the Starts' p95 toward its 1 s (DECISIONS, W1). A student's two devices spend
 * 60 a minute of their account's 120, beside the check-ins' 2, so not one of their requests may be
 * refused.
 */
const LESSON_CLASSES = 5;
const OPEN_AFTER = 5;
const OPEN_WITHIN = 30;
const POLL = 2;
/** The fewest polls a device makes, opening the lesson at the latest, less a few in hand. */
const DEVICE_POLLS = Math.floor((END - BELL - OPEN_WITHIN) / POLL) - 5;

const school = (key) => new SharedArray(key, () => [JSON.parse(open(SCHOOL_FILE))[key]].flat());
const students = school('students');
const teachers = school('teachers');
const flooder = school('flooder')[0];
/** The live lesson's students, each a phone and a laptop following it. */
const followers = new SharedArray('followers', () => {
  const { teachers: all, students: everyone } = JSON.parse(open(SCHOOL_FILE));
  const following = new Set(all.slice(0, LESSON_CLASSES).map((t) => t.classId));
  return everyone.filter((s) => following.has(s.classId));
});
const classSize = {};
for (const s of students) classSize[s.classId] = (classSize[s.classId] || 0) + 1;
const classes = teachers.length + [...teachers].filter((t) => t.secondClassId).length;

export const options = {
  scenarios: {
    phones: {
      executor: 'per-vu-iterations',
      exec: 'phone',
      vus: students.length,
      iterations: 1,
      maxDuration: `${END + 60}s`,
      tags: { who: 'school' },
    },
    teachers: {
      executor: 'per-vu-iterations',
      exec: 'teacher',
      vus: teachers.length,
      iterations: 1,
      startTime: `${BELL}s`,
      tags: { who: 'school' },
    },
    devices: {
      executor: 'per-vu-iterations',
      exec: 'device',
      vus: followers.length * 2,
      iterations: 1,
      maxDuration: `${END + 60}s`,
      tags: { who: 'school' },
    },
    flood: {
      executor: 'constant-arrival-rate',
      exec: 'flood',
      rate: FLOOD_RATE,
      duration: `${FLOOD_SECONDS}s`,
      startTime: '30s',
      preAllocatedVUs: 10,
      // Room for a slow answer (a second each); past it k6 drops iterations, which fails below.
      maxVUs: FLOOD_RATE,
      tags: { who: 'flooder' },
    },
  },
  thresholds: {
    // The school: every request a 2xx, so no 429 and no 5xx, quickly; every tap and Start made.
    'http_req_failed{who:school}': ['rate==0'],
    'http_reqs{who:school,status:429}': ['count==0'],
    'http_req_duration{who:school}': [`p(95)<${P95_MS}`],
    'checks{who:school}': ['rate==1'],
    'http_reqs{kind:tap}': [`count==${students.length}`],
    'http_reqs{kind:start}': [`count==${classes}`],
    // Each kind's p95 too, which the summary then shows.
    'http_req_duration{kind:tap}': [`p(95)<${P95_MS}`],
    'http_req_duration{kind:start}': [`p(95)<${START_P95_MS}`],
    'http_req_duration{kind:me}': [`p(95)<${P95_MS}`],
    'http_req_duration{kind:checkin}': [`p(95)<${P95_MS}`],
    'http_req_duration{kind:poll}': [`p(95)<${P95_MS}`],
    'http_req_duration{kind:answer}': [`p(95)<${P95_MS}`],
    // The live lesson's are the school's, so none refused; and each class asked, each phone
    // answered once, every device polling to the end.
    'http_reqs{kind:ask}': [`count==${LESSON_CLASSES}`],
    'http_reqs{kind:answer}': [`count==${followers.length}`],
    'http_reqs{kind:poll}': [`count>=${followers.length * 2 * DEVICE_POLLS}`],
    // The flood: stopped by its own budget, every refusal a 429 with a Retry-After. No more
    // answered than the budget allows, so a raised budget fails; and every request sent, so a
    // slow API can't thin the flood into passing (no scenario may drop one).
    'http_reqs{who:flooder,status:429}': ['count>0'],
    'http_reqs{who:flooder,status:200}': [`count<=${FLOOD_ANSWERED_MAX}`],
    dropped_iterations: ['count==0'],
    'checks{who:flooder}': ['rate==1'],
  },
};

function request(kind, method, path, token, body = null, extra = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'X-Real-IP': SCHOOL_ADDRESS, ...extra };
  if (body !== null) headers['Content-Type'] = 'application/json';
  const payload = body === null ? null : JSON.stringify(body);
  return http.request(method, `${API}${path}`, payload, { headers, tags: { kind } });
}

/** A UUIDv7, as the phone mints its event ids: the time in its first 48 bits. */
function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5, ms = Date.now(); i >= 0; i -= 1, ms = Math.floor(ms / 256)) bytes[i] = ms % 256;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

const elapsed = () => (Date.now() - exec.scenario.startTime) / 1000;
const until = (s) => sleep(Math.max(0, s - elapsed()));
const deviceTime = () => new Date().toISOString();

/** A student: the tap, then the truth every 30 s, `GET /v1/me` until the Start joins them. */
export function phone() {
  const s = students[exec.scenario.iterationInTest];
  until(Math.random() * TAPS_BEFORE);
  const tap = { tagId: s.tagId, eventId: uuidv7(), deviceTime: deviceTime() };
  check(request('tap', 'POST', '/v1/taps', s.token, tap), {
    'a tap before the bell waits': (r) => r.status === 200 && r.json('outcome') === 'armed',
  });

  let session = null;
  for (let at = elapsed() + CADENCE; at < END; at += CADENCE) {
    until(at);
    if (session === null) {
      const me = request('me', 'GET', '/v1/me', s.token);
      check(me, { 'the truth is read': (r) => r.status === 200 });
      const ownClass = me.status === 200 && me.json('session.classId') === s.classId;
      session = ownClass ? me.json('session.id') : null;
    } else {
      const checkin = { deviceTime: deviceTime() };
      check(request('checkin', 'POST', `/v1/sessions/${session}/checkin`, s.token, checkin), {
        'a check-in finds the phone focused': (r) =>
          r.status === 200 && r.json('state') === 'focused',
      });
    }
  }
  check(session, { 'the Start joined them to their class': (id) => id !== null });
}

/**
 * A teacher at the bell: Start, which joins everyone waiting, and a live lesson's question; then
 * their second class.
 */
export function teacher() {
  const i = exec.scenario.iterationInTest;
  const t = teachers[i];
  sleep(Math.random() * 2);
  const start = (id) => request('start', 'POST', `/v1/classes/${id}/sessions`, t.token, LESSON);
  const joins = (n) => (r) =>
    r.status === 200 && r.json('outcome') === 'created' && r.json('armedConverted') === n;
  const bell = start(t.classId);
  check(bell, { 'the Start joins everyone waiting': joins(classSize[t.classId]) });
  if (i < LESSON_CLASSES) {
    const question = { eventId: uuidv7(), prompt: 'Which is prime?', options: ['4', '6', '7'] };
    const path = `/v1/sessions/${bell.json('session.id')}/questions`;
    check(request('ask', 'POST', path, t.token, question), {
      'the question opens': (r) => r.status === 200 && r.json('outcome') === 'opened',
    });
  }
  if (t.secondClassId)
    check(start(t.secondClassId), { 'a class no one waits for starts': joins(0) });
}

/**
 * A live lesson's phone or laptop: it opens the lesson between `OPEN_AFTER` and `OPEN_WITHIN` s
 * after the bell, finds its class's running session as the student's home does, in `GET /v1/me`,
 * and polls the presentation every 2 s with the ETag it last got, as the phone and the student web
 * do. The phone answers the question once it shows.
 */
export function device() {
  const i = exec.scenario.iterationInTest;
  const s = followers[Math.floor(i / 2)];
  const isPhone = i % 2 === 0;
  until(BELL + OPEN_AFTER + Math.random() * (OPEN_WITHIN - OPEN_AFTER));

  let session = null;
  for (let at = elapsed(); session === null && at < END; at += POLL) {
    until(at);
    const me = request('me', 'GET', '/v1/me', s.token);
    check(me, { 'the truth is read': (r) => r.status === 200 });
    const own = me.status === 200 && me.json('classes').find((c) => c.id === s.classId);
    session = own && own.liveSession ? own.liveSession.id : null;
  }
  check(session, { 'a device finds its class in session': (id) => id !== null });

  let etag = null;
  let answered = false;
  for (let at = elapsed(); session !== null && at < END; at += POLL) {
    until(at);
    const sent = etag === null ? {} : { 'If-None-Match': etag };
    const r = request('poll', 'GET', `/v1/sessions/${session}/presentation`, s.token, null, sent);
    check(r, {
      'a poll shows the lesson under its ETag, or 304 while it is unchanged': (res) =>
        (res.status === 200 && res.json('running') === true && Boolean(res.headers.Etag)) ||
        (res.status === 304 && etag !== null),
    });
    if (r.status !== 200) continue;
    etag = r.headers.Etag;
    const question = r.json('question');
    if (isPhone && !answered && question !== null && question.open && question.answer === null) {
      answered = true;
      const pick = {
        eventId: uuidv7(),
        option: Math.floor(Math.random() * question.options.length),
      };
      check(request('answer', 'POST', `/v1/questions/${question.id}/answers`, s.token, pick), {
        'an answer counts': (res) => res.status === 200 && res.json('outcome') === 'answered',
      });
    }
  }
  if (isPhone) check(answered, { 'each phone answers the question': (a) => a });
}

/** The flooder: one account's `GET /v1/me`, answered or refused with when to try again. */
export function flood() {
  check(request('flood', 'GET', '/v1/me', flooder.token), {
    'answered, or refused saying when to retry': (r) =>
      r.status === 200 || (r.status === 429 && Number(r.headers['Retry-After']) > 0),
  });
}

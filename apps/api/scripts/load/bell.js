/* global __ENV, crypto, open, setTimeout */
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';

/*
 * The bell with the class-started push (#336): a measurement, run by hand and never on a PR
 * (load-gate.yml's `bell` input), where no threshold can fail and k6's summary shows each kind's
 * numbers. `load:serve`'s school, the gate's 600 or a larger one (LOAD_TEACHERS): every student taps
 * before the bell, so each waits, and each teacher's Start at it joins their 30. The push
 * (ARCHITECTURE, "Push: a doorbell for students") then rings those 30, once the Start has committed,
 * and each phone opens Bali within ARRIVAL_WINDOW seconds of its Start's answer: the engine's read on
 * coming to the front, `GET /v1/me` (`kind:open`), then a check-in every 30 s from there, in step with
 * the phones that opened with it. A window of 30 s is no push: a phone waiting in front finds the
 * Start at its next 30 s read. FIRST_READ=light makes that first read the age check's, one query, as
 * low as a lighter first read could go. Six classes follow a live lesson, as the gate's six do: their
 * teacher asks and shows a slide after the Start, each phone polls the lesson every 2 s once open, as
 * the phone's card will (L8), and answers once; each laptop, which no push reaches, opens it within
 * 30 s, at the student web's 30 s read, and polls too. The model and the numbers: docs/DECISIONS.md
 * (2026-10-22, #336).
 */

const SCHOOL_FILE = __ENV.LOAD_SCHOOL_FILE || './school.json';
const API = __ENV.API_URL || 'http://127.0.0.1:3001';
/** The school's one address, as the gate's. */
const SCHOOL_ADDRESS = '203.0.113.7';
/** In seconds: the taps before 25, the Starts from the bell at 30, every device stopping 75 after. */
const TAPS_BEFORE = 25;
const BELL = 30;
const AFTER = 75;
/** Each teacher starts within this many seconds of the bell, as in the gate. */
const START_WITHIN = 2;
const CADENCE = 30;
const POLL = 2;
const LESSON = { durationMinutes: 50 };
const LESSON_CLASSES = 6;
/** Within how many seconds of its Start's answer a rung phone opens Bali; 30 is no push. */
const WINDOW = Number(__ENV.ARRIVAL_WINDOW || '1');
if (!(WINDOW >= 0)) throw new Error(`ARRIVAL_WINDOW must be seconds, not ${__ENV.ARRIVAL_WINDOW}`);
const LIGHT = __ENV.FIRST_READ === 'light';

const school = (key) => new SharedArray(key, () => [JSON.parse(open(SCHOOL_FILE))[key]].flat());
const students = school('students');
const teachers = school('teachers');

/** Each kind's numbers in k6's summary: a threshold names each, and none can fail. */
const KINDS = 'tap start open checkin me poll ask slide download answer'.split(' ');
const thresholds = {
  'http_req_failed{who:school}': ['rate>=0'],
  'http_reqs{who:school,expected_response:false}': ['count>=0'],
  'checks{who:school}': ['rate>=0'],
};
for (const kind of KINDS) thresholds[`http_req_duration{kind:${kind}}`] = ['max>=0'];

export const options = {
  scenarios: {
    phones: {
      executor: 'per-vu-iterations',
      exec: 'tap',
      vus: students.length,
      iterations: 1,
      maxDuration: `${BELL + 30}s`,
      tags: { who: 'school' },
    },
    teachers: {
      executor: 'per-vu-iterations',
      exec: 'teacher',
      vus: teachers.length,
      iterations: 1,
      startTime: `${BELL}s`,
      maxDuration: `${AFTER + 60}s`,
      tags: { who: 'school' },
    },
  },
  summaryTrendStats: ['med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  thresholds,
};

function params(kind, token, json, extra = {}) {
  const headers = { Authorization: `Bearer ${token}`, 'X-Real-IP': SCHOOL_ADDRESS, ...extra };
  if (json) headers['Content-Type'] = 'application/json';
  return { headers, tags: { kind } };
}

/** A request in flight beside the others: a teacher's VU carries its class's devices. */
function call(kind, method, path, token, body = null, extra = {}) {
  const sent = params(kind, token, body !== null, extra);
  return http.asyncRequest(method, `${API}${path}`, body && JSON.stringify(body), sent);
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

/** Waits without blocking the VU's other devices, as k6's `sleep` would. */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const deviceTime = () => new Date().toISOString();
const joins = (n) => (r) =>
  r.status === 200 && r.json('outcome') === 'created' && r.json('armedConverted') === n;

/** A student before the bell: the tap, which waits for the Start. */
export function tap() {
  const s = students[exec.scenario.iterationInTest];
  sleep(Math.random() * TAPS_BEFORE);
  const body = JSON.stringify({ tagId: s.tagId, eventId: uuidv7(), deviceTime: deviceTime() });
  check(http.request('POST', `${API}/v1/taps`, body, params('tap', s.token, true)), {
    'a tap before the bell waits': (r) => r.status === 200 && r.json('outcome') === 'armed',
  });
}

/**
 * A teacher at the bell: the Start, which joins their 30; then, beside each other, the devices of
 * their class, the lesson's question and slide, and their second class's Start.
 */
export async function teacher() {
  const i = exec.scenario.iterationInTest;
  const t = teachers[i];
  const endAt = exec.scenario.startTime + AFTER * 1000;
  const room = [];
  for (const s of students) if (s.classId === t.classId) room.push(s);

  sleep(Math.random() * START_WITHIN);
  const path = `${API}/v1/classes/${t.classId}/sessions`;
  const bell = http.request('POST', path, JSON.stringify(LESSON), params('start', t.token, true));
  check(bell, { 'the Start joins everyone waiting': joins(room.length) });
  if (bell.status !== 200) return;

  // Committed: the push rings each of the 30 now.
  const session = bell.json('session.id');
  const lesson = i < LESSON_CLASSES;
  const devices = room.map((s) => rung(s, session, endAt, lesson));
  if (lesson) for (const s of room) devices.push(laptop(s, session, endAt));
  await Promise.all([...devices, teach(t, session, lesson)]);
}

/** The lesson's question and first slide, as the gate's teachers ask them; then the second class. */
async function teach(t, session, lesson) {
  if (lesson) {
    const question = { eventId: uuidv7(), prompt: 'Which is prime?', options: ['4', '6', '7'] };
    check(await call('ask', 'POST', `/v1/sessions/${session}/questions`, t.token, question), {
      'the question opens': (r) => r.status === 200 && r.json('outcome') === 'opened',
    });
    const shown = { eventId: uuidv7(), deckId: t.deckId, page: 1 };
    check(await call('slide', 'POST', `/v1/sessions/${session}/slide`, t.token, shown), {
      'the slide shows': (r) => r.status === 200 && r.json('slide.deckId') === t.deckId,
    });
  }
  if (t.secondClassId) {
    const path = `/v1/classes/${t.secondClassId}/sessions`;
    check(await call('start', 'POST', path, t.token, LESSON), {
      'a class no one waits for starts': joins(0),
    });
  }
}

/**
 * A phone the push rang: opened within the window, its first read at once, then a check-in every
 * 30 s from that read, and in a lesson class the lesson's poll every 2 s, to the end.
 */
async function rung(s, session, endAt, lesson) {
  await pause(Math.random() * WINDOW * 1000);
  const first = await call('open', 'GET', LIGHT ? '/v1/me/age-check' : '/v1/me', s.token);
  check(first, {
    'the first read finds the Start': (r) =>
      r.status === 200 &&
      (LIGHT || (r.json('session.id') === session && r.json('session.state') === 'focused')),
  });
  const following = lesson ? follow(s, session, endAt, true) : null;
  for (let at = Date.now() + CADENCE * 1000; at < endAt; at += CADENCE * 1000) {
    await pause(at - Date.now());
    const body = { deviceTime: deviceTime() };
    check(await call('checkin', 'POST', `/v1/sessions/${session}/checkin`, s.token, body), {
      'a check-in finds the phone focused': (r) =>
        r.status === 200 && r.json('state') === 'focused',
    });
  }
  await following;
}

/** A lesson's laptop: no push reaches it, so the student web finds the Start at its 30 s read. */
async function laptop(s, session, endAt) {
  await pause(Math.random() * CADENCE * 1000);
  check(await call('me', 'GET', '/v1/me', s.token), {
    'a laptop finds its class in session': (r) =>
      r.status === 200 &&
      r.json('classes').some((c) => c.liveSession && c.liveSession.id === session),
  });
  await follow(s, session, endAt, false);
}

/**
 * The lesson's poll every 2 s with the ETag last got, as the gate's devices poll it, asking once for
 * the download of the deck its slide names; a phone answers the question once it shows.
 */
async function follow(s, session, endAt, isPhone) {
  const presentation = `/v1/sessions/${session}/presentation`;
  let etag = null;
  let answered = !isPhone;
  let downloaded = false;
  for (let at = Date.now(); at < endAt; at += POLL * 1000) {
    await pause(at - Date.now());
    const held = etag === null ? {} : { 'If-None-Match': etag };
    const r = await call('poll', 'GET', presentation, s.token, null, held);
    check(r, {
      'a poll shows the lesson under its ETag, or 304 while it is unchanged': (res) =>
        (res.status === 200 && res.json('running') === true && Boolean(res.headers.Etag)) ||
        (res.status === 304 && etag !== null),
    });
    if (r.status !== 200) continue;
    etag = r.headers.Etag;
    const slide = r.json('slide');
    if (!downloaded && slide !== null) {
      downloaded = true;
      check(await call('download', 'GET', `/v1/decks/${slide.deckId}/download`, s.token), {
        'the deck the slide names downloads': (res) =>
          res.status === 200 && Boolean(res.json('url')),
      });
    }
    const question = r.json('question');
    if (!answered && question !== null && question.open && question.answer === null) {
      answered = true;
      const option = Math.floor(Math.random() * question.options.length);
      const pick = { eventId: uuidv7(), option };
      check(await call('answer', 'POST', `/v1/questions/${question.id}/answers`, s.token, pick), {
        'an answer counts': (res) => res.status === 200 && res.json('outcome') === 'answered',
      });
    }
  }
}

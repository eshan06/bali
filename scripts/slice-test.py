#!/usr/bin/env python3
"""End-to-end server-side slice test against the live local API + RDS bali_v2."""
import json
import subprocess
import threading
import time
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

BASE = "http://localhost:3001/v1"
TEACHER = "dev:t-rivera:aayan.nirav@gmail.com:Eshan Shah"
STUDENT = "dev:s-jordan::Jordan Park"
STUDENT2 = "dev:s-lena::Lena Walsh"

def call(method, path, token=None, body=None, expect=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as resp:
            out = json.loads(resp.read() or b"{}")
            code = resp.status
    except urllib.error.HTTPError as e:
        out = json.loads(e.read() or b"{}")
        code = e.code
    status = "OK" if (expect is None or code == expect) else f"FAIL(expected {expect})"
    print(f"[{status}] {method} {path} -> {code}")
    if status != "OK":
        print("   ", json.dumps(out)[:300])
        raise SystemExit(1)
    return out

sse_lines = []
def sse_listen(session_id, token, stop):
    req = urllib.request.Request(f"{BASE}/sessions/{session_id}/stream")
    req.add_header("authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        for raw in resp:
            if stop.is_set():
                break
            line = raw.decode().strip()
            if line.startswith("data: "):
                msg = json.loads(line[6:])
                if msg["kind"] != "ping":
                    sse_lines.append(msg)

print("== teacher bootstrap (adopts Ms. Rivera) ==")
call("POST", "/auth/bootstrap", TEACHER, {"role": "teacher"})
me = call("GET", "/me", TEACHER)
assert me["role"] == "teacher" and me["teacher"]["displayName"] == "Ms. Rivera", me
print("    adopted:", me["teacher"]["displayName"], "/", me["teacher"]["schoolName"])

classes = call("GET", "/classes", TEACHER)["classes"]
p3 = next(c for c in classes if c["name"].startswith("Period 3"))
assert p3["memberCount"] == 28, p3["memberCount"]
print(f"    Period 3: {p3['memberCount']} members, policy {p3['policyName']}, code {p3['joinCode']}")

# cleanup: end any session left over from an earlier run
if p3["live"]:
    call("POST", f"/sessions/{p3['live']['sessionId']}/end", TEACHER)
    print("    (ended leftover session)")

print("== start session (ends +6 min) ==")
ends = (datetime.now(timezone.utc) + timedelta(minutes=6)).isoformat()
detail = call("POST", f"/classes/{p3['id']}/sessions", TEACHER, {"endsAt": ends}, expect=201)
sid = detail["session"]["id"]
assert detail["counts"]["not_joined"] == 28, detail["counts"]
print(f"    session {sid[:8]}… counts: {detail['counts']}")

stop = threading.Event()
t = threading.Thread(target=sse_listen, args=(sid, TEACHER, stop), daemon=True)
t.start()
time.sleep(1.0)

print("== students bootstrap (adopt Jordan Park + Lena Walsh by name) ==")
call("POST", "/auth/bootstrap", STUDENT, {"role": "student", "firstName": "Jordan", "lastName": "Park"})
call("POST", "/auth/bootstrap", STUDENT2, {"role": "student", "firstName": "Lena", "lastName": "Walsh"})
home = call("GET", "/student/home", STUDENT)
livecls = next(c for c in home["classes"] if c["live"])
assert livecls["live"]["sessionId"] == sid
print("    Jordan sees live session in", livecls["className"])

print("== resolve tag (front desk) ==")
res = call("POST", "/tags/resolve", STUDENT, {"code": "T7XK2M9QPF"})
assert res["variant"] == "ready" and res["session"]["sessionId"] == sid, res
print("    variant:", res["variant"], "| allowed:", res["session"]["allowedAppLabels"])

print("== tap-in (Jordan, Lena) ==")
call("POST", f"/sessions/{sid}/tap-in", STUDENT, {"clientEventId": str(uuid.uuid4())})
call("POST", f"/sessions/{sid}/tap-in", STUDENT2, {"clientEventId": str(uuid.uuid4())})
# idempotent replay
rep = call("POST", f"/sessions/{sid}/tap-in", STUDENT, {"clientEventId": str(uuid.uuid4())})
assert rep["alreadyIn"] is True

print("== heartbeat (permission ok) ==")
hb = call("POST", f"/sessions/{sid}/heartbeat", STUDENT, {"permissionOk": True, "shieldsApplied": True})
assert hb["state"] == "focused", hb

print("== emergency unlock + reason ==")
ueid = str(uuid.uuid4())
u = call("POST", f"/sessions/{sid}/unlock", STUDENT, {"clientEventId": ueid})
assert u["recorded"] and u["unlockId"], u
# offline replay of same unlock is a no-op
u2 = call("POST", f"/sessions/{sid}/unlock", STUDENT, {"clientEventId": ueid})
assert u2["recorded"] is False
call("POST", f"/unlocks/{u['unlockId']}/reason", STUDENT, {"reason": "family"})

print("== teacher grants Lena a 10-min pass ==")
lena_id = next(p["studentId"] for p in call("GET", f"/sessions/{sid}", TEACHER)["participants"] if p["shortName"] == "Lena W.")
call("POST", f"/sessions/{sid}/passes", TEACHER, {"studentId": lena_id, "minutes": 10, "reason": "nurse"}, expect=201)

print("== revocation honesty (Lena's permission goes off… on a pass → revoked) ==")
hb2 = call("POST", f"/sessions/{sid}/heartbeat", STUDENT2, {"permissionOk": False, "shieldsApplied": False})
assert hb2["state"] == "revoked", hb2
hb3 = call("POST", f"/sessions/{sid}/heartbeat", STUDENT2, {"permissionOk": True, "shieldsApplied": True})
# derived truth: her pass is still ticking, so she reads `pass`, not `focused`
assert hb3["state"] == "pass" and hb3["passEndsAt"], hb3

print("== Jordan re-focuses ==")
call("POST", f"/sessions/{sid}/refocus", STUDENT, expect=200)

print("== final detail ==")
final = call("GET", f"/sessions/{sid}", TEACHER)
counts = final["counts"]
print("    counts:", counts)
assert counts["focused"] == 1 and counts["pass"] == 1 and counts["not_joined"] == 26, counts
jordan = next(p for p in final["participants"] if p["shortName"] == "Jordan P.")
assert jordan["state"] == "focused" and jordan["pendingUnlockId"] is None

print("== teacher timeline for Jordan ==")
tl = call("GET", f"/sessions/{sid}/students/{jordan['studentId']}/timeline", TEACHER)
print("    ", " | ".join(e["title"] for e in tl["events"]))

print("== portal home ==")
portal = call("GET", "/portal/home", TEACHER)
assert portal["live"]["session"]["id"] == sid
assert len(portal["approvals"]) == 2, portal["approvals"]
print("    live card ✓ · approvals:", [a["name"] for a in portal["approvals"]])
print("    recent:", [e["title"] for e in portal["recent"]][:3])

print("== student history (S8) ==")
hist = call("GET", "/student/history", STUDENT)
print("    sessions:", len(hist["sessions"]), "| streak:", hist["streakDays"], "| week:", hist["week"])

print("== end session ==")
call("POST", f"/sessions/{sid}/end", TEACHER)
ended = call("GET", f"/sessions/{sid}", TEACHER)
assert ended["counts"]["ended"] == 28, ended["counts"]

time.sleep(1.0)
stop.set()
kinds = [m["kind"] for m in sse_lines]
print(f"\n== SSE: {len(sse_lines)} messages ==")
print("    kinds:", {k: kinds.count(k) for k in set(kinds)})
ev_titles = [m["event"]["title"] for m in sse_lines if m["kind"] == "event"]
print("    events:", " | ".join(ev_titles))
assert "snapshot" in kinds and "participant" in kinds and "event" in kinds
assert any("Emergency Unlock" in t for t in ev_titles)

print("\nALL SLICE CHECKS PASSED ✓")

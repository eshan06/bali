#!/usr/bin/env python3
"""Integration test for the 2b management/report surface: class edit/archive, policies
CRUD (+in-use guard), tags lifecycle, settings, reports (+CSV framing line), event log,
rate limiting. Runs against the live local API + RDS bali_v2; cleans up after itself."""
import json
import urllib.request
import urllib.error

BASE = "http://localhost:3001/v1"
TEACHER = "dev:t-rivera:aayan.nirav@gmail.com:Eshan Shah"


def call(method, path, token=None, body=None, expect=None, raw=False, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data) as resp:
            payload = resp.read()
            out = payload.decode() if raw else json.loads(payload or b"{}")
            code = resp.status
            resp_headers = dict(resp.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            out = json.loads(payload or b"{}")
        except json.JSONDecodeError:
            out = payload.decode()
        code = e.code
        resp_headers = dict(e.headers)
    status = "OK" if (expect is None or code == expect) else f"FAIL(expected {expect})"
    print(f"[{status}] {method} {path} -> {code}")
    if status != "OK":
        print("   ", json.dumps(out)[:300] if not isinstance(out, str) else out[:300])
        raise SystemExit(1)
    return (out, resp_headers) if raw else out


print("== bootstrap ==")
call("POST", "/auth/bootstrap", TEACHER, {"role": "teacher"})

# Idempotency pre-pass: archive test classes / delete test policies left by aborted runs.
for c in call("GET", "/classes", TEACHER)["classes"]:
    if c["name"].startswith("Test Period 9"):
        call("PATCH", f"/classes/{c['id']}", TEACHER, {"archived": True})
        print(f"    (archived leftover {c['name']})")
for p in call("GET", "/policies", TEACHER)["policies"]:
    if p["name"] == "Test Quiz":
        call("DELETE", f"/policies/{p['id']}", TEACHER)
        print("    (deleted leftover Test Quiz policy)")

print("== policies CRUD ==")
pol = call("POST", "/policies", TEACHER,
           {"name": "Test Quiz", "messagesAllowed": False, "allowedAppLabels": ["Calculator"]}, expect=201)
assert pol["usedByClasses"] == 0 and pol["messagesAllowed"] is False, pol
pol2 = call("PATCH", f"/policies/{pol['id']}", TEACHER, {"allowedAppLabels": ["Calculator", "Notes"]})
assert pol2["allowedAppLabels"] == ["Calculator", "Notes"], pol2

print("== class create + edit + policy attach ==")
cls = call("POST", "/classes", TEACHER,
           {"name": "Test Period 9", "startTime": "15:00", "endTime": "15:45", "policyId": pol["id"]}, expect=201)
edited = call("PATCH", f"/classes/{cls['id']}", TEACHER, {"name": "Test Period 9 — Edited", "requireApproval": True})
assert edited["name"] == "Test Period 9 — Edited" and edited["requireApproval"] is True, edited

print("== policy delete guard (attached to 1 class) ==")
guard = call("DELETE", f"/policies/{pol['id']}", TEACHER, expect=409)
assert guard["error"] == "policy_in_use" and "1 class" in guard["message"], guard

print("== tags lifecycle ==")
tag = call("POST", f"/classes/{cls['id']}/tags", TEACHER, {"label": "Test Desk 1"}, expect=201)
assert len(tag["code"]) == 10 and tag["active"], tag
tags = call("GET", f"/classes/{cls['id']}/tags", TEACHER)
assert any(t["id"] == tag["id"] for t in tags["tags"]), tags
ren = call("PATCH", f"/tags/{tag['id']}", TEACHER, {"label": "Test Desk 1 — Door"})
assert ren["label"] == "Test Desk 1 — Door", ren
off = call("PATCH", f"/tags/{tag['id']}", TEACHER, {"active": False})
assert off["active"] is False and off["deactivatedAt"], off
# deactivated tag stops resolving publicly
call("GET", f"/public/tags/{tag['code']}", expect=404)
on = call("PATCH", f"/tags/{tag['id']}", TEACHER, {"active": True})
assert on["active"] is True and on["deactivatedAt"] is None, on
pub = call("GET", f"/public/tags/{tag['code']}")
assert pub["className"] == "Test Period 9 — Edited", pub

print("== duplicate tag code -> 409 ==")
call("POST", f"/classes/{cls['id']}/tags", TEACHER, {"label": "Dup", "code": tag["code"]}, expect=409)

print("== settings round-trip ==")
before = call("GET", "/me/settings", TEACHER)
upd = call("PATCH", "/me/settings", TEACHER, {"displayName": "Ms. R.", "notifyWeekly": True})
assert upd["displayName"] == "Ms. R." and upd["notifyWeekly"] is True, upd
restored = call("PATCH", "/me/settings", TEACHER,
                {"displayName": before["displayName"], "notifyWeekly": before["notifyWeekly"]})
assert restored["displayName"] == before["displayName"], restored

print("== reports: unlocks (json + csv framing line) ==")
rep = call("GET", "/reports/unlocks?range=month", TEACHER)
assert rep["framing"] == "Patterns are conversation starters, not verdicts.", rep["framing"]
assert rep["count"] == len(rep["rows"]) and all(len(r["weeks"]) == 6 for r in rep["rows"])
csv_text, csv_headers = call("GET", "/reports/unlocks?range=month&format=csv", TEACHER, raw=True)
assert csv_text.startswith("# Patterns are conversation starters, not verdicts.\n"), csv_text[:80]
assert "text/csv" in csv_headers.get("content-type", ""), csv_headers
print(f"    {rep['count']} unlocks this month; CSV header line verified")

print("== reports: focus minutes (averages only) ==")
fm = call("GET", "/reports/focus-minutes?range=month", TEACHER)
assert fm["periodMinutes"] > 0 and isinstance(fm["rows"], list), fm
for row in fm["rows"]:
    assert set(row) == {"classId", "className", "avgMinutes", "sessionCount", "scheduledMinutes"}, row
print(f"    {len(fm['rows'])} classes with sessions; period {fm['periodMinutes']} min")

print("== event log: pagination + type groups ==")
page1 = call("GET", "/events?limit=3", TEACHER)
assert len(page1["events"]) <= 3
if page1["nextCursor"]:
    page2 = call("GET", f"/events?limit=3&cursor={page1['nextCursor']}", TEACHER)
    ids1 = {e["id"] for e in page1["events"]}
    assert all(e["id"] not in ids1 for e in page2["events"]), "cursor pages overlap"
ems = call("GET", "/events?type=emergencies&limit=50", TEACHER)
assert all(e["type"] in ("emergency_unlock", "reason_shared", "refocused") for e in ems["events"]), ems
sess = call("GET", "/events?type=sessions&limit=50", TEACHER)
assert all(e["type"].startswith("session_") for e in sess["events"]), sess
tagev = call("GET", "/events?limit=50", TEACHER)
assert any(e["type"] in ("tag_created", "tag_deactivated") for e in tagev["events"]), "tag events missing from log"

print("== rate limit: join hammering -> 429 with calm envelope ==")
limited_token = "dev:rl-test::Rate Limit"  # fixed sub: reruns reuse the same student row
call("POST", "/auth/bootstrap", limited_token, {"role": "student", "firstName": "Rate", "lastName": "Limit"})
saw_429 = False
for i in range(12):
    req = urllib.request.Request(BASE + "/join", method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("authorization", f"Bearer {limited_token}")
    try:
        urllib.request.urlopen(req, json.dumps({"code": "ZZZZZZZZ"}).encode())
    except urllib.error.HTTPError as e:
        if e.code == 429:
            body = json.loads(e.read())
            assert body["error"] == "rate_limited", body
            saw_429 = True
            break
assert saw_429, "12 joins in a row never hit the limiter"
print("    429 envelope verified")

print("== archive guard + archive + cleanup ==")
arch = call("PATCH", f"/classes/{cls['id']}", TEACHER, {"archived": True})
assert arch["archived"] is True, arch
ids = [c["id"] for c in call("GET", "/classes", TEACHER)["classes"]]
assert cls["id"] not in ids, "archived class still listed"
# detached: archived class no longer counts toward policy usage -> delete succeeds
call("DELETE", f"/policies/{pol['id']}", TEACHER)

print("\nALL MANAGE CHECKS PASSED ✓")

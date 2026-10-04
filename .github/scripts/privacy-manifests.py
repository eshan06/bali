#!/usr/bin/env python3
"""Phase 6, C1: every bundle ios/project.yml builds carries a sound privacy manifest.

App Store Connect reads each bundle's PrivacyInfo.xcprivacy at every upload, TestFlight
included. Run from the repository root, on Linux (no Xcode), this fails when:
  - an application or app-extension target has no ios/<Target>/PrivacyInfo.xcprivacy, or
    project.yml does not copy it in as a resource;
  - a manifest does not parse as a plist, says it tracks, names a tracking domain, or has a
    malformed entry or a reason code Apple does not document for its category;
  - Swift the target compiles in (its folder and the local packages it links, which end up in
    its binary) calls a required-reason API its manifest does not declare;
  - the app's collected data types differ from docs/APP-STORE.md's privacy table, or an
    extension declares any (none calls the API, so none collects).
The API scan is best effort: regexes for the spellings in USES, not a parse of the Swift, so
a new required-reason call spelled another way (sysctl's kern.boottime, say) adds a pattern.
GRDB ships its own manifest in its package, so third-party code is not scanned here.
"""
import os
import plistlib
import re
import sys
from pathlib import Path

IOS = Path("ios")

# Apple's documented reasons per category ("Describing use of required reason API").
REASONS = {
    "NSPrivacyAccessedAPICategoryUserDefaults": {"CA92.1", "1C8F.1", "C56D.1", "AC6B.1"},
    "NSPrivacyAccessedAPICategorySystemBootTime": {"35F9.1", "8FFB.1", "3D61.1"},
    "NSPrivacyAccessedAPICategoryFileTimestamp": {"DDA9.1", "C617.1", "3B52.1", "0A2A.1"},
    "NSPrivacyAccessedAPICategoryDiskSpace": {"85F4.1", "E174.1", "7D9E.1", "B728.1"},
    "NSPrivacyAccessedAPICategoryActiveKeyboards": {"3EC4.1", "54BD.1"},
}
# The calls that put a category in a binary, as Swift spells them.
USES = {
    "NSPrivacyAccessedAPICategoryUserDefaults": r"\b(NS)?UserDefaults\b|@AppStorage\b",
    "NSPrivacyAccessedAPICategorySystemBootTime": r"\bsystemUptime\b|\bmach_absolute_time\b",
    "NSPrivacyAccessedAPICategoryFileTimestamp": r"\.(creationDate|modificationDate)\b"
    r"|\b(contentModificationDate|creationDate)Key\b|\b[fl]?stat(at)?\(|\bgetattrlist",
    "NSPrivacyAccessedAPICategoryDiskSpace": r"\bvolume(Available|Total)Capacity"
    r"|\bsystem(Free)?Size\b|\bstatv?fs\(",
    "NSPrivacyAccessedAPICategoryActiveKeyboards": r"\bactiveInputModes\b",
}
PURPOSE = "NSPrivacyCollectedDataTypePurpose"

errors = []


def fail(message):
    errors.append(message)


def targets(spec):
    """{name: (type, block text)} for each target in project.yml (two-space YAML)."""
    body = spec.split("\ntargets:\n", 1)[1]
    found = {}
    for chunk in re.split(r"\n(?=  [A-Za-z]\w*:\n)", "\n" + body):
        head = re.match(r"\n?  ([A-Za-z]\w*):\n", chunk)
        kind = re.search(r"^    type: (\S+)", chunk, re.M)
        if head and kind:
            found[head.group(1)] = (kind.group(1), chunk)
    return found


def package_dirs(spec, block):
    """The local packages a target links, and theirs in turn, as folders under ios/."""
    paths = dict(re.findall(r"^  (\w+):\n    path: (\S+)", spec.split("\ntargets:\n")[0], re.M))
    todo = [IOS / paths[name] for name in re.findall(r"- package: (\w+)", block) if name in paths]
    seen = []
    while todo:
        folder = Path(os.path.normpath(todo.pop()))
        if folder in seen:
            continue
        seen.append(folder)
        manifest = (folder / "Package.swift").read_text()
        todo += [folder / p for p in re.findall(r'\.package\(path: "([^"]+)"\)', manifest)]
    return [folder / "Sources" for folder in seen]


def code_of(line):
    """A Swift line without its `//` comment: a `//` inside a string literal (a URL) stays."""
    quoted = escaped = False
    for at, char in enumerate(line):
        if escaped:
            escaped = False
        elif quoted and char == "\\":
            escaped = True
        elif char == '"':
            quoted = not quoted
        elif not quoted and line.startswith("//", at):
            return line[:at]
    return line


def swift_uses(folders):
    used = {}
    for folder in folders:
        for file in sorted(folder.rglob("*.swift")):
            for number, line in enumerate(file.read_text().splitlines(), 1):
                code = code_of(line)
                for category, pattern in USES.items():
                    if re.search(pattern, code):
                        used.setdefault(category, f"{file}:{number}")
    return used


def documented_types():
    """docs/APP-STORE.md's privacy table, as Apple's NSPrivacyCollectedDataType names."""
    text = Path("docs/APP-STORE.md").read_text().split("### App Privacy", 1)[1]
    text = text.split("\n### ", 1)[0]
    names = re.findall(r"^\| [^|]*→ \*\*([^*]+)\*\* \|", text, re.M)
    return {"NSPrivacyCollectedDataType" + name.replace(" ", "") for name in names}


def check(name, kind, block, spec):
    path = IOS / name / "PrivacyInfo.xcprivacy"
    if not path.is_file():
        return fail(f"{name}: no {path}")
    if not re.search(rf"- path: {name}/PrivacyInfo\.xcprivacy\n\s+buildPhase: resources", block):
        fail(f"{name}: project.yml does not copy {path} in as a resource")
    try:
        manifest = plistlib.loads(path.read_bytes())
    except Exception as error:  # plistlib raises several types; any of them is malformed
        return fail(f"{path}: not a plist ({error})")
    if not isinstance(manifest, dict):
        return fail(f"{path}: the top level is not a dictionary")
    if manifest.get("NSPrivacyTracking") is not False:
        fail(f"{path}: NSPrivacyTracking must be false")
    if manifest.get("NSPrivacyTrackingDomains") != []:
        fail(f"{path}: NSPrivacyTrackingDomains must be an empty array")

    collected = manifest.get("NSPrivacyCollectedDataTypes")
    if not isinstance(collected, list):
        return fail(f"{path}: NSPrivacyCollectedDataTypes must be an array")
    types = set()
    for entry in collected:
        purposes = entry.get("NSPrivacyCollectedDataTypePurposes") if isinstance(entry, dict) else None
        if (
            not isinstance(entry, dict)
            or not str(entry.get("NSPrivacyCollectedDataType", "")).startswith("NSPrivacyCollectedDataType")
            or not isinstance(entry.get("NSPrivacyCollectedDataTypeLinked"), bool)
            or entry.get("NSPrivacyCollectedDataTypeTracking") is not False
            or not purposes
            or not all(str(p).startswith(PURPOSE) for p in purposes)
        ):
            fail(f"{path}: a malformed or tracking collected data type: {entry}")
        else:
            types.add(entry["NSPrivacyCollectedDataType"])
    if kind == "application" and types != documented_types():
        fail(f"{path}: collected data types {sorted(types)} differ from docs/APP-STORE.md's "
             f"{sorted(documented_types())}")
    elif kind != "application" and collected:
        fail(f"{path}: an extension collects no data, but this declares {collected}")

    accessed = manifest.get("NSPrivacyAccessedAPITypes")
    if not isinstance(accessed, list):
        return fail(f"{path}: NSPrivacyAccessedAPITypes must be an array")
    declared = set()
    for entry in accessed:
        category = entry.get("NSPrivacyAccessedAPIType") if isinstance(entry, dict) else None
        reasons = entry.get("NSPrivacyAccessedAPITypeReasons") if isinstance(entry, dict) else None
        if category not in REASONS or not reasons or not isinstance(reasons, list) \
                or not set(reasons) <= REASONS[category]:
            fail(f"{path}: an unknown category or reason: {entry}")
        else:
            declared.add(category)
    for category, where in swift_uses([IOS / name] + package_dirs(spec, block)).items():
        if category not in declared:
            fail(f"{path}: {where} uses {category}, which the manifest does not declare")


def main():
    spec = (IOS / "project.yml").read_text()
    bundles = {n: t for n, t in targets(spec).items() if t[0] in ("application", "app-extension")}
    if not bundles:
        fail("ios/project.yml: no application or app-extension target found")
    for name, (kind, block) in sorted(bundles.items()):
        check(name, kind, block, spec)
    for error in errors:
        print(f"::error::{error}")
    if not errors:
        print(f"Privacy manifests sound: {', '.join(sorted(bundles))}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

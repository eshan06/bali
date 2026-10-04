#!/usr/bin/env python3
"""The privacy-manifest check against the real tree, then against broken copies of it.

Run from the repository root: python3 .github/scripts/privacy-manifests.test.py
"""
import contextlib
import importlib.util
import io
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path

ROOT = Path.cwd()
SPEC = importlib.util.spec_from_file_location(
    "privacy_manifests", ROOT / ".github/scripts/privacy-manifests.py"
)


def run(root):
    """The check's exit code and output, run in `root`."""
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    out, here = io.StringIO(), os.getcwd()
    os.chdir(root)
    try:
        with contextlib.redirect_stdout(out):
            code = module.main()
    finally:
        os.chdir(here)
    return code, out.getvalue()


class PrivacyManifests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        ignore = shutil.ignore_patterns(".build", "*.xcodeproj")
        shutil.copytree(ROOT / "ios", self.root / "ios", ignore=ignore)
        (self.root / "docs").mkdir()
        shutil.copy(ROOT / "docs/APP-STORE.md", self.root / "docs")

    def edit(self, path, old, new):
        file = self.root / path
        text = file.read_text()
        self.assertIn(old, text)
        file.write_text(text.replace(old, new, 1))

    def fails(self, message):
        code, out = run(self.root)
        self.assertEqual(code, 1, out)
        self.assertIn(message, out)

    def test_the_tree_passes(self):
        code, out = run(ROOT)
        self.assertEqual(code, 0, out)

    def test_a_missing_manifest(self):
        (self.root / "ios/BaliShield/PrivacyInfo.xcprivacy").unlink()
        self.fails("BaliShield: no ios/BaliShield/PrivacyInfo.xcprivacy")

    def test_a_manifest_not_copied_in(self):
        self.edit("ios/project.yml", "- path: BaliMonitor/PrivacyInfo.xcprivacy\n", "")
        self.fails("BaliMonitor: project.yml does not copy")

    def test_a_malformed_manifest(self):
        self.edit("ios/BaliMonitor/PrivacyInfo.xcprivacy", "</plist>", "</plist>x")
        self.fails("not a plist")

    def test_tracking(self):
        self.edit("ios/Bali/PrivacyInfo.xcprivacy", "<false/>", "<true/>")
        self.fails("NSPrivacyTracking must be false")

    def test_an_undocumented_reason(self):
        self.edit("ios/Bali/PrivacyInfo.xcprivacy", "CA92.1", "ZZZZ.1")
        self.fails("an unknown category or reason")

    def test_a_linked_package_call_undeclared(self):
        # The shield's own code calls nothing; BaliOutbox, which it links, reads the uptime.
        self.edit("ios/BaliShield/PrivacyInfo.xcprivacy", "<string>35F9.1</string>", "")
        code, out = run(self.root)
        self.assertEqual(code, 1, out)
        self.assertRegex(out, r"SyncEngine\.swift:\d+ uses NSPrivacyAccessedAPICategorySystemBootTime")

    def test_a_call_in_a_comment_is_no_call(self):
        file = self.root / "ios/BaliShield/ShieldConfigurationExtension.swift"
        file.write_text(file.read_text() + "\n// statfs( volumeAvailableCapacity\n")
        self.assertEqual(run(self.root)[0], 0)

    def test_a_call_after_a_url_is_a_call(self):
        file = self.root / "ios/BaliShield/ShieldConfigurationExtension.swift"
        file.write_text(file.read_text() + '\nlet u = "https://a.example/\\"x"; let s = statfs(\n')
        self.fails("ShieldConfigurationExtension.swift:")
        self.fails("uses NSPrivacyAccessedAPICategoryDiskSpace")

    def test_a_comment_after_a_string_is_no_call(self):
        file = self.root / "ios/BaliShield/ShieldConfigurationExtension.swift"
        file.write_text(file.read_text() + '\nlet u = "https://a.example" // statfs(\n')
        self.assertEqual(run(self.root)[0], 0)

    def test_a_new_call_undeclared(self):
        file = self.root / "ios/BaliShield/ShieldConfigurationExtension.swift"
        file.write_text(file.read_text() + "\nlet x = URLResourceKey.volumeAvailableCapacityKey\n")
        self.fails("uses NSPrivacyAccessedAPICategoryDiskSpace")

    def test_data_types_drift_from_the_label(self):
        self.edit("docs/APP-STORE.md", "→ **Device ID**", "→ **Device Model**")
        self.fails("differ from docs/APP-STORE.md")

    def test_an_extension_collecting_data(self):
        manifest = "ios/BaliShield/PrivacyInfo.xcprivacy"
        entry = (
            "<dict><key>NSPrivacyCollectedDataType</key>"
            "<string>NSPrivacyCollectedDataTypeDeviceID</string>"
            "<key>NSPrivacyCollectedDataTypeLinked</key><true/>"
            "<key>NSPrivacyCollectedDataTypeTracking</key><false/>"
            "<key>NSPrivacyCollectedDataTypePurposes</key><array>"
            "<string>NSPrivacyCollectedDataTypePurposeAppFunctionality</string></array></dict>"
        )
        text = (self.root / manifest).read_text()
        self.assertRegex(text, r"<key>NSPrivacyCollectedDataTypes</key>\s*<array/>")
        (self.root / manifest).write_text(re.sub(
            r"(<key>NSPrivacyCollectedDataTypes</key>\s*)<array/>", rf"\1<array>{entry}</array>", text
        ))
        self.fails("an extension collects no data")


if __name__ == "__main__":
    unittest.main()

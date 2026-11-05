package com.bali.outbox

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// Which windows the lock covers (AN7e): the rule on the JVM, over windows placed as Android 15's Pixel 7 emulator
// lists them (AN7e's own reading of its service's window events): a 1080 x 2400 screen, the status bar's 136 px and
// the gesture bar's 63 px outside the safe area. iOS has no twin: its shields cover every app at once.

private const val BALI = "com.bali.bali"
private const val CONTACTS = "com.google.android.contacts"
private const val VIDEO = "com.example.video"
private const val MESSAGES = "com.google.android.apps.messaging"
private const val SYSTEM_UI = "com.android.systemui"

/** The allow-list as AllowList.kt asks it of Android, on the emulator, Bali left out to show it's never covered all the same. */
private val ALLOWED = setOf(MESSAGES, "com.google.android.dialer", "com.android.phone", "com.android.settings", SYSTEM_UI, "android")

private val SAFE = Area(0, 136, 1080, 2337)
private val SCREEN = Area(0, 0, 1080, 2400)
private val STATUS_BAR = OnScreen(16, WindowKind.Drawn, Area(0, 0, 1080, 136))
private val TOP = Area(0, 0, 1080, 1187)
private val BOTTOM = Area(0, 1213, 1080, 2400)

/** Split screen's divider: its handle between the halves, its touch reaching into both. */
private val DIVIDER = OnScreen(22, WindowKind.Passed, Area(414, 1137, 666, 1263))

private val now: Instant = Instant.parse("2026-11-05T15:00:00Z")
private val bell: Instant = now.plusSeconds(3000)

/** A rule for Bali, with [names] given by the windows' own state events. */
private fun named(vararg names: Pair<Int, String>) = Cover(BALI).apply { names.forEach { (window, app) -> named(window, app) } }

/** The covers [windows] get, listed top first, while the lock holds until [until]. */
private fun Cover.over(vararg windows: OnScreen, until: Instant? = bell) = covering(windows.toList(), ALLOWED, SAFE, until, now)

/** The lock covers apps, window by window, as its service names them (AN7e). */
class CoverTest {
    @Test
    fun aBlockedAppNamedByItsWindowsOwnStateEventIsCoveredWithinTheSafeAreaAndFillingTheScreenIsSentHome() {
        val covers = named(21 to CONTACTS).over(STATUS_BAR, OnScreen(21, WindowKind.App, SCREEN))
        // The status bar and the gesture bar stay the student's: the cover is the safe area, never the whole screen.
        assertEquals(listOf(Covering(21, SAFE, home = true, held = true)), covers)
    }

    @Test
    fun aWindowNoEventHasNamedIsNeverCoveredUntilItsOwnStateEventNamesIt() {
        // Already on screen as the lock came on: no event named it, and the service reads no window's contents.
        val rule = named(20 to CONTACTS)
        val window = OnScreen(21, WindowKind.App, SCREEN)
        assertEquals(emptyList(), rule.over(window))
        assertNull(rule.app(21))
        // Its own event names it: covered at once.
        rule.named(21, CONTACTS)
        assertEquals(listOf(Covering(21, SAFE, home = true, held = true)), rule.over(window))
    }

    @Test
    fun theAllowListsAppsAndBalisOwnWindowsAreNeverCovered() {
        for (app in ALLOWED + BALI) {
            assertEquals(emptyList(), named(21 to app).over(STATUS_BAR, OnScreen(21, WindowKind.App, SCREEN)), app)
            assertEquals(emptyList(), named(30 to app).over(OnScreen(30, WindowKind.Drawn, Area(42, 0, 1038, 375))), app)
        }
    }

    @Test
    fun splitScreenIsCoveredWindowByWindowItsBlockedHalfAloneAndNeitherHalfIsSentHome() {
        // Messages above, a blocked app below: the lower half alone, at its place within the safe area, its app left there.
        val beside = named(18 to MESSAGES, 21 to CONTACTS)
        val split = arrayOf(STATUS_BAR, DIVIDER, OnScreen(18, WindowKind.App, TOP), OnScreen(21, WindowKind.App, BOTTOM))
        assertEquals(listOf(Covering(21, Area(0, 1213, 1080, 2337), home = false, held = true)), beside.over(*split))
        // Both halves blocked: each covered at its own place, the divider's handle between them left bare.
        val both = named(18 to VIDEO, 21 to CONTACTS)
        assertEquals(
            listOf(Covering(18, Area(0, 136, 1080, 1187), home = false, held = true), Covering(21, Area(0, 1213, 1080, 2337), home = false, held = true)),
            both.over(*split),
        )
    }

    @Test
    fun aPictureInPictureWindowIsCoveredAtItsSmallPlaceItsTouchesLeftToSystemUiNeverSentHomeAndTheAllowedAppUnderItIsNot() {
        // Its cover holds no touch, so System UI still moves, closes or opens it: never stuck over the dialer under it.
        val small = Area(440, 1495, 1038, 1831)
        val covers = named(27 to VIDEO, 18 to MESSAGES).over(STATUS_BAR, OnScreen(27, WindowKind.App, small, pictureInPicture = true), OnScreen(18, WindowKind.App, SCREEN))
        assertEquals(listOf(Covering(27, small, home = false, held = false)), covers)
    }

    @Test
    fun nothingIsCoveredWhileTheShadeOrQuickSettingsFillsTheScreenNamedOrNot() {
        val app = OnScreen(21, WindowKind.App, BOTTOM)
        val shade = OnScreen(10, WindowKind.Drawn, SCREEN)
        assertEquals(emptyList(), named(10 to SYSTEM_UI, 21 to CONTACTS).over(shade, app))
        assertEquals(emptyList(), named(21 to CONTACTS).over(shade, app))
        // Nor sent home under it: no cover lands.
        assertEquals(emptyList(), named(10 to SYSTEM_UI, 21 to CONTACTS).over(shade, OnScreen(21, WindowKind.App, SCREEN)))
        // Closed again, the app is covered again.
        assertEquals(listOf(Covering(21, Area(0, 1213, 1080, 2337), home = false, held = true)), named(21 to CONTACTS).over(STATUS_BAR, app))
    }

    @Test
    fun aCoverKeepsClearOfANotificationAndOfTheKeyboardAboveTheWindowItCovers() {
        // A notification over a blocked upper half: its answer and its words stay the student's, the cover below it.
        val notification = OnScreen(10, WindowKind.Drawn, Area(42, 0, 1038, 375))
        val upper = named(10 to SYSTEM_UI, 18 to VIDEO).over(notification, STATUS_BAR, OnScreen(18, WindowKind.App, TOP))
        assertEquals(listOf(Covering(18, Area(0, 375, 1080, 1187), home = false, held = true)), upper)
        // The keyboard, risen for Messages above, over a blocked lower half: the cover stops where the keyboard starts.
        val keyboard = OnScreen(14, WindowKind.Kept, Area(0, 1517, 1080, 2400))
        val lower = named(18 to MESSAGES, 21 to CONTACTS).over(keyboard, STATUS_BAR, OnScreen(18, WindowKind.App, TOP), OnScreen(21, WindowKind.App, BOTTOM))
        assertEquals(listOf(Covering(21, Area(0, 1213, 1080, 1517), home = false, held = true)), lower)
        // Over a full-screen app, its app is sent home all the same, as the window fills the screen.
        val full = named(21 to CONTACTS).over(keyboard, STATUS_BAR, OnScreen(21, WindowKind.App, SCREEN))
        assertEquals(listOf(Covering(21, Area(0, 136, 1080, 1517), home = true, held = true)), full)
    }

    @Test
    fun theKeyboardIsNeverCoveredWhateverAppNamesIt() {
        assertEquals(emptyList(), named(14 to VIDEO).over(OnScreen(14, WindowKind.Kept, Area(0, 1517, 1080, 2400))))
    }

    @Test
    fun aWindowABlockedAppDrawsOverOthersIsCoveredButNeverSentHomeWhichMovesNoSuchWindow() {
        val covers = named(30 to VIDEO, 18 to "com.android.settings").over(OnScreen(30, WindowKind.Drawn, SCREEN), OnScreen(18, WindowKind.App, SCREEN))
        assertEquals(listOf(Covering(30, SAFE, home = false, held = true)), covers)
    }

    @Test
    fun theCoversAndOtherOverlaysAreNeitherCoveredNorKeptClear() {
        val cover = OnScreen(40, WindowKind.Passed, Area(0, 1213, 1080, 2337))
        val covers = named(40 to BALI, 21 to CONTACTS).over(cover, STATUS_BAR, OnScreen(21, WindowKind.App, BOTTOM))
        assertEquals(listOf(Covering(21, Area(0, 1213, 1080, 2337), home = false, held = true)), covers)
    }

    @Test
    fun aBlockedWindowUnderAnotherIsCoveredWholeTheOneAboveCoveredTooAndOnlyTheFullScreenOneSentHome() {
        val dialog = Area(100, 900, 980, 1500)
        val covers = named(25 to CONTACTS, 21 to CONTACTS).over(OnScreen(25, WindowKind.App, dialog), STATUS_BAR, OnScreen(21, WindowKind.App, SCREEN))
        assertEquals(listOf(Covering(25, dialog, home = false, held = true), Covering(21, SAFE, home = true, held = true)), covers)
    }

    @Test
    fun aWindowOutsideTheSafeAreaIsNeverCovered() {
        assertEquals(emptyList(), named(31 to VIDEO).over(OnScreen(31, WindowKind.App, Area(0, 0, 1080, 136))))
    }

    @Test
    fun nothingIsCoveredOnceTheLocksEndHasPassedByThePhonesClockAndTheNamesGoWithIt() {
        val window = OnScreen(21, WindowKind.App, SCREEN)
        for (until in listOf(now, now.minusSeconds(1), null)) {
            val rule = named(21 to CONTACTS)
            assertEquals(emptyList(), rule.over(window, until = until), "$until")
            // No list of the apps a student opened outlives the lock: the next lock covers the window once it names itself again.
            assertNull(rule.app(21))
            assertEquals(emptyList(), rule.over(window))
            rule.named(21, CONTACTS)
            assertEquals(listOf(Covering(21, SAFE, home = true, held = true)), rule.over(window))
        }
        // A second before it, still covered.
        assertEquals(listOf(Covering(21, SAFE, home = true, held = true)), named(21 to CONTACTS).over(window, until = now.plusSeconds(1)))
    }

    @Test
    fun theLastRunsLockWhichHasNoEndOfItsOwnCoversAsAnyOtherAndForgetDropsEveryName() {
        val rule = named(21 to CONTACTS)
        assertEquals(listOf(Covering(21, SAFE, home = true, held = true)), rule.over(OnScreen(21, WindowKind.App, SCREEN), until = Instant.MAX))
        rule.forget()
        assertNull(rule.app(21))
    }

    @Test
    fun anAreaMeetsAnotherWhereTheyOverlapAndKeepsItsLargestPartClearOfIt() {
        val area = Area(0, 100, 1000, 1100)
        assertEquals(Area(500, 100, 1000, 600), area meets Area(500, 0, 2000, 600))
        // Touching is no overlap.
        assertNull(area meets Area(1000, 100, 1200, 1100))
        assertEquals(area, area.clearOf(Area(1000, 100, 1200, 1100)))
        assertEquals(Area(0, 400, 1000, 1100), area.clearOf(Area(0, 0, 1000, 400)))
        assertEquals(Area(0, 100, 1000, 900), area.clearOf(Area(0, 900, 1000, 2000)))
        assertEquals(Area(0, 100, 700, 1100), area.clearOf(Area(700, 0, 1000, 2000)))
        assertEquals(Area(300, 100, 1000, 1100), area.clearOf(Area(-10, 0, 300, 2000)))
        // A small one inside it: the largest part left beside it.
        assertEquals(Area(0, 100, 1000, 600), area.clearOf(Area(400, 600, 600, 700)))
        assertNull(area.clearOf(Area(-1, 0, 1001, 1200)))
    }
}

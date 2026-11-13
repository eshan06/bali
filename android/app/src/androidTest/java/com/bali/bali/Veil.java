package com.bali.bali;

import android.app.Activity;

/**
 * A see-through activity of the tests' own app over the sign-in's host (SignInBrowserTest.kt, AN6f): the host stays on screen
 * under it, paused and never covered, as it is while a browser's first page is still opening over it. It draws nothing and
 * does nothing; the host that started it finishes it. Java, as {@link StandIn} is: the tests' app carries no Kotlin.
 */
public class Veil extends Activity {}

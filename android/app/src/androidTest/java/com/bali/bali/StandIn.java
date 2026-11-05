package com.bali.bali;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Rational;
import android.view.View;

/**
 * A blocked app for the cover's tests (CoversTest.kt, AN7e): the spike's stand-in, without its sound and its network, in
 * the tests' own app, com.bali.bali.test, which the allow-list never holds. It runs in that app's own process, which
 * carries no Kotlin of its own, so it's Java. Started with {@link #PIP_ON_LEAVE} it goes into picture-in-picture as it's
 * sent home, as a video app does; with {@link #FINISH} it closes. Its colour is one no cover has.
 */
public class StandIn extends Activity {
    static final String PIP_ON_LEAVE = "pipOnLeave";
    static final String FINISH = "finish";
    static final int COLOUR = Color.MAGENTA;

    private boolean pipOnLeave;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        View plain = new View(this);
        plain.setBackgroundColor(COLOUR);
        setContentView(plain);
        asked(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        asked(intent);
    }

    private void asked(Intent intent) {
        if (intent.getBooleanExtra(FINISH, false)) finishAndRemoveTask();
        pipOnLeave = intent.getBooleanExtra(PIP_ON_LEAVE, false);
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (pipOnLeave) enterPictureInPictureMode(new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build());
    }
}

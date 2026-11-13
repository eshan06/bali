package com.bali.bali;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.os.Bundle;
import android.provider.CallLog;
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

    /**
     * An emergency alert's receiver, declared as any app may declare one, so the allow-list's test sees that an app no
     * system app is never allowed for it. Only Android's telephony may send it one; it does nothing with it.
     */
    public static class Alert extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {}
    }

    /**
     * The cover test's own call taken out of the call log on Android 10, whose shell has no call-log permission there
     * (CoversTest.kt): the calls since {@link #SINCE} counted, after deleting them with {@link #DELETE}; the count, the
     * broadcast's result. Only the tests' own app holds that permission, granted by the test and gone with the app.
     */
    public static class Calls extends BroadcastReceiver {
        static final String SINCE = "since";
        static final String DELETE = "delete";

        @Override
        public void onReceive(Context context, Intent intent) {
            ContentResolver calls = context.getContentResolver();
            String where = CallLog.Calls.DATE + ">=?";
            String[] since = {Long.toString(intent.getLongExtra(SINCE, Long.MAX_VALUE))};
            if (intent.getBooleanExtra(DELETE, false)) calls.delete(CallLog.Calls.CONTENT_URI, where, since);
            try (Cursor found = calls.query(CallLog.Calls.CONTENT_URI, new String[] {CallLog.Calls._ID}, where, since, null)) {
                setResultCode(found == null ? -1 : found.getCount());
            }
        }
    }
}

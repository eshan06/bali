package com.bali.bali

import android.content.Context
import androidx.room.Room
import com.bali.outbox.Outbox
import com.bali.outbox.OutboxDatabase

/** The outbox's file, iOS's name for it, in the app's own `databases/`. */
const val OUTBOX_FILE = "outbox.sqlite"

/**
 * The outbox, in the app's own storage, which only Bali reads and Android deletes with it; the
 * backup rules leave it out of a backup and of a transfer to a new phone (res/xml), so a reinstall
 * starts again under an install of its own (A12). The app's is [OUTBOX_FILE], which it opens once
 * ([BaliApp.begin]); a test's [name] is its own, never the app's, which the app's start opens in the
 * tests' process too (AN7d).
 */
fun Context.outbox(name: String = OUTBOX_FILE): Outbox = Outbox.open(Room.databaseBuilder(applicationContext, OutboxDatabase::class.java, name))

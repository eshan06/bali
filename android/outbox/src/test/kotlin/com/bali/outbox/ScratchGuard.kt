package com.bali.outbox

import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.SQLiteStatement
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

// Scratch, never committed: a driver that reports a connection used by two threads at once, or
// closed while in use, the two ways a native SQLite call can crash.

object Guard {
    fun report(what: String) {
        val here = Thread.currentThread()
        System.err.println("GUARD-VIOLATION [${here.name}] $what\n" + here.stackTrace.drop(2).take(45).joinToString("\n") { "    at $it" })
    }
}

class GuardDriver(private val bundled: SQLiteDriver = BundledSQLiteDriver()) : SQLiteDriver by bundled {
    override fun open(fileName: String): SQLiteConnection = GuardedConnection(bundled.open(fileName))
}

class GuardedConnection(private val connection: SQLiteConnection) : SQLiteConnection by connection {
    private val depth = AtomicInteger()
    private val owner = AtomicReference<Thread?>()

    @Volatile private var closed = false

    fun enter(what: String) {
        val here = Thread.currentThread()
        if (closed) Guard.report("used after close: $what")
        val other = owner.get()
        if (depth.get() > 0 && other != null && other != here) {
            Guard.report("two threads at once: $what; the other, ${other.name}:\n" + other.stackTrace.take(45).joinToString("\n") { "    at $it" })
        }
        owner.set(here)
        depth.incrementAndGet()
    }

    fun exit() {
        if (depth.decrementAndGet() == 0) owner.set(null)
    }

    override fun prepare(sql: String): SQLiteStatement {
        enter("prepare $sql")
        try {
            return GuardedStatement(connection.prepare(sql), this, sql)
        } finally {
            exit()
        }
    }

    override fun close() {
        val other = owner.get()
        if (depth.get() > 0 && other != null && other != Thread.currentThread()) {
            Guard.report("closed while in use by ${other.name}:\n" + other.stackTrace.take(45).joinToString("\n") { "    at $it" })
        }
        closed = true
        connection.close()
    }
}

class GuardedStatement(private val statement: SQLiteStatement, private val connection: GuardedConnection, private val sql: String) :
    SQLiteStatement by statement {
    override fun step(): Boolean {
        connection.enter("step $sql")
        try {
            return statement.step()
        } finally {
            connection.exit()
        }
    }

    override fun reset() {
        connection.enter("reset $sql")
        try {
            statement.reset()
        } finally {
            connection.exit()
        }
    }

    override fun close() {
        connection.enter("close $sql")
        try {
            statement.close()
        } finally {
            connection.exit()
        }
    }
}

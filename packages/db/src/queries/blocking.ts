import { query } from '../client';

export async function getAppsBySchool(schoolId: string) {
  return query(
    `SELECT id, bundle_id as "bundleId", app_name as "appName",
            category, is_default as "isDefault", created_at as "createdAt"
     FROM blocking_apps
     WHERE school_id = $1
     ORDER BY category, app_name`,
    [schoolId]
  );
}

export async function addApp(schoolId: string, bundleId: string, appName: string, category?: string, isDefault = true) {
  const rows = await query(
    `INSERT INTO blocking_apps (school_id, bundle_id, app_name, category, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, bundle_id as "bundleId", app_name as "appName",
               category, is_default as "isDefault"`,
    [schoolId, bundleId, appName, category || null, isDefault]
  );
  return rows[0];
}

export async function removeApp(id: string) {
  await query(`DELETE FROM blocking_apps WHERE id = $1`, [id]);
}

export async function setSessionBlocklist(sessionId: string, appIds: string[]) {
  await query(`DELETE FROM session_blocklist WHERE session_id = $1`, [sessionId]);
  if (appIds.length === 0) return;

  const values = appIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await query(
    `INSERT INTO session_blocklist (session_id, blocking_app_id) VALUES ${values}
     ON CONFLICT DO NOTHING`,
    [sessionId, ...appIds]
  );
}

export async function getSessionBlocklist(sessionId: string) {
  return query(
    `SELECT ba.id, ba.bundle_id as "bundleId", ba.app_name as "appName", ba.category
     FROM session_blocklist sb
     JOIN blocking_apps ba ON ba.id = sb.blocking_app_id
     WHERE sb.session_id = $1`,
    [sessionId]
  );
}

export async function getPolicyForStudent(studentId: string) {
  const SYSTEM_PROTECTED = ['com.apple.mobilephone', 'com.apple.MobileSMS'];
  const FULL_FOCUS_ALLOWED = [
    'com.apple.mobilephone', 'com.apple.MobileSMS', 'com.apple.calculator',
    'com.apple.camera', 'com.apple.clock', 'com.apple.mobilesafari', 'com.apple.mobilenotes',
  ];
  const SOCIAL_MEDIA = [
    'com.burbn.instagram', 'com.zhiliaoapp.musically', 'com.toyopagroup.picaboo',
    'com.facebook.Facebook', 'com.atebits.Tweetie2', 'com.google.ios.youtube',
  ];
  const GAMES = [
    'com.supercell.laser', 'com.innersloth.amongus', 'com.mojang.minecraftpe',
    'com.roblox.robloxmobile', 'com.supercell.scroll',
  ];

  const noResult = {
    blocking: false,
    blockingMode: 'block_specific' as const,
    blockedApps: [] as string[],
    allowedApps: [] as string[],
    sessionId: null,
  };

  // Find active session with blocking enabled for this student
  const sessions = await query(
    `SELECT cs.id as "sessionId", cs.blocking_enabled as "blockingEnabled",
            cs.blocking_mode as "blockingMode", c.blocking_preset as "blockingPreset"
     FROM class_sessions cs
     JOIN class_students cst ON cst.class_id = cs.class_id
     JOIN classes c ON c.id = cs.class_id
     WHERE cst.student_id = $1 AND cs.ended_at IS NULL AND cs.blocking_enabled = true
     LIMIT 1`,
    [studentId]
  );

  if (sessions.length === 0) return noResult;

  const session = sessions[0];
  const preset = session.blockingPreset;

  // Handle presets
  if (preset === 'full_focus') {
    return {
      blocking: true,
      blockingMode: 'block_all_except' as const,
      blockedApps: [] as string[],
      allowedApps: FULL_FOCUS_ALLOWED,
      sessionId: session.sessionId,
    };
  }

  if (preset === 'no_social_media') {
    return {
      blocking: true,
      blockingMode: 'block_specific' as const,
      blockedApps: SOCIAL_MEDIA.filter(b => !SYSTEM_PROTECTED.includes(b)),
      allowedApps: [] as string[],
      sessionId: session.sessionId,
    };
  }

  if (preset === 'no_games') {
    return {
      blocking: true,
      blockingMode: 'block_specific' as const,
      blockedApps: GAMES.filter(b => !SYSTEM_PROTECTED.includes(b)),
      allowedApps: [] as string[],
      sessionId: session.sessionId,
    };
  }

  // Custom preset or legacy — check session_blocking_apps
  const sessionApps = await query(
    `SELECT ta.bundle_id as "bundleId"
     FROM session_blocking_apps sba
     JOIN teacher_apps ta ON ta.id = sba.teacher_app_id
     WHERE sba.session_id = $1`,
    [session.sessionId]
  );

  if (sessionApps.length > 0) {
    const appBundleIds = sessionApps.map((a: any) => a.bundleId);
    if (session.blockingMode === 'block_all_except') {
      return {
        blocking: true,
        blockingMode: 'block_all_except' as const,
        blockedApps: [] as string[],
        allowedApps: [...new Set([...appBundleIds, ...SYSTEM_PROTECTED])],
        sessionId: session.sessionId,
      };
    }
    return {
      blocking: true,
      blockingMode: 'block_specific' as const,
      blockedApps: appBundleIds.filter((b: string) => !SYSTEM_PROTECTED.includes(b)),
      allowedApps: [] as string[],
      sessionId: session.sessionId,
    };
  }

  // Fall back to class custom apps
  const classApps = await query(
    `SELECT ta.bundle_id as "bundleId"
     FROM class_blocked_apps cba
     JOIN teacher_apps ta ON ta.id = cba.teacher_app_id
     JOIN class_sessions cs ON cs.class_id = cba.class_id
     WHERE cs.id = $1`,
    [session.sessionId]
  );

  if (classApps.length > 0) {
    return {
      blocking: true,
      blockingMode: 'block_specific' as const,
      blockedApps: classApps.map((a: any) => a.bundleId).filter((b: string) => !SYSTEM_PROTECTED.includes(b)),
      allowedApps: [] as string[],
      sessionId: session.sessionId,
    };
  }

  // Legacy fallback: school defaults
  const defaultApps = await query(
    `SELECT ba.bundle_id as "bundleId"
     FROM blocking_apps ba
     JOIN class_sessions cs ON cs.id = $1
     JOIN classes c ON c.id = cs.class_id
     WHERE ba.school_id = c.school_id AND ba.is_default = true`,
    [session.sessionId]
  );

  return {
    blocking: true,
    blockingMode: 'block_specific' as const,
    blockedApps: defaultApps.map((a: any) => a.bundleId).filter((b: string) => !SYSTEM_PROTECTED.includes(b)),
    allowedApps: [] as string[],
    sessionId: session.sessionId,
  };
}

/**
 * @deprecated kept for back-compat; use ATTENDANCE_LATE_AFTER_MINUTES instead.
 */
export const ATTENDANCE_THRESHOLD_MINUTES = 5;

/** A tap within this many minutes of session start is `present`. */
export const ATTENDANCE_LATE_AFTER_MINUTES = 5;
/** Students with no tap after this many minutes should be flagged absent. */
export const ATTENDANCE_ABSENT_AFTER_MINUTES = 15;

export const POLLING_INTERVAL_MS = 5000;
export const DEFAULT_PAGE_SIZE = 20;

/** Error codes returned by the hardware check-in endpoint. */
export const CHECK_IN_ERROR_CODE = {
  UNKNOWN_DEVICE: 'UNKNOWN_DEVICE',
  UNASSIGNED_DEVICE: 'UNASSIGNED_DEVICE',
  NO_ACTIVE_SESSION: 'NO_ACTIVE_SESSION',
  AMBIGUOUS_SESSION: 'AMBIGUOUS_SESSION',
  ALREADY_CHECKED_IN: 'ALREADY_CHECKED_IN',
  MISSING_BLOCKING_CONFIG: 'MISSING_BLOCKING_CONFIG',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const;
export type CheckInErrorCode = typeof CHECK_IN_ERROR_CODE[keyof typeof CHECK_IN_ERROR_CODE];

export const ATTENDANCE_STATUS = {
  PRESENT: 'present',
  LATE: 'late',
  ABSENT: 'absent',
  EXCUSED: 'excused',
} as const;

export const SESSION_STATUS = {
  ACTIVE: 'active',
  ENDED: 'ended',
} as const;

export const BLOCKING_MODE = {
  BLOCK_SPECIFIC: 'block_specific',
  BLOCK_ALL_EXCEPT: 'block_all_except',
} as const;

export const SYSTEM_PROTECTED_BUNDLE_IDS = [
  'com.apple.mobilephone',
  'com.apple.MobileSMS',
] as const;

export const BLOCKING_PRESETS = {
  NONE: 'none',
  FULL_FOCUS: 'full_focus',
  NO_SOCIAL_MEDIA: 'no_social_media',
  NO_GAMES: 'no_games',
  CUSTOM: 'custom',
} as const;

// Apps allowed in Full Focus mode (everything else is blocked)
export const FULL_FOCUS_ALLOWED_BUNDLE_IDS = [
  'com.apple.mobilephone',     // Phone
  'com.apple.MobileSMS',       // iMessage
  'com.apple.calculator',      // Calculator
  'com.apple.camera',          // Camera
  'com.apple.clock',           // Clock
  'com.apple.mobilesafari',    // Safari
  'com.apple.mobilenotes',     // Notes
] as const;

// Social media apps blocked in No Social Media mode
export const SOCIAL_MEDIA_BUNDLE_IDS = [
  'com.burbn.instagram',
  'com.zhiliaoapp.musically',
  'com.toyopagroup.picaboo',
  'com.facebook.Facebook',
  'com.atebits.Tweetie2',
  'com.google.ios.youtube',
] as const;

// Game apps blocked in No Games mode
export const GAME_BUNDLE_IDS = [
  'com.supercell.laser',
  'com.innersloth.amongus',
  'com.mojang.minecraftpe',
  'com.roblox.robloxmobile',
  'com.supercell.scroll',
] as const;

// App-name lookup used when resolving a snapshot from preset bundle IDs.
// Anything not in this map falls back to a humanised version of the bundle ID.
export const APP_NAME_BY_BUNDLE_ID: Readonly<Record<string, string>> = {
  'com.apple.mobilephone': 'Phone',
  'com.apple.MobileSMS': 'iMessage',
  'com.apple.calculator': 'Calculator',
  'com.apple.camera': 'Camera',
  'com.apple.clock': 'Clock',
  'com.apple.mobilesafari': 'Safari',
  'com.apple.mobilenotes': 'Notes',
  'com.burbn.instagram': 'Instagram',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.toyopagroup.picaboo': 'Snapchat',
  'com.facebook.Facebook': 'Facebook',
  'com.atebits.Tweetie2': 'Twitter/X',
  'com.google.ios.youtube': 'YouTube',
  'com.netflix.Netflix': 'Netflix',
  'com.spotify.client': 'Spotify',
  'com.supercell.laser': 'Brawl Stars',
  'com.innersloth.amongus': 'Among Us',
  'com.mojang.minecraftpe': 'Minecraft',
  'com.roblox.robloxmobile': 'Roblox',
  'com.supercell.scroll': 'Clash Royale',
};

export function appNameForBundleId(bundleId: string): string {
  return APP_NAME_BY_BUNDLE_ID[bundleId] ?? bundleId;
}

// Common apps shown as suggestions in Custom mode
export const SUGGESTED_APPS = [
  { bundleId: 'com.burbn.instagram', appName: 'Instagram' },
  { bundleId: 'com.zhiliaoapp.musically', appName: 'TikTok' },
  { bundleId: 'com.toyopagroup.picaboo', appName: 'Snapchat' },
  { bundleId: 'com.google.ios.youtube', appName: 'YouTube' },
  { bundleId: 'com.facebook.Facebook', appName: 'Facebook' },
  { bundleId: 'com.atebits.Tweetie2', appName: 'Twitter/X' },
  { bundleId: 'com.netflix.Netflix', appName: 'Netflix' },
  { bundleId: 'com.spotify.client', appName: 'Spotify' },
  { bundleId: 'com.supercell.laser', appName: 'Brawl Stars' },
  { bundleId: 'com.innersloth.amongus', appName: 'Among Us' },
  { bundleId: 'com.roblox.robloxmobile', appName: 'Roblox' },
  { bundleId: 'com.mojang.minecraftpe', appName: 'Minecraft' },
] as const;

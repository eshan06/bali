export const ATTENDANCE_THRESHOLD_MINUTES = 10;
export const POLLING_INTERVAL_MS = 5000;
export const DEFAULT_PAGE_SIZE = 20;

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

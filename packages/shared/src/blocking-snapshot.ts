import {
  BLOCKING_PRESETS,
  FULL_FOCUS_ALLOWED_BUNDLE_IDS,
  SOCIAL_MEDIA_BUNDLE_IDS,
  GAME_BUNDLE_IDS,
  SYSTEM_PROTECTED_BUNDLE_IDS,
  appNameForBundleId,
} from './constants';
import type { BlockingPreset, BlockingMode } from './types';

export interface BlockingAppEntry {
  bundleId: string;
  appName: string;
}

/**
 * Immutable record of the blocking policy for a given session, computed once
 * at session start from the class config. Stored as JSONB on `class_sessions`
 * and served verbatim to the iOS / simulator clients.
 */
export interface BlockingSnapshot {
  preset: BlockingPreset;
  mode: BlockingMode;
  blockingActive: boolean;
  blockedApps: BlockingAppEntry[];
  allowedApps: BlockingAppEntry[];
}

function entries(bundleIds: readonly string[]): BlockingAppEntry[] {
  return bundleIds.map((bundleId) => ({
    bundleId,
    appName: appNameForBundleId(bundleId),
  }));
}

/**
 * Resolve a class's blocking config into a session-level snapshot.
 * `customApps` is only consulted when the preset is `'custom'`.
 */
export function resolveBlockingSnapshot(
  preset: BlockingPreset,
  customApps: readonly BlockingAppEntry[] = []
): BlockingSnapshot {
  const protectedSet = new Set<string>(SYSTEM_PROTECTED_BUNDLE_IDS);

  if (preset === BLOCKING_PRESETS.NONE) {
    return {
      preset,
      mode: 'block_specific',
      blockingActive: false,
      blockedApps: [],
      allowedApps: [],
    };
  }

  if (preset === BLOCKING_PRESETS.FULL_FOCUS) {
    return {
      preset,
      mode: 'block_all_except',
      blockingActive: true,
      blockedApps: [],
      allowedApps: entries(FULL_FOCUS_ALLOWED_BUNDLE_IDS),
    };
  }

  if (preset === BLOCKING_PRESETS.NO_SOCIAL_MEDIA) {
    return {
      preset,
      mode: 'block_specific',
      blockingActive: true,
      blockedApps: entries(
        SOCIAL_MEDIA_BUNDLE_IDS.filter((b) => !protectedSet.has(b))
      ),
      allowedApps: [],
    };
  }

  if (preset === BLOCKING_PRESETS.NO_GAMES) {
    return {
      preset,
      mode: 'block_specific',
      blockingActive: true,
      blockedApps: entries(
        GAME_BUNDLE_IDS.filter((b) => !protectedSet.has(b))
      ),
      allowedApps: [],
    };
  }

  // 'custom'
  const dedupedCustom = customApps.filter(
    (a) => !protectedSet.has(a.bundleId)
  );
  return {
    preset,
    mode: 'block_specific',
    blockingActive: dedupedCustom.length > 0,
    blockedApps: dedupedCustom,
    allowedApps: [],
  };
}

/** A snapshot representing "no blocking" — used as a fallback / default. */
export const INACTIVE_BLOCKING_SNAPSHOT: BlockingSnapshot = {
  preset: 'none',
  mode: 'block_specific',
  blockingActive: false,
  blockedApps: [],
  allowedApps: [],
};

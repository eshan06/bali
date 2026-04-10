/**
 * Push notification service for sending blocking signals to iOS devices.
 *
 * Currently a stub that logs the notification. When the iOS app is ready,
 * replace the implementation with Apple Push Notification Service (APNs)
 * or Firebase Cloud Messaging (FCM) calls.
 */

interface BlockingNotification {
  sessionId: string;
  studentIds: string[];
  blockingEnabled: boolean;
  blockingMode?: string;
  blockedApps: string[];
  allowedApps?: string[];
}

export async function sendBlockingSignal(notification: BlockingNotification): Promise<void> {
  // TODO: Replace with real push notification (APNs / FCM) when iOS app is ready
  console.log('[PUSH STUB] Sending blocking signal to devices:', {
    sessionId: notification.sessionId,
    studentCount: notification.studentIds.length,
    blockingEnabled: notification.blockingEnabled,
    blockingMode: notification.blockingMode || 'block_specific',
    blockedApps: notification.blockedApps,
    allowedApps: notification.allowedApps || [],
  });

  // When iOS is ready, this will:
  // 1. Look up device push tokens for each studentId
  // 2. Send a silent push notification via APNs with the blocking payload
  // 3. The iOS app receives this and enables/disables app blocking
}

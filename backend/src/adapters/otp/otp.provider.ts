// ─────────────────────────────────────────────────────────────────────────────
// OTP Provider — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Plug-and-play: switch providers via OTP_PROVIDER env var.
// console → dev (no Firebase needed)
// firebase → production (Firebase phone auth, client SDK handles OTP delivery)
// ─────────────────────────────────────────────────────────────────────────────

export interface OtpProvider {
  /**
   * Verify a Firebase phone auth ID token and return the verified phone number.
   * Called after the client-side Firebase phone auth flow completes.
   */
  verifyFirebaseToken(idToken: string): Promise<{ phoneNumber: string }>;
}

/**
 * Console OTP Provider — For development/testing only.
 * Rejects Firebase token verification since no Firebase project is configured.
 * Use the legacy POST /auth/request-otp + POST /auth/verify-otp flow instead.
 */
export class ConsoleOtpProvider implements OtpProvider {
  async verifyFirebaseToken(_idToken: string): Promise<{ phoneNumber: string }> {
    throw new Error(
      'Firebase token verification is not available in console mode. ' +
      'Set OTP_PROVIDER=firebase and configure FIREBASE_* env vars, ' +
      'or use POST /auth/request-otp + POST /auth/verify-otp for dev.',
    );
  }
}

/**
 * Firebase OTP Provider — Production phone auth via Firebase Admin SDK.
 * The client SDK handles RecaptchaVerifier + OTP delivery + code verification.
 * This provider just verifies the resulting Firebase ID token server-side.
 */
export class FirebaseOtpProvider implements OtpProvider {
  async verifyFirebaseToken(idToken: string): Promise<{ phoneNumber: string }> {
    const { getFirebaseAdmin } = await import('../firebase');
    const app = getFirebaseAdmin();
    const decoded = await app.auth().verifyIdToken(idToken);

    if (!decoded.phone_number) {
      throw new Error('Firebase token does not contain a verified phone number.');
    }

    return { phoneNumber: decoded.phone_number };
  }
}

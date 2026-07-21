// ─────────────────────────────────────────────────────────────────────────────
// Firebase Admin SDK — Lazy Singleton
// ─────────────────────────────────────────────────────────────────────────────
// Initialized on first use; avoids crash-on-startup if Firebase creds are absent
// in environments that don't use the firebase OTP provider.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';

let initialized = false;

export function getFirebaseAdmin(): admin.app.App {
  if (!initialized) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    // Private key stored with literal \n — must be unescaped at runtime
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase Admin SDK requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY env vars.',
      );
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
    }

    initialized = true;
  }

  return admin.app();
}

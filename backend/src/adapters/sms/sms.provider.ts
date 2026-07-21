// ─────────────────────────────────────────────────────────────────────────────
// SMS Provider — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Plug-and-play: switch providers via SMS_PROVIDER env var.
// Start: console (dev) → Production: twilio, msg91, etc.
// ─────────────────────────────────────────────────────────────────────────────

export interface SmsProvider {
  /**
   * Send an OTP code to a phone number.
   * @returns true if sent successfully, false otherwise
   */
  sendOtp(phoneNumber: string, code: string): Promise<boolean>;

  /**
   * Send a custom SMS message.
   */
  sendMessage(phoneNumber: string, message: string): Promise<boolean>;
}

/**
 * Console SMS Provider — Logs OTP to console (development only).
 */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phoneNumber: string, code: string): Promise<boolean> {
    console.log(`\n══════════════════════════════════════`);
    console.log(`📱 OTP for ${phoneNumber}: ${code}`);
    console.log(`══════════════════════════════════════\n`);
    return true;
  }

  async sendMessage(phoneNumber: string, message: string): Promise<boolean> {
    console.log(`\n📱 SMS to ${phoneNumber}: ${message}\n`);
    return true;
  }
}

// ── Future implementations ──
// Network-bound providers (Twilio, Msg91, etc.) must wrap their HTTP calls
// with withTimeout from '../../lib/with-adapter-timeout' to enforce the 10s bound.
// export class TwilioSmsProvider implements SmsProvider { ... }
// export class Msg91SmsProvider implements SmsProvider { ... }

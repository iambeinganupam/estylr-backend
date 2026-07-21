// ─────────────────────────────────────────────────────────────────────────────
// Email Provider — Strategy Pattern Interface
// ─────────────────────────────────────────────────────────────────────────────
// Plug-and-play: switch providers via EMAIL_PROVIDER env var.
// console → dev (logs email to stdout, no actual sending)
// resend  → production (real transactional email via Resend)
// ─────────────────────────────────────────────────────────────────────────────

import { withTimeout } from '../../lib/with-adapter-timeout';

export interface EmailProvider {
  sendVerificationEmail(params: {
    to: string;
    firstName: string;
    verificationUrl: string;
  }): Promise<void>;

  sendWelcomeEmail(params: {
    to: string;
    firstName: string;
  }): Promise<void>;

  sendPasswordResetEmail(params: {
    to: string;
    firstName: string;
    resetUrl: string;
  }): Promise<void>;
}

/**
 * Console Email Provider — Logs emails to stdout (development only).
 */
export class ConsoleEmailProvider implements EmailProvider {
  async sendVerificationEmail(params: { to: string; firstName: string; verificationUrl: string }): Promise<void> {
    console.log('\n══════════════════════════════════════');
    console.log(`📧 Verification Email → ${params.to}`);
    console.log(`   Hi ${params.firstName}! Verify your email:`);
    console.log(`   ${params.verificationUrl}`);
    console.log('══════════════════════════════════════\n');
  }

  async sendWelcomeEmail(params: { to: string; firstName: string }): Promise<void> {
    console.log('\n══════════════════════════════════════');
    console.log(`📧 Welcome Email → ${params.to}`);
    console.log(`   Welcome to Kshuri, ${params.firstName}!`);
    console.log('══════════════════════════════════════\n');
  }

  async sendPasswordResetEmail(params: { to: string; firstName: string; resetUrl: string }): Promise<void> {
    console.log('\n══════════════════════════════════════');
    console.log(`📧 Password Reset → ${params.to}`);
    console.log(`   Hi ${params.firstName}! Reset your password:`);
    console.log(`   ${params.resetUrl}`);
    console.log('══════════════════════════════════════\n');
  }
}

/**
 * Resend Email Provider — Real transactional email via resend.com.
 */
export class ResendEmailProvider implements EmailProvider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Resend client is lazy-loaded via require() to avoid eager import; static `import type` would still require the package at type-check time even in dev/test where Resend isn't installed
  private resend: any;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    // Lazy-loaded so the `resend` package isn't pulled in for non-prod environments
    // that use the console provider. ESM `import` would force eager load at module init.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resend } = require('resend');
    this.resend = new Resend(apiKey);
    this.fromEmail = fromEmail;
  }

  async sendVerificationEmail(params: { to: string; firstName: string; verificationUrl: string }): Promise<void> {
    await withTimeout('email/resend', async () => {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: 'Verify your Kshuri account',
        html: verificationEmailHtml(params.firstName, params.verificationUrl),
      });
    });
  }

  async sendWelcomeEmail(params: { to: string; firstName: string }): Promise<void> {
    await withTimeout('email/resend', async () => {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: 'Welcome to Kshuri!',
        html: welcomeEmailHtml(params.firstName),
      });
    });
  }

  async sendPasswordResetEmail(params: { to: string; firstName: string; resetUrl: string }): Promise<void> {
    await withTimeout('email/resend', async () => {
      await this.resend.emails.send({
        from: this.fromEmail,
        to: params.to,
        subject: 'Reset your Kshuri password',
        html: passwordResetEmailHtml(params.firstName, params.resetUrl),
      });
    });
  }
}

// ── Email Templates (minimal HTML, production-ready) ──

function verificationEmailHtml(firstName: string, url: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111;">
  <h2 style="color:#7c3aed;">Verify your email address</h2>
  <p>Hi ${firstName},</p>
  <p>Click the button below to verify your email and activate your Kshuri account.</p>
  <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
    Verify Email
  </a>
  <p style="color:#666;font-size:13px;">This link expires in 24 hours. If you didn't create a Kshuri account, you can safely ignore this email.</p>
  <p style="color:#666;font-size:13px;">Or copy this URL: <a href="${url}">${url}</a></p>
</body>
</html>`;
}

function welcomeEmailHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111;">
  <h2 style="color:#7c3aed;">Welcome to Kshuri, ${firstName}!</h2>
  <p>Your account is verified and ready. Start exploring India's premier salon platform.</p>
  <p style="color:#666;font-size:13px;">The Kshuri Team</p>
</body>
</html>`;
}

function passwordResetEmailHtml(firstName: string, url: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#111;">
  <h2 style="color:#7c3aed;">Reset your password</h2>
  <p>Hi ${firstName},</p>
  <p>We received a request to reset your Kshuri password. Click the button below to proceed.</p>
  <a href="${url}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">
    Reset Password
  </a>
  <p style="color:#666;font-size:13px;">This link expires in 1 hour. If you didn't request a password reset, ignore this email.</p>
</body>
</html>`;
}

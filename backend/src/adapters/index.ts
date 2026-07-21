// ─────────────────────────────────────────────────────────────────────────────
// Adapter Factory — Provider Resolution
// ─────────────────────────────────────────────────────────────────────────────
// Centralized factory for resolving plug-and-play adapters based on env config.
// ─────────────────────────────────────────────────────────────────────────────

import { env } from '../config/env';
import { SmsProvider, ConsoleSmsProvider } from './sms/sms.provider';
import { PaymentGateway, MockPaymentGateway, RazorpayPaymentGateway } from './payment/payment.provider';
import { StorageProvider, LocalStorageProvider, CloudinaryStorageProvider, S3StorageProvider } from './storage/storage.provider';
import { OtpProvider, ConsoleOtpProvider, FirebaseOtpProvider } from './otp/otp.provider';
import { EmailProvider, ConsoleEmailProvider, ResendEmailProvider } from './email/email.provider';

let smsInstance: SmsProvider | null = null;
let paymentInstance: PaymentGateway | null = null;
let storageInstance: StorageProvider | null = null;
let otpInstance: OtpProvider | null = null;
let emailInstance: EmailProvider | null = null;

/**
 * Get the configured SMS provider.
 */
export function getSmsProvider(): SmsProvider {
  if (!smsInstance) {
    switch (env.SMS_PROVIDER) {
      case 'console':
        smsInstance = new ConsoleSmsProvider();
        break;
      // case 'twilio':
      //   smsInstance = new TwilioSmsProvider(env.SMS_API_KEY!);
      //   break;
      // case 'msg91':
      //   smsInstance = new Msg91SmsProvider(env.SMS_API_KEY!);
      //   break;
      default:
        smsInstance = new ConsoleSmsProvider();
    }
  }
  return smsInstance;
}

/**
 * Get the configured payment gateway.
 */
export function getPaymentGateway(): PaymentGateway {
  if (!paymentInstance) {
    switch (env.PAYMENT_PROVIDER) {
      case 'razorpay':
        paymentInstance = new RazorpayPaymentGateway(
          env.RAZORPAY_KEY_ID!,
          env.RAZORPAY_KEY_SECRET!,
          env.PAYMENT_WEBHOOK_SECRET,
        );
        break;
      case 'mock':
        paymentInstance = new MockPaymentGateway();
        break;
      default:
        paymentInstance = new MockPaymentGateway();
    }
  }
  return paymentInstance;
}

/**
 * Get the configured storage provider.
 */
export function getStorageProvider(): StorageProvider {
  if (!storageInstance) {
    switch (env.STORAGE_PROVIDER) {
      case 'local':
        storageInstance = new LocalStorageProvider();
        break;
      case 'cloudinary':
        storageInstance = new CloudinaryStorageProvider();
        break;
      case 's3':
        storageInstance = new S3StorageProvider();
        break;
      // case 'supabase':
      //   storageInstance = new SupabaseStorageProvider(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);
      //   break;
      default:
        storageInstance = new LocalStorageProvider();
    }
  }
  return storageInstance;
}

/**
 * Get the configured OTP provider (Firebase phone auth verification).
 */
export function getOtpProvider(): OtpProvider {
  if (!otpInstance) {
    switch (env.OTP_PROVIDER) {
      case 'firebase':
        otpInstance = new FirebaseOtpProvider();
        break;
      case 'console':
      default:
        otpInstance = new ConsoleOtpProvider();
    }
  }
  return otpInstance;
}

/**
 * Get the configured email provider (transactional email).
 */
export function getEmailProvider(): EmailProvider {
  if (!emailInstance) {
    switch (env.EMAIL_PROVIDER) {
      case 'resend':
        emailInstance = new ResendEmailProvider(env.RESEND_API_KEY!, env.RESEND_FROM_EMAIL!);
        break;
      case 'console':
      default:
        emailInstance = new ConsoleEmailProvider();
    }
  }
  return emailInstance;
}

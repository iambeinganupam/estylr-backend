import { ExternalServiceError } from './errors';

/** Sentinel rejection used by the timeout race to distinguish from caller errors. */
const TIMEOUT_SENTINEL = Symbol('with-adapter-timeout');

/**
 * Run an external adapter call with a hard time bound.
 *
 * Two layers:
 *   1. AbortSignal — for SDKs that accept one (fetch, undici, axios). They
 *      should observe the abort and reject their own promise quickly.
 *   2. Promise.race against a timeout promise — guarantees this wrapper
 *      rejects at `timeoutMs` EVEN IF the SDK ignores the signal. The
 *      underlying SDK promise may continue in the background; the caller
 *      is unblocked.
 *
 * On timeout: throws ExternalServiceError({ adapter, reason: 'timeout', timeoutMs }).
 * On inner failure: throws ExternalServiceError({ adapter, reason: 'failure', cause }).
 *
 * Pass `timeoutMs = 0` to disable the timeout entirely (for testing only).
 *
 * Caveat: when the SDK ignores the AbortSignal, its underlying socket may
 * stay open until its own internal timeout. The caller no longer waits, but
 * the resource isn't reclaimed. Where possible, configure SDK-level timeouts
 * too (e.g. Cloudinary's `timeout` option, Resend via `fetch` override).
 */
export async function withTimeout<T>(
  adapterName: string,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 10_000,
): Promise<T> {
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const work = fn(ac.signal);

  if (timeoutMs <= 0) {
    try {
      return await work;
    } catch (e) {
      throw new ExternalServiceError({
        adapter: adapterName,
        reason: 'failure',
        cause: (e as Error)?.message ?? String(e),
      });
    }
  }

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(TIMEOUT_SENTINEL);
    }, timeoutMs);
  });

  // Swallow any later rejection from the work promise to avoid
  // unhandledRejection warnings — the SDK may still resolve/reject after
  // the timeout fires and our caller has already moved on.
  work.catch(() => undefined);

  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    if (e === TIMEOUT_SENTINEL || ac.signal.aborted) {
      throw new ExternalServiceError({
        adapter: adapterName,
        reason: 'timeout',
        timeoutMs,
      });
    }
    throw new ExternalServiceError({
      adapter: adapterName,
      reason: 'failure',
      cause: (e as Error)?.message ?? String(e),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

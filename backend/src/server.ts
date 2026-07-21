// ─────────────────────────────────────────────────────────────────────────────
// Server Bootstrap — Entry Point (Production-Hardened)
// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: Sentry MUST be initialised before any other import.
// This file is the only entry point — never import server.ts from tests.
// ─────────────────────────────────────────────────────────────────────────────

// ① Sentry first — before everything else
import { initSentry, Sentry } from './config/sentry';
initSentry();

import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeDatabasePool } from './config/database';
import { startBackgroundJobs, stopBackgroundJobs } from './jobs';
import http from 'http';
import 'dotenv/config';

const app = createApp();
const server = http.createServer(app);

// HTTP server timeouts — guard against slow-loris and stalled requests
server.headersTimeout = 30_000;   // 30s to receive complete request headers
server.requestTimeout = 60_000;   // 60s for full request body
server.keepAliveTimeout = 65_000; // > AWS ALB default (60s) to avoid mid-flight closures

// Track open connections for zero-downtime drain
const openConnections = new Set<import('net').Socket>();
server.on('connection', (socket) => {
  openConnections.add(socket);
  socket.on('close', () => openConnections.delete(socket));
});

server.listen(env.PORT, () => {
  logger.info({
    port: env.PORT,
    env: env.NODE_ENV,
    version: env.APP_VERSION,
    apiVersion: env.API_VERSION,
    pid: process.pid,
  }, `🚀 Kshuri API ready on :${env.PORT}`);

  startBackgroundJobs();
});

// ── Graceful Shutdown ──
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return; // Prevent double-shutdown
  isShuttingDown = true;

  logger.info({ signal, openConnections: openConnections.size }, 'Graceful shutdown started');

  // Force shutdown after 30 seconds (gives Kubernetes time to drain)
  const forceTimer = setTimeout(() => {
    logger.error('Forced shutdown after 30s timeout');
    process.exit(1);
  }, 30000);
  forceTimer.unref(); // Don't keep event loop alive just for this timer

  try {
    // 1. Stop accepting new connections
    server.close();

    // 2. Destroy idle keep-alive connections immediately
    for (const socket of openConnections) {
      socket.end();
    }

    // 3. Give in-flight requests up to 5s to complete
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5000);
    });

    // 4. Force-destroy any lingering connections
    for (const socket of openConnections) {
      socket.destroy();
    }

    // 5. Stop background jobs (cron tasks)
    stopBackgroundJobs();

    // 6. Flush Sentry events before exit
    await Sentry.flush(2000);

    // 7. Close DB pool
    await closeDatabasePool();

    logger.info('Graceful shutdown complete ✓');
    clearTimeout(forceTimer);
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Global Error Safety Net ──
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise: String(promise) }, 'Unhandled promise rejection');
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error, stack: error.stack }, 'Uncaught exception — triggering shutdown');
  Sentry.captureException(error);
  // Must exit — process state is undefined after uncaught exception
  gracefulShutdown('uncaughtException');
});

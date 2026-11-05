import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { Worker } from "bullmq";
import IORedis from "ioredis";

async function startWorker() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured");
  }

  const { processAnalysisJob } = await import("./analysisProcessor");

  const connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  let worker: Worker;

  try {
    worker = new Worker("analysis", processAnalysisJob, {
      connection,
      concurrency: 1,
      lockDuration: 60_000,
    });
  } catch (error) {
    connection.disconnect();
    throw error;
  }

  worker.on("error", (error) => {
    console.error("[Analysis Worker] Worker error:", error);
  });

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: string): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      console.info(`[Analysis Worker] Received ${signal}. Shutting down...`);

      try {
        await worker.close();

        console.info("[Analysis Worker] Worker closed successfully.");
      } catch (error) {
        console.error("[Analysis Worker] Error closing worker:", error);
      } finally {
        try {
          if (connection.status === "ready") {
            await connection.quit();
          } else {
            connection.disconnect();
          }
        } catch (error) {
          console.error(
            "[Analysis Worker] Error closing Redis connection:",
            error,
          );

          connection.disconnect();
        }
      }
    })();

    return shutdownPromise;
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  console.info("[Analysis Worker] Started successfully.");
}

startWorker().catch((error) => {
  console.error("[Analysis Worker] Failed to start:", error);
  process.exitCode = 1;
});

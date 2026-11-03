import dotenv from "dotenv";

dotenv.config({
  path: ".env.local",
});

import { Worker } from "bullmq";
import IORedis from "ioredis";

import {
  cleanupRepositoryReader,
  runJobStep,
} from "../src/app/api/lib/jobs/jobWorker";
import { loadJob, saveJobLifecycle } from "../src/app/api/lib/jobs/jobStore";
import { del } from "@vercel/blob";
import clientPromise from "../src/lib/mongoClient";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

async function cleanupCompletedArchive(job: {
  projectId: string;
  ownerId?: string;
}) {
  try {
    const db = (await clientPromise).db();

    const project = await db.collection("projects").findOne({
      projectId: job.projectId,
      ownerId: job.ownerId,
    });

    const pathname = project?.blobPathname;

    if (
      typeof pathname !== "string" ||
      !pathname.startsWith("repository-uploads/") ||
      !pathname.endsWith(".zip")
    ) {
      console.warn(
        "[ARCHIVE_CLEANUP_SKIPPED]",
        "Missing or invalid archive pathname",
        job.projectId,
      );

      return;
    }

    await del(pathname);

    await db.collection("projects").updateOne(
      {
        projectId: job.projectId,
        ownerId: job.ownerId,
        blobPathname: pathname,
      },
      {
        $unset: {
          blobPathname: "",
        },
      },
    );

    console.info("[ARCHIVE_CLEANUP_SUCCESS]", {
      projectId: job.projectId,
      pathname,
    });
  } catch (error) {
    console.error("[ARCHIVE_CLEANUP_FAILED]", {
      projectId: job.projectId,
      error,
    });
  }
}

new Worker(
  "analysis",
  async (bullJob) => {
    let job = await loadJob(bullJob.data.jobId);

    if (!job) {
      throw new Error(`Job not found: ${bullJob.data.jobId}`);
    }

    if (job.status === "done") {
      await cleanupCompletedArchive(job);
      return;
    }

    if (job.status === "cancelled") {
      return;
    }

    if (job.status === "error") {
      throw new Error(`Job is already in error state: ${job.id}`);
    }

    const maxAttempts =
      typeof bullJob.opts.attempts === "number" ? bullJob.opts.attempts : 1;

    await saveJobLifecycle({
      id: job.id,
      status: "running",
      message:
        bullJob.attemptsMade > 0
          ? `Retry attempt ${bullJob.attemptsMade + 1} started`
          : "Worker started",
      error: null,
    });

    while (job && job.status !== "done") {
      try {
        await runJobStep(job);
      } catch (error: unknown) {
        console.error("Worker step failed:", error);

        try {
          await cleanupRepositoryReader(job.id);
        } catch (cleanupError) {
          console.error("[WORKER_CLEANUP_ERROR]", cleanupError);
        }

        const willRetry = bullJob.attemptsMade + 1 < maxAttempts;

        const errorMessage =
          error instanceof Error
            ? error.message
            : "An unknown analysis error occurred";

        const errorDetails = {
          message: errorMessage,
          stack: error instanceof Error ? error.stack : undefined,
          time: Date.now(),
          attempt: bullJob.attemptsMade + 1,
          maxAttempts,
        };

        try {
          await saveJobLifecycle({
            id: job.id,
            status: willRetry ? "retrying" : "error",
            message: willRetry
              ? `Analysis failed. Retrying attempt ${
                  bullJob.attemptsMade + 2
                } of ${maxAttempts}...`
              : `Analysis failed after ${maxAttempts} attempts.`,
            error: errorDetails,
          });
        } catch (persistError) {
          console.error("[WORKER_ERROR_PERSISTENCE_FAILED]", persistError);
        }

        throw error;
      }

      await new Promise((r) => setImmediate(r));

      job = await loadJob(job.id);
    }

    if (job?.status === "done") {
      await cleanupCompletedArchive(job);
    }
  },
  {
    connection,
    concurrency: 1,
    lockDuration: 60000,
  },
);

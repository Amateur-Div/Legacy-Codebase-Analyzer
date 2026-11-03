"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({
    path: ".env.local",
});
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const jobWorker_1 = require("../src/app/api/lib/jobs/jobWorker");
const jobStore_1 = require("../src/app/api/lib/jobs/jobStore");
const blob_1 = require("@vercel/blob");
const mongoClient_1 = __importDefault(require("../src/lib/mongoClient"));
const connection = new ioredis_1.default(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
});
async function cleanupCompletedArchive(job) {
    try {
        const db = (await mongoClient_1.default).db();
        const project = await db.collection("projects").findOne({
            projectId: job.projectId,
            ownerId: job.ownerId,
        });
        const pathname = project === null || project === void 0 ? void 0 : project.blobPathname;
        if (typeof pathname !== "string" ||
            !pathname.startsWith("repository-uploads/") ||
            !pathname.endsWith(".zip")) {
            console.warn("[ARCHIVE_CLEANUP_SKIPPED]", "Missing or invalid archive pathname", job.projectId);
            return;
        }
        await (0, blob_1.del)(pathname);
        await db.collection("projects").updateOne({
            projectId: job.projectId,
            ownerId: job.ownerId,
            blobPathname: pathname,
        }, {
            $unset: {
                blobPathname: "",
            },
        });
        console.info("[ARCHIVE_CLEANUP_SUCCESS]", {
            projectId: job.projectId,
            pathname,
        });
    }
    catch (error) {
        console.error("[ARCHIVE_CLEANUP_FAILED]", {
            projectId: job.projectId,
            error,
        });
    }
}
new bullmq_1.Worker("analysis", async (bullJob) => {
    let job = await (0, jobStore_1.loadJob)(bullJob.data.jobId);
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
    const maxAttempts = typeof bullJob.opts.attempts === "number" ? bullJob.opts.attempts : 1;
    await (0, jobStore_1.saveJobLifecycle)({
        id: job.id,
        status: "running",
        message: bullJob.attemptsMade > 0
            ? `Retry attempt ${bullJob.attemptsMade + 1} started`
            : "Worker started",
        error: null,
    });
    while (job && job.status !== "done") {
        try {
            await (0, jobWorker_1.runJobStep)(job);
        }
        catch (error) {
            console.error("Worker step failed:", error);
            try {
                await (0, jobWorker_1.cleanupRepositoryReader)(job.id);
            }
            catch (cleanupError) {
                console.error("[WORKER_CLEANUP_ERROR]", cleanupError);
            }
            const willRetry = bullJob.attemptsMade + 1 < maxAttempts;
            const errorMessage = error instanceof Error
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
                await (0, jobStore_1.saveJobLifecycle)({
                    id: job.id,
                    status: willRetry ? "retrying" : "error",
                    message: willRetry
                        ? `Analysis failed. Retrying attempt ${bullJob.attemptsMade + 2} of ${maxAttempts}...`
                        : `Analysis failed after ${maxAttempts} attempts.`,
                    error: errorDetails,
                });
            }
            catch (persistError) {
                console.error("[WORKER_ERROR_PERSISTENCE_FAILED]", persistError);
            }
            throw error;
        }
        await new Promise((r) => setImmediate(r));
        job = await (0, jobStore_1.loadJob)(job.id);
    }
    if ((job === null || job === void 0 ? void 0 : job.status) === "done") {
        await cleanupCompletedArchive(job);
    }
}, {
    connection,
    concurrency: 1,
    lockDuration: 60000,
});

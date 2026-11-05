import type { Job } from "./jobManager";
import clientPromise from "../../../../lib/mongoClient";

const COLLECTION = "jobs";

export async function saveJob(job: Partial<Job> & { id: string }) {
  const db = (await clientPromise).db();
  const collection = db.collection(COLLECTION);

  const { id, ...updates } = job;

  await collection.updateOne({ id }, { $set: updates }, { upsert: true });
}

const ALLOWED_TRANSITIONS: Record<Job["status"], Job["status"][]> = {
  initialized: ["running", "cancelled", "error"],
  running: ["running", "retrying", "done", "error", "cancelled"],
  retrying: ["running", "error", "cancelled"],
  done: [],
  error: [],
  cancelled: [],
};

export function isAllowedJobTransition(
  expectedStatus: Job["status"],
  nextStatus: Job["status"],
): boolean {
  return ALLOWED_TRANSITIONS[expectedStatus].includes(nextStatus);
}

export async function saveJobLifecycle(
  job: Partial<Job> & {
    id: string;
    status: Job["status"];
  },
  expectedStatus: Job["status"],
): Promise<boolean> {
  if (!isAllowedJobTransition(expectedStatus, job.status)) {
    throw new Error(
      `Invalid job status transition: ${expectedStatus} -> ${job.status}`,
    );
  }

  const db = (await clientPromise).db();
  const collection = db.collection(COLLECTION);

  const existingJob = await collection.findOne(
    { id: job.id },
    {
      projection: {
        projectId: 1,
        ownerId: 1,
        status: 1,
      },
    },
  );

  if (!existingJob) {
    return false;
  }

  if (
    typeof existingJob.projectId !== "string" ||
    typeof existingJob.ownerId !== "string"
  ) {
    throw new Error(`Job ${job.id} is missing project or owner scope`);
  }

  const { id, status, ...updates } = job;

  const result = await collection.updateOne(
    {
      id,
      projectId: existingJob.projectId,
      ownerId: existingJob.ownerId,
      status: expectedStatus,
    },
    {
      $set: {
        ...updates,
        status,
      },
    },
  );

  return result.matchedCount === 1;
}

export async function loadJob(jobId: string): Promise<Job | null> {
  const db = (await clientPromise).db();
  const collection = db.collection(COLLECTION);
  const job = await collection.findOne({ id: jobId });
  return job as unknown as Job | null;
}

export async function loadJobForOwner(
  jobId: string,
  ownerId: string,
): Promise<Job | null> {
  const db = (await clientPromise).db();
  const collection = db.collection(COLLECTION);
  const job = await collection.findOne({ id: jobId, ownerId });
  return job as unknown as Job | null;
}

export async function listJobs(projectId: string, ownerId?: string) {
  const db = (await clientPromise).db();
  const collection = db.collection(COLLECTION);
  const q: any = { projectId };
  if (ownerId) q.ownerId = ownerId;
  return collection.find(q).sort({ createdAt: -1 }).limit(50).toArray();
}

export async function deleteOldJobs(days = 7) {
  const db = await clientPromise.then((client) => client.db());
  const collection = db.collection(COLLECTION);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  await collection.deleteMany({
    createdAt: { $lt: cutoff },
  });
}

export async function hasProjectFileMetadata(
  db: any,
  projectId: string,
  filePath: string,
): Promise<boolean> {
  const existing = await db.collection("project_files").findOne(
    {
      projectId,
      path: filePath,
    },
    {
      projection: { _id: 1 },
    },
  );

  return Boolean(existing);
}

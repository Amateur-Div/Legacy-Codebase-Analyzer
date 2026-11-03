import { v4 as uuidv4 } from "uuid";
import { saveJob, loadJob } from "./jobStore";

type JobStatus =
  | "initialized"
  | "running"
  | "retrying"
  | "done"
  | "error"
  | "cancelled";

type JobStep =
  | "initializing"
  | "extract"
  | "scan"
  | "metadata"
  | "ingest"
  | "file-analysis"
  | "analyze"
  | "merge"
  | "enrich"
  | "save"
  | "done";

export type Job = {
  id: string;
  projectId: string;
  ownerId?: string;
  createdAt: number;

  status: JobStatus;
  extractedPath?: string;
  step: JobStep;

  cursor: number;
  totalFiles: number;

  scanFiles?: string[];
  scanCursor?: number;

  progress: number;
  message?: string;

  locked?: boolean;
  totalStoredBytes?: number;

  ingestCursor?: number;
  ingestFiles?: string[];

  analysisCursor?: number;
  analysisFiles?: string[];

  result?: any;
  error?: any;
};

export async function createJob(
  projectId: string,
  ownerId?: string,
  totalFiles = 0,
  jobId?: string,
): Promise<Job> {
  const id = jobId ?? uuidv4();

  const existingJob = await loadJob(id);
  if (existingJob) {
    if (existingJob.projectId !== projectId) {
      throw new Error(
        `Job ID ${id} is already associated with another project`,
      );
    }

    return existingJob;
  }

  const job: Job = {
    id,
    projectId,
    ownerId,
    createdAt: Date.now(),

    status: "initialized",
    step: "initializing",

    cursor: 0,
    totalFiles,

    progress: 0,
    message: "initialized",
  };

  await saveJob(job);

  return job;
}

export async function getJob(jobId: string): Promise<Job | null> {
  return loadJob(jobId);
}

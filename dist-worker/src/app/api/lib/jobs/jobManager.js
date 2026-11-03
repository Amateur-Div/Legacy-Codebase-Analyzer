"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJob = createJob;
exports.getJob = getJob;
const uuid_1 = require("uuid");
const jobStore_1 = require("./jobStore");
async function createJob(projectId, ownerId, totalFiles = 0, jobId) {
    const id = jobId !== null && jobId !== void 0 ? jobId : (0, uuid_1.v4)();
    const existingJob = await (0, jobStore_1.loadJob)(id);
    if (existingJob) {
        if (existingJob.projectId !== projectId) {
            throw new Error(`Job ID ${id} is already associated with another project`);
        }
        return existingJob;
    }
    const job = {
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
    await (0, jobStore_1.saveJob)(job);
    return job;
}
async function getJob(jobId) {
    return (0, jobStore_1.loadJob)(jobId);
}

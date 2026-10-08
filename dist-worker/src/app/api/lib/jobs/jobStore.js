"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveJob = saveJob;
exports.loadJob = loadJob;
exports.loadJobForOwner = loadJobForOwner;
exports.listJobs = listJobs;
exports.deleteOldJobs = deleteOldJobs;
exports.hasProjectFileMetadata = hasProjectFileMetadata;
const mongoClient_1 = __importDefault(require("../../../../lib/mongoClient"));
const COLLECTION = "jobs";
async function saveJob(job) {
    const db = (await mongoClient_1.default).db();
    const collection = db.collection(COLLECTION);
    const { id, ...updates } = job;
    await collection.updateOne({ id }, { $set: updates }, { upsert: true });
}
async function loadJob(jobId) {
    const db = (await mongoClient_1.default).db();
    const collection = db.collection(COLLECTION);
    const job = await collection.findOne({ id: jobId });
    return job;
}
async function loadJobForOwner(jobId, ownerId) {
    const db = (await mongoClient_1.default).db();
    const collection = db.collection(COLLECTION);
    const job = await collection.findOne({ id: jobId, ownerId });
    return job;
}
async function listJobs(projectId, ownerId) {
    const db = (await mongoClient_1.default).db();
    const collection = db.collection(COLLECTION);
    const q = { projectId };
    if (ownerId)
        q.ownerId = ownerId;
    return collection.find(q).sort({ createdAt: -1 }).limit(50).toArray();
}
async function deleteOldJobs(days = 7) {
    const db = await mongoClient_1.default.then((client) => client.db());
    const collection = db.collection(COLLECTION);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    await collection.deleteMany({
        createdAt: { $lt: cutoff },
    });
}
async function hasProjectFileMetadata(db, projectId, filePath) {
    const existing = await db.collection("project_files").findOne({
        projectId,
        path: filePath,
    }, {
        projection: { _id: 1 },
    });
    return Boolean(existing);
}

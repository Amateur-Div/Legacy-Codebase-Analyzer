"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureFileGraphIndexes = ensureFileGraphIndexes;
exports.saveFileGraph = saveFileGraph;
exports.saveFileGraphs = saveFileGraphs;
exports.getFileGraph = getFileGraph;
exports.getFileGraphs = getFileGraphs;
exports.deleteFileGraphs = deleteFileGraphs;
exports.deleteStaleFileGraphs = deleteStaleFileGraphs;
const mongoClient_1 = __importDefault(require("../../../../lib/mongoClient"));
const FILE_GRAPH_COLLECTION = "file_graphs";
async function ensureFileGraphIndexes() {
    const client = await mongoClient_1.default;
    const db = client.db();
    const fileGraphs = db.collection(FILE_GRAPH_COLLECTION);
    await fileGraphs.createIndex({ projectId: 1, filePath: 1 }, {
        unique: true,
        name: "unique_project_file_graph",
    });
    await fileGraphs.createIndex({ ownerId: 1, projectId: 1 }, {
        name: "owner_project_file_graphs",
    });
}
function compactEdgesForStorage(nodes, edges) {
    const nodeIndexById = new Map();
    nodes.forEach((node, index) => {
        nodeIndexById.set(node.id, index);
    });
    return edges.map(({ from, to, label }) => {
        const fromIndex = nodeIndexById.get(from);
        const toIndex = nodeIndexById.get(to);
        if (fromIndex === undefined || toIndex === undefined) {
            throw new Error(`Invalid file graph edge reference: ${from} -> ${to}`);
        }
        return {
            from: fromIndex,
            to: toIndex,
            ...(label !== undefined ? { label } : {}),
        };
    });
}
function restoreEdgeIds(edges, nodes) {
    return edges.map((edge) => {
        const fromNode = nodes[edge.from];
        const toNode = nodes[edge.to];
        if (!fromNode || !toNode) {
            throw new Error(`Invalid stored edge indexes: ${edge.from} -> ${edge.to}`);
        }
        return {
            ...edge,
            from: fromNode.id,
            to: toNode.id,
            id: `${fromNode.id}->${toNode.id}`,
        };
    });
}
async function saveFileGraph(projectId, filePath, graph, ownerId) {
    const client = await mongoClient_1.default;
    const db = client.db();
    const col = db.collection(FILE_GRAPH_COLLECTION);
    const now = new Date();
    await col.updateOne({ projectId, filePath }, {
        $setOnInsert: {
            projectId,
            filePath,
            createdAt: now,
        },
        $set: {
            ownerId,
            nodes: graph.nodes,
            edges: compactEdgesForStorage(graph.nodes, graph.edges),
            meta: graph.meta,
            updatedAt: now,
        },
    }, { upsert: true });
}
async function saveFileGraphs(projectId, graphs, ownerId) {
    if (graphs.length === 0)
        return;
    const client = await mongoClient_1.default;
    const db = client.db();
    const col = db.collection(FILE_GRAPH_COLLECTION);
    const now = new Date();
    const operations = graphs.map((graph) => ({
        updateOne: {
            filter: {
                projectId,
                filePath: graph.filePath,
            },
            update: {
                $setOnInsert: {
                    projectId,
                    filePath: graph.filePath,
                    createdAt: now,
                },
                $set: {
                    ownerId,
                    nodes: graph.nodes,
                    edges: compactEdgesForStorage(graph.nodes, graph.edges),
                    meta: graph.meta,
                    updatedAt: now,
                },
            },
            upsert: true,
        },
    }));
    await col.bulkWrite(operations, { ordered: false });
}
async function getFileGraph(projectId, filePath, ownerId) {
    var _a, _b;
    const client = await mongoClient_1.default;
    const db = client.db();
    const filter = { projectId, filePath };
    if (ownerId) {
        filter.ownerId = ownerId;
    }
    const doc = await db.collection(FILE_GRAPH_COLLECTION).findOne(filter);
    if (!doc) {
        return null;
    }
    return {
        ...doc,
        edges: restoreEdgeIds((_a = doc.edges) !== null && _a !== void 0 ? _a : [], (_b = doc.nodes) !== null && _b !== void 0 ? _b : []),
    };
}
async function getFileGraphs(projectId, ownerId) {
    const client = await mongoClient_1.default;
    const db = client.db();
    const filter = { projectId };
    if (ownerId) {
        filter.ownerId = ownerId;
    }
    const docs = await db
        .collection(FILE_GRAPH_COLLECTION)
        .find(filter)
        .sort({ filePath: 1 })
        .toArray();
    return docs.map((doc) => {
        var _a, _b;
        return ({
            ...doc,
            edges: restoreEdgeIds((_a = doc.edges) !== null && _a !== void 0 ? _a : [], (_b = doc.nodes) !== null && _b !== void 0 ? _b : []),
        });
    });
}
async function deleteFileGraphs(projectId, ownerId) {
    const client = await mongoClient_1.default;
    const db = client.db();
    const filter = { projectId };
    if (ownerId) {
        filter.ownerId = ownerId;
    }
    return db.collection(FILE_GRAPH_COLLECTION).deleteMany(filter);
}
async function deleteStaleFileGraphs(projectId, activeFilePaths, ownerId) {
    const client = await mongoClient_1.default;
    const db = client.db();
    const filter = {
        projectId,
        filePath: { $nin: activeFilePaths },
    };
    if (ownerId) {
        filter.ownerId = ownerId;
    }
    return db.collection(FILE_GRAPH_COLLECTION).deleteMany(filter);
}

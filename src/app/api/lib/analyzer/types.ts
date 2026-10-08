export type FlowNodeSemantic = {
  complexity?: number;
  importance?: number;
  dead?: boolean;

  connectivity?: {
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    score: number;
  };

  structure?: {
    importCount: number;
    exportCount: number;
    functionCount: number;
    classCount: number;
    componentCount: number;
    apiCount: number;
    schemaCount: number;
    blockCount: number;
  };
};

export type FlowNode = {
  id: string;
  type: string;
  name?: string;
  file?: string;
  line?: number;
  code?: string;
  semantic?: FlowNodeSemantic;
  meta?: Record<string, any>;
};

export type StoredFlowEdge = {
  from: number;
  to: number;
  label?: string;
};

export type FlowEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

export type FileConnectivityMetrics = {
  fileId: string;
  filePath: string;
  inDegree: number;
  outDegree: number;
  totalDegree: number;
  score: number;
};

export type DependencyIntelligence = {
  deadFiles: string[];
  circularDependencies: string[][];
  importanceRanking: {
    fileId: string;
    score: number;
  }[];
};

export type DependencyAnalysisStats = {
  fileCount: number;
  executionNodeCount: number;
  executionEdgeCount: number;
  dependencyCount: number;
  missingDependencyCount: number;
};

export type ProjectDependencyAnalysis = {
  version: number;
  generatedAt: Date;

  stats: DependencyAnalysisStats;
  fileMetrics: FileConnectivityMetrics[];

  intelligence: DependencyIntelligence;
};

export type FlowGraphMeta = {
  file?: string;

  layer?: string;

  entryNodeIds?: string[];

  projectId?: string;

  nodeCount?: number;
  edgeCount?: number;

  mode?: "execution" | string | null;

  generatedAt?: Date;
};

export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  meta?: FlowGraphMeta;
};

import type { CallGraphExtraction } from "./callGraphExtractor";
import {
  resolveModule,
  type ModuleResolution,
  type ModuleResolverConfig,
} from "./buildCrossFileImpactMap";

export type ResolvedCallEdge = {
  id: string;
  type: "calls";
  fromSymbolId: string;
  toSymbolId: string;
  fromFilePath: string;
  toFilePath: string;
  callSiteId: string;
  line: number;
  calleeText: string;
  resolution: "same-file" | "imported";
  confidence: "high";
};

export type CallGraphResolutionResult = {
  files: CallGraphExtraction[];
  edges: ResolvedCallEdge[];
  diagnostics: Array<{
    filePath: string;
    callSiteId: string;
    kind:
      | "external-module"
      | "unresolved-module"
      | "unresolved-export"
      | "missing-caller";
    message: string;
  }>;
};

type ResolveOptions = {
  repoRoot: string;
  resolverConfig?: ModuleResolverConfig;
};

export function resolveCallGraph(
  inputGraphs: CallGraphExtraction[],
  options: ResolveOptions,
): CallGraphResolutionResult {
  const graphsByPath = new Map(
    inputGraphs.map((graph) => [graph.filePath, graph]),
  );
  const fileLookup = new Map(
    inputGraphs.map((graph) => [graph.filePath, graph.filePath]),
  );
  const resolverConfig = options.resolverConfig ?? {};
  const diagnostics: CallGraphResolutionResult["diagnostics"] = [];
  const edges: ResolvedCallEdge[] = [];
  const symbolFileById = new Map<string, string>();
  for (const graph of inputGraphs) {
    for (const symbol of graph.symbols) {
      symbolFileById.set(symbol.id, graph.filePath);
    }
  }

  const moduleResolutionCache = new Map<string, ModuleResolution>();
  const resolveImportedModule = (
    importer: string,
    source: string,
  ): ModuleResolution => {
    const cacheKey = `${importer}::${source}`;
    const cached = moduleResolutionCache.get(cacheKey);
    if (cached) return cached;

    const resolution = resolveModule(
      importer,
      source,
      fileLookup,
      options.repoRoot,
      resolverConfig,
    );
    moduleResolutionCache.set(cacheKey, resolution);
    return resolution;
  };

  const exportResolutionCache = new Map<string, string | null>();

  const resolveExportedSymbol = (
    filePath: string,
    exportedName: string,
    visited: Set<string>,
  ): string | null => {
    const visitKey = `${filePath}::${exportedName}`;
    if (exportResolutionCache.has(visitKey)) {
      return exportResolutionCache.get(visitKey) ?? null;
    }
    if (visited.has(visitKey)) return null;
    visited.add(visitKey);

    const graph = graphsByPath.get(filePath);
    if (!graph) {
      exportResolutionCache.set(visitKey, null);
      return null;
    }

    const exported = graph.exports.find(
      (entry) => entry.exportedName === exportedName,
    );
    if (!exported) {
      exportResolutionCache.set(visitKey, null);
      return null;
    }

    let resolved: string | null = exported.targetSymbolId ?? null;

    if (!resolved && exported.kind === "reexport" && exported.source) {
      const moduleResolution = resolveImportedModule(filePath, exported.source);
      resolved = moduleResolution.kind === "internal"
        ? resolveExportedSymbol(
            moduleResolution.path,
            exported.importedName ?? exported.exportedName,
            visited,
          )
        : null;
    }

    // Handles: import { fn } from "./x"; export { fn as publicFn }.
    if (!resolved && exported.localName) {
      const imported = graph.imports.find(
        (entry) => entry.localName === exported.localName,
      );
      if (imported) {
        const moduleResolution = resolveImportedModule(filePath, imported.source);
        resolved = moduleResolution.kind === "internal"
          ? resolveExportedSymbol(
              moduleResolution.path,
              imported.importedName,
              visited,
            )
          : null;
      }
    }

    exportResolutionCache.set(visitKey, resolved);
    return resolved;
  };

  const files = inputGraphs.map((graph) => ({
    ...graph,
    symbols: graph.symbols.map((symbol) => ({
      ...symbol,
      exportedAs: [...symbol.exportedAs],
    })),
    imports: [...graph.imports],
    exports: [...graph.exports],
    callSites: graph.callSites.map((callSite) => ({ ...callSite })),
    diagnostics: [...graph.diagnostics],
  }));

  for (const graph of files) {
    for (const callSite of graph.callSites) {
      let targetSymbolId = callSite.targetSymbolId;
      let resolution: ResolvedCallEdge["resolution"] | null = null;

      if (callSite.resolution === "local" && targetSymbolId) {
        resolution = "same-file";
      } else if (callSite.importedBinding) {
        const moduleResolution = resolveImportedModule(
          graph.filePath,
          callSite.importedBinding.source,
        );

        if (moduleResolution.kind === "external") {
          diagnostics.push({
            filePath: graph.filePath,
            callSiteId: callSite.id,
            kind: "external-module",
            message: `Call targets external dependency "${callSite.importedBinding.source}"`,
          });
          continue;
        }

        if (moduleResolution.kind === "unresolved") {
          diagnostics.push({
            filePath: graph.filePath,
            callSiteId: callSite.id,
            kind: "unresolved-module",
            message: `Unable to resolve internal module "${callSite.importedBinding.source}"`,
          });
          continue;
        }

        targetSymbolId = resolveExportedSymbol(
          moduleResolution.path,
          callSite.importedBinding.importedName,
          new Set<string>(),
        ) ?? undefined;

        if (!targetSymbolId) {
          diagnostics.push({
            filePath: graph.filePath,
            callSiteId: callSite.id,
            kind: "unresolved-export",
            message: `No statically resolvable export "${callSite.importedBinding.importedName}" in ${moduleResolution.path}`,
          });
          continue;
        }

        callSite.targetSymbolId = targetSymbolId;
        callSite.resolution = "resolved-import";
        resolution = "imported";
      }

      if (!targetSymbolId || !resolution) continue;

      const targetFilePath = symbolFileById.get(targetSymbolId);
      if (!targetFilePath) {
        diagnostics.push({
          filePath: graph.filePath,
          callSiteId: callSite.id,
          kind: "unresolved-export",
          message: `Resolved symbol "${targetSymbolId}" is not present in the indexed files`,
        });
        continue;
      }

      if (!callSite.callerSymbolId) {
        diagnostics.push({
          filePath: graph.filePath,
          callSiteId: callSite.id,
          kind: "missing-caller",
          message: "Call occurs outside a recognized function or method",
        });
        continue;
      }

      edges.push({
        id: `${callSite.id}->${targetSymbolId}`,
        type: "calls",
        fromSymbolId: callSite.callerSymbolId,
        toSymbolId: targetSymbolId,
        fromFilePath: graph.filePath,
        toFilePath: targetFilePath,
        callSiteId: callSite.id,
        line: callSite.line,
        calleeText: callSite.calleeText,
        resolution,
        confidence: "high",
      });
    }
  }

  return { files, edges, diagnostics };
}

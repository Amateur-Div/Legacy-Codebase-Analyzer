import path from "path";

type ForwardImpact = {
  imports: string[];
  brokenImports: { source: string }[];
};

export type ModuleResolution =
  | {
      kind: "internal";
      path: string;
      source: string;
    }
  | {
      kind: "external";
      source: string;
    }
  | {
      kind: "unresolved";
      source: string;
    };

export type TsPathMapping = {
  pattern: string;
  targets: string[];
};

export type ModuleResolverConfig = {
  baseUrl?: string;
  paths?: TsPathMapping[];
};

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

function stripSourceExtension(value: string): string {
  return value.replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/, "");
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

function isAliasPatternMatch(pattern: string, specifier: string): boolean {
  if (pattern === specifier) {
    return true;
  }

  if (!pattern.includes("*")) {
    return false;
  }

  const [prefix, suffix] = pattern.split("*");

  return specifier.startsWith(prefix) && specifier.endsWith(suffix);
}

function getAliasWildcardValue(
  pattern: string,
  specifier: string,
): string | null {
  const starIndex = pattern.indexOf("*");

  if (starIndex === -1) {
    return pattern === specifier ? "" : null;
  }

  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);

  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return null;
  }

  return specifier.slice(
    prefix.length,
    specifier.length - suffix.length || undefined,
  );
}

function expandPathTarget(target: string, wildcardValue: string): string {
  return target.replace(/\*/g, wildcardValue);
}

function candidatePaths(candidate: string): string[] {
  const normalized = path.posix.normalize(candidate);

  const hasExplicitSourceExtension = SOURCE_EXTENSIONS.some((extension) =>
    normalized.endsWith(extension),
  );

  if (hasExplicitSourceExtension) {
    return [normalized];
  }

  const candidates: string[] = [normalized, stripSourceExtension(normalized)];

  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(`${normalized}${extension}`);
  }

  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(`${stripSourceExtension(normalized)}${extension}`);
  }

  for (const extension of SOURCE_EXTENSIONS) {
    candidates.push(`${normalized}/index${extension}`);
  }

  return candidates;
}

function lookupInternalFile(
  candidate: string,
  fileLookup: Map<string, string>,
): string | null {
  for (const lookupCandidate of candidatePaths(candidate)) {
    const resolved = fileLookup.get(lookupCandidate);

    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveAlias(
  specifier: string,
  fileLookup: Map<string, string>,
  repoRoot: string,
  config: ModuleResolverConfig,
): string | null {
  for (const mapping of config.paths ?? []) {
    if (!isAliasPatternMatch(mapping.pattern, specifier)) {
      continue;
    }

    const wildcardValue =
      getAliasWildcardValue(mapping.pattern, specifier) ?? "";

    for (const target of mapping.targets) {
      const expandedTarget = expandPathTarget(target, wildcardValue);

      const baseUrl = config.baseUrl || ".";

      const candidate = path.posix.normalize(
        path.posix.join(repoRoot, baseUrl, expandedTarget),
      );

      const resolved = lookupInternalFile(candidate, fileLookup);

      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  return null;
}

export function resolveModule(
  importer: string,
  specifier: string,
  fileLookup: Map<string, string>,
  repoRoot: string,
  resolverConfig: ModuleResolverConfig = {},
): ModuleResolution {
  if (isRelativeSpecifier(specifier)) {
    const importerDir = path.posix.dirname(importer);

    const candidate = path.posix.normalize(
      path.posix.join(importerDir, specifier),
    );

    const resolved = lookupInternalFile(candidate, fileLookup);

    if (resolved) {
      return {
        kind: "internal",
        path: resolved,
        source: specifier,
      };
    }

    return {
      kind: "unresolved",
      source: specifier,
    };
  }

  const hasMatchingAlias = (resolverConfig.paths ?? []).some((mapping) =>
    isAliasPatternMatch(mapping.pattern, specifier),
  );

  if (hasMatchingAlias) {
    const resolved = resolveAlias(
      specifier,
      fileLookup,
      repoRoot,
      resolverConfig,
    );

    if (resolved) {
      return {
        kind: "internal",
        path: resolved,
        source: specifier,
      };
    }

    return {
      kind: "unresolved",
      source: specifier,
    };
  }

  if (resolverConfig.baseUrl) {
    const candidate = path.posix.normalize(
      path.posix.join(repoRoot, resolverConfig.baseUrl, specifier),
    );

    const resolved = lookupInternalFile(candidate, fileLookup);

    if (resolved) {
      return {
        kind: "internal",
        path: resolved,
        source: specifier,
      };
    }
  }

  return {
    kind: "external",
    source: specifier,
  };
}

export function attachCrossFileImpact(
  fileTree: any[],
  resolverConfig: ModuleResolverConfig = {},
) {
  const files: {
    relPath: string;
    imports: string[];
    nodeRef: any;
  }[] = [];

  const collect = (nodes: any[]) => {
    for (const node of nodes) {
      if (!node) continue;

      if (node.type === "file") {
        const imports = Array.isArray(node.imports)
          ? node.imports
              .map((i: any) => (typeof i === "string" ? i : i?.name))
              .filter(
                (imp: unknown): imp is string =>
                  typeof imp === "string" && imp.length > 0,
              )
          : [];

        files.push({
          relPath: node.fullPath,
          imports,
          nodeRef: node,
        });
      } else if (Array.isArray(node.children)) {
        collect(node.children);
      }
    }
  };

  collect(fileTree);

  const repoRoot = files.length ? files[0].relPath.split("/")[0] : "";

  const fileLookup = new Map<string, string>();

  for (const file of files) {
    const normalizedPath = path.posix.normalize(file.relPath);

    fileLookup.set(normalizedPath, file.relPath);

    fileLookup.set(stripSourceExtension(normalizedPath), file.relPath);
  }

  const forwardMap: Record<string, ForwardImpact> = {};
  const reverseMap: Record<string, string[]> = {};

  for (const { relPath, imports } of files) {
    const resolvedImports: string[] = [];
    const brokenImports: { source: string }[] = [];

    for (const specifier of imports) {
      const resolution = resolveModule(
        relPath,
        specifier,
        fileLookup,
        repoRoot,
        resolverConfig,
      );

      if (resolution.kind === "external") {
        continue;
      }

      if (resolution.kind === "unresolved") {
        brokenImports.push({
          source: specifier,
        });
        continue;
      }

      const resolved = resolution.path;

      if (!resolved || resolved === relPath) {
        continue;
      }

      if (!resolvedImports.includes(resolved)) {
        resolvedImports.push(resolved);
      }

      if (!reverseMap[resolved]) {
        reverseMap[resolved] = [];
      }

      if (!reverseMap[resolved].includes(relPath)) {
        reverseMap[resolved].push(relPath);
      }
    }

    forwardMap[relPath] = {
      imports: resolvedImports,
      brokenImports,
    };
  }

  for (const { relPath, nodeRef } of files) {
    nodeRef.impact = {
      imports: forwardMap[relPath]?.imports ?? [],
      usedBy: reverseMap[relPath] ?? [],
      brokenImports: forwardMap[relPath]?.brokenImports ?? [],
    };
  }

  console.log(
    `[impact] attached forward=${Object.keys(forwardMap).length}, reverse=${
      Object.keys(reverseMap).length
    }`,
  );

  return fileTree;
}

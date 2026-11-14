import * as babelParser from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export type CallableSymbolKind =
  | "function"
  | "arrow"
  | "function-expression"
  | "method"
  | "callback";

export type CallResolution = "local" | "imported" | "unresolved" | "dynamic";

export interface CallableSymbol {
  id: string;
  name: string;
  kind: CallableSymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  isExported: boolean;
  exportedAs: string[];
}

export interface ImportedBinding {
  source: string;
  localName: string;
  importedName: string;
  kind: "named" | "default" | "namespace";
  line: number;
}

export interface ExportedBinding {
  exportedName: string;
  localName?: string;
  targetSymbolId?: string;
  source?: string;
  importedName?: string;
  kind: "local" | "reexport" | "default";
  line: number;
}

export interface ExtractedCallSite {
  id: string;
  callerSymbolId: string | null;
  calleeText: string;
  calleeKind: "identifier" | "member" | "constructor" | "dynamic";
  targetSymbolId?: string;
  importedBinding?: {
    source: string;
    localName: string;
    importedName: string;
    kind: ImportedBinding["kind"];
  };
  resolution: CallResolution;
  line: number;
  column: number;
  startOffset: number;
}

export interface CallGraphExtraction {
  schemaVersion: 1;
  filePath: string;
  symbols: CallableSymbol[];
  imports: ImportedBinding[];
  exports: ExportedBinding[];
  callSites: ExtractedCallSite[];
  diagnostics: Array<{
    kind: "parse-error";
    message: string;
    line?: number;
    column?: number;
  }>;
}

const CALLABLE_NODE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

const normalizePath = (filePath: string) => filePath.replace(/\\/g, "/");

function getPropertyName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier" || node.type === "PrivateName") {
    return node.id?.name ?? node.name ?? null;
  }
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") {
    return String(node.value);
  }
  return null;
}

function getCallableName(path: NodePath<any>): string {
  const node = path.node;
  if (node.id?.name) return node.id.name;

  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && parent.node.id.type === "Identifier") {
    return parent.node.id.name;
  }
  if (parent?.isAssignmentExpression()) {
    const left = parent.node.left;
    if (left.type === "Identifier") return left.name;
    if (left.type === "MemberExpression") {
      return getPropertyName(left.property) ?? "assignedFunction";
    }
  }
  if (
    parent?.isObjectProperty() ||
    parent?.isClassProperty() ||
    parent?.isClassPrivateProperty()
  ) {
    return getPropertyName(parent.node.key) ?? "callback";
  }
  if (node.key) return getPropertyName(node.key) ?? "method";

  const line = node.loc?.start.line ?? 0;
  return `anonymous@${line}`;
}

function getCallableKind(path: NodePath<any>): CallableSymbolKind {
  const type = path.node.type;
  if (type === "ArrowFunctionExpression") {
    return path.parentPath?.isVariableDeclarator() ? "arrow" : "callback";
  }
  if (type === "FunctionExpression") {
    return path.node.id?.name ? "function-expression" : "callback";
  }
  if (
    type === "ObjectMethod" ||
    type === "ClassMethod" ||
    type === "ClassPrivateMethod"
  ) {
    return "method";
  }
  return "function";
}

function getCalleeText(node: any): string {
  if (!node) return "<unknown>";
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "ThisExpression":
      return "this";
    case "Super":
      return "super";
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const object = getCalleeText(node.object);
      const property = node.computed
        ? `[${getCalleeText(node.property)}]`
        : `.${getCalleeText(node.property)}`;
      return `${object}${property}`;
    }
    case "PrivateName":
      return `#${node.id?.name ?? "private"}`;
    default:
      return node.type ?? "<dynamic>";
  }
}

function getRootIdentifier(node: any): string | null {
  let current = node;
  while (
    current &&
    (current.type === "MemberExpression" ||
      current.type === "OptionalMemberExpression")
  ) {
    current = current.object;
  }
  return current?.type === "Identifier" ? current.name : null;
}

function getSymbolForBinding(
  binding: any,
  symbolByNode: Map<t.Node, CallableSymbol>,
): CallableSymbol | undefined {
  if (!binding?.path) return undefined;
  const bindingNode = binding.path.node as t.Node;
  const direct = symbolByNode.get(bindingNode);
  if (direct) return direct;

  if (binding.path.isVariableDeclarator?.()) {
    const init = binding.path.node.init;
    if (init) return symbolByNode.get(init);
  }
  return undefined;
}

export function extractCallGraphBabel(
  inputFilePath: string,
  code: string,
): CallGraphExtraction {
  const filePath = normalizePath(inputFilePath);
  const empty: CallGraphExtraction = {
    schemaVersion: 1,
    filePath,
    symbols: [],
    imports: [],
    exports: [],
    callSites: [],
    diagnostics: [],
  };

  if (!code.trim()) return empty;

  let ast: ReturnType<typeof babelParser.parse>;
  try {
    ast = babelParser.parse(code, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: [
        "typescript",
        "jsx",
        ["decorators", { decoratorsBeforeExport: false }],
        "classProperties",
        "classPrivateProperties",
        "classPrivateMethods",
        "dynamicImport",
        "optionalChaining",
        "nullishCoalescingOperator",
      ],
    });
  } catch (error: any) {
    return {
      ...empty,
      diagnostics: [{
        kind: "parse-error",
        message: error?.message ?? "Unable to parse source file",
        line: error?.loc?.line,
        column: error?.loc?.column,
      }],
    };
  }

  const symbolByNode = new Map<t.Node, CallableSymbol>();
  const symbols: CallableSymbol[] = [];
  const imports: ImportedBinding[] = [];
  const importByLocalName = new Map<string, ImportedBinding>();
  const exports: ExportedBinding[] = [];
  const exportedNamesBySymbol = new Map<string, Set<string>>();

  // Pass 1: establish stable callable identities and module bindings.
  traverse(ast, {
    enter(path: NodePath<any>) {
      const node = path.node;

      if (CALLABLE_NODE_TYPES.has(node.type)) {
        const startOffset = node.start ?? 0;
        const endOffset = node.end ?? startOffset;
        const kind = getCallableKind(path);
        const id = `${filePath}::${kind}::${startOffset}`;
        const symbol: CallableSymbol = {
          id,
          name: getCallableName(path),
          kind,
          filePath,
          startLine: node.loc?.start.line ?? 0,
          endLine: node.loc?.end.line ?? node.loc?.start.line ?? 0,
          startOffset,
          endOffset,
          isExported: false,
          exportedAs: [],
        };
        symbolByNode.set(node, symbol);
        symbols.push(symbol);
      }

      if (node.type === "ImportDeclaration") {
        for (const specifier of node.specifiers ?? []) {
          const kind =
            specifier.type === "ImportDefaultSpecifier"
              ? "default"
              : specifier.type === "ImportNamespaceSpecifier"
                ? "namespace"
                : "named";
          const importedName =
            kind === "default"
              ? "default"
              : kind === "namespace"
                ? "*"
                : getPropertyName(specifier.imported) ?? "unknown";
          const binding: ImportedBinding = {
            source: node.source.value,
            localName: specifier.local.name,
            importedName,
            kind,
            line: specifier.loc?.start.line ?? node.loc?.start.line ?? 0,
          };
          imports.push(binding);
          importByLocalName.set(binding.localName, binding);
        }
      }
    },
  });

  const addExport = (entry: ExportedBinding) => {
    exports.push(entry);
    if (entry.targetSymbolId) {
      const names = exportedNamesBySymbol.get(entry.targetSymbolId) ?? new Set<string>();
      names.add(entry.exportedName);
      exportedNamesBySymbol.set(entry.targetSymbolId, names);
    }
  };

  // Pass 2: collect direct exports and re-exports.
  traverse(ast, {
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      const node = path.node;
      const line = node.loc?.start.line ?? 0;

      if (node.source) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ExportSpecifier") continue;
          addExport({
            exportedName: getPropertyName(specifier.exported) ?? "unknown",
            localName: getPropertyName(specifier.local) ?? undefined,
            source: node.source.value,
            importedName: getPropertyName(specifier.local) ?? "unknown",
            kind: "reexport",
            line,
          });
        }
        return;
      }

      const declaration = node.declaration;
      if (!declaration) {
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ExportSpecifier") continue;
          addExport({
            exportedName: getPropertyName(specifier.exported) ?? "unknown",
            localName: getPropertyName(specifier.local) ?? undefined,
            kind: "local",
            line,
          });
        }
        return;
      }

      if (declaration.type === "FunctionDeclaration") {
        const symbol = symbolByNode.get(declaration);
        if (symbol) {
          addExport({
            exportedName: symbol.name,
            localName: symbol.name,
            targetSymbolId: symbol.id,
            kind: "local",
            line,
          });
        }
      } else if (declaration.type === "VariableDeclaration") {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type !== "Identifier" || !declarator.init) continue;
          const symbol = symbolByNode.get(declarator.init);
          if (symbol) {
            addExport({
              exportedName: declarator.id.name,
              localName: declarator.id.name,
              targetSymbolId: symbol.id,
              kind: "local",
              line,
            });
          }
        }
      }
    },
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      const declaration = path.node.declaration;
      const symbol = symbolByNode.get(declaration as t.Node);
      addExport({
        exportedName: "default",
        localName:
          (declaration as any)?.id?.name ??
          (declaration.type === "Identifier" ? declaration.name : undefined),
        targetSymbolId: symbol?.id,
        kind: "default",
        line: path.node.loc?.start.line ?? 0,
      });
    },
  });

  for (const symbol of symbols) {
    const names = exportedNamesBySymbol.get(symbol.id);
    if (names?.size) {
      symbol.isExported = true;
      symbol.exportedAs = [...names].sort();
    }
  }

  // Pass 3: collect call sites and resolve lexical local/import bindings.
  const callSites: ExtractedCallSite[] = [];
  traverse(ast, {
    enter(path: NodePath<any>) {
      const node = path.node;
      const isCall =
        node.type === "CallExpression" ||
        node.type === "OptionalCallExpression" ||
        node.type === "NewExpression";
      if (!isCall) return;

      const callee = node.callee;
      const isIdentifier = callee?.type === "Identifier";
      const isMember =
        callee?.type === "MemberExpression" ||
        callee?.type === "OptionalMemberExpression";
      const calleeKind = node.type === "NewExpression"
        ? "constructor"
        : isIdentifier
          ? "identifier"
          : isMember
            ? "member"
            : "dynamic";

      const callerPath = path.findParent((parent) =>
        CALLABLE_NODE_TYPES.has(parent.node.type),
      );
      const caller = callerPath
        ? symbolByNode.get(callerPath.node)
        : undefined;

      let targetSymbol: CallableSymbol | undefined;
      let importedBinding: ExtractedCallSite["importedBinding"];
      let resolution: CallResolution = calleeKind === "dynamic"
        ? "dynamic"
        : "unresolved";

      const rootIdentifier = isIdentifier
        ? callee.name
        : isMember
          ? getRootIdentifier(callee)
          : null;

      if (rootIdentifier) {
        const binding = path.scope.getBinding(rootIdentifier);
        targetSymbol = isIdentifier
          ? getSymbolForBinding(binding, symbolByNode)
          : undefined;

        const imported = importByLocalName.get(rootIdentifier);
        if (imported && binding?.path?.isImportSpecifier?.()) {
          importedBinding = {
            source: imported.source,
            localName: imported.localName,
            importedName:
              imported.kind === "namespace" && isMember
                ? getPropertyName(callee.property) ?? "*"
                : imported.importedName,
            kind: imported.kind,
          };
          resolution = "imported";
        } else if (targetSymbol) {
          resolution = "local";
        }
      }

      const startOffset = node.start ?? 0;
      callSites.push({
        id: `${filePath}::call::${startOffset}`,
        callerSymbolId: caller?.id ?? null,
        calleeText: getCalleeText(callee),
        calleeKind,
        ...(targetSymbol ? { targetSymbolId: targetSymbol.id } : {}),
        ...(importedBinding ? { importedBinding } : {}),
        resolution,
        line: node.loc?.start.line ?? 0,
        column: node.loc?.start.column ?? 0,
        startOffset,
      });
    },
  });

  symbols.sort((a, b) => a.startOffset - b.startOffset);
  callSites.sort((a, b) => a.startOffset - b.startOffset);

  return {
    schemaVersion: 1,
    filePath,
    symbols,
    imports,
    exports,
    callSites,
    diagnostics: [],
  };
}

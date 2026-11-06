import * as babelParser from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import {
  FunctionDeclaration,
  VariableDeclarator,
  ExportNamedDeclaration,
  ExportDefaultDeclaration,
  AssignmentExpression,
  TSInterfaceDeclaration,
  TSTypeAliasDeclaration,
  isImportDeclaration,
  isCallExpression,
  isStringLiteral,
  BlockStatement,
  IfStatement,
  ForStatement,
  WhileStatement,
  SwitchStatement,
  TryStatement,
  ObjectExpression,
  JSXElement,
  CatchClause,
  Node,
  ArrowFunctionExpression,
  FunctionExpression,
  Expression,
  LVal,
  MemberExpression,
  Identifier,
  StringLiteral,
  NumericLiteral,
  CallExpression,
  ObjectProperty,
  ClassDeclaration,
  ReturnStatement,
  TSModuleBlock,
  TSTypeLiteral,
} from "@babel/types";

interface ExtractContext {
  filePath: string;
  code: string;

  imports: SymbolInfo[];
  functions: SymbolInfo[];
  classes: SymbolInfo[];
  components: SymbolInfo[];
  interfaces: SymbolInfo[];
  exports: SymbolInfo[];
  blocks: SymbolInfo[];
  apis: ApiInfo[];
  schemas: SchemaInfo[];

  seen: {
    imports: Set<string>;
    functions: Set<string>;
    classes: Set<string>;
    interfaces: Set<string>;
    components: Set<string>;
    exports: Set<string>;
    blocks: Set<string>;
    apis: Set<string>;
    schemas: Set<string>;
  };

  errors: {
    message: string;
    line?: number;
    column?: number;
  }[];
}

export interface ExtractStructureResult {
  imports: SymbolInfo[];
  functions: SymbolInfo[];
  classes: SymbolInfo[];
  components: SymbolInfo[];
  interfaces: SymbolInfo[];
  exports: SymbolInfo[];
  blocks: SymbolInfo[];
  apis: ApiInfo[];
  schemas: SchemaInfo[];
  errors?: {
    message: string;
    line?: number;
    column?: number;
  }[];
}

type ApiFramework = "express" | "next" | "nestjs" | "unknown" | string;
type SchemaFramework = "mongoose" | "prisma" | "zod" | "yup" | "ts";
type SymbolType = "function" | "class" | "interface";

interface ApiInfo {
  id: string;
  method: string;
  path: string;
  start: number;
  end: number | null;
  framework: ApiFramework;
  controller?: string | null;
}

interface SchemaField {
  name: string;
  type?: string | null;
  raw?: string;
  auto: boolean;
  children?: SchemaField[];
}

interface SchemaInfo {
  id: string;
  name: string;
  framework: SchemaFramework;
  start: number;
  end: number | null;
  fields?: SchemaField[];
}

interface SymbolInfo {
  id: string;
  name: string;
  start: number;
  end: number | null;
}

interface AddSymbolOptions {
  addToExports?: boolean;
  type?: SymbolType;
  start?: number;
  end?: number | null;
}

const MIN_BLOCK_SPAN = 1;
const MIN_BLOCK_LINES = 2;
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
  "ALL",
]);

function createContext(filePath: string, code: string): ExtractContext {
  return {
    filePath,
    code,

    imports: [],
    functions: [],
    classes: [],
    components: [],
    interfaces: [],
    exports: [],
    blocks: [],
    apis: [],
    schemas: [],

    seen: {
      imports: new Set(),
      functions: new Set(),
      classes: new Set(),
      interfaces: new Set(),
      components: new Set(),
      exports: new Set(),
      blocks: new Set(),
      apis: new Set(),
      schemas: new Set(),
    },

    errors: [],
  };
}

function normalizeFilePath(path: string) {
  return path.replace(/\\/g, "/");
}

function createImportVisitor(ctx: ExtractContext) {
  const addImport = (source: string, node: any) => {
    if (ctx.seen.imports.has(source)) {
      return;
    }

    ctx.seen.imports.add(source);

    ctx.imports.push({
      id: `import:${normalizeFilePath(ctx.filePath)}:${source}`,
      name: source,
      start: node.loc?.start.line ?? 0,
      end: node.loc?.end.line ?? null,
    });
  };

  return {
    enter(path: any) {
      const node = path.node;

      if (isImportDeclaration(node) && isStringLiteral(node.source)) {
        addImport(node.source.value, node);
      }

      if (
        (node.type === "ExportNamedDeclaration" ||
          node.type === "ExportAllDeclaration") &&
        node.source &&
        isStringLiteral(node.source)
      ) {
        addImport(node.source.value, node);
      }

      if (
        isCallExpression(node) &&
        node.callee.type === "Identifier" &&
        node.callee.name === "require" &&
        node.arguments.length === 1 &&
        isStringLiteral(node.arguments[0])
      ) {
        addImport(node.arguments[0].value, node);
      }

      if (
        isCallExpression(node) &&
        node.callee.type === "Import" &&
        node.arguments.length === 1 &&
        isStringLiteral(node.arguments[0])
      ) {
        addImport(node.arguments[0].value, node);
      }
    },
  };
}

export function extractStructureBabel(
  filePath: string,
  code: string,
): ExtractStructureResult {
  if (!code || code.trim().length === 0) {
    return {
      imports: [],
      functions: [],
      classes: [],
      components: [],
      interfaces: [],
      exports: [],
      blocks: [],
      apis: [],
      schemas: [],
    };
  }

  let ast;

  if (
    filePath.includes(".spec.") ||
    filePath.includes(".test.") ||
    filePath.includes("/e2e/") ||
    filePath.includes("/__tests__/")
  ) {
    return {
      imports: [],
      functions: [],
      classes: [],
      components: [],
      interfaces: [],
      exports: [],
      blocks: [],
      apis: [],
      schemas: [],
    };
  }

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
  } catch (err: any) {
    return {
      imports: [],
      functions: [],
      classes: [],
      components: [],
      interfaces: [],
      exports: [],
      blocks: [],
      apis: [],
      schemas: [],
      errors: [
        {
          message: err.message ?? "Failed to parse file",
          line: err.loc?.line,
          column: err.loc?.column,
        },
      ],
    };
  }

  const ctx = createContext(filePath, code);

  function createSymbolVisitor(ctx: ExtractContext) {
    return {
      FunctionDeclaration(path: NodePath<FunctionDeclaration>) {
        addSymbol(path.node.id?.name, {
          type: "function",
          start: path.node.loc?.start.line,
          end: path.node.loc?.end.line,
        });
        if (path.node.id?.name && path.node.body) {
          addBlock(
            path.node.id.name,
            locStart(path.node.body),
            locEnd(path.node.body),
          );
        }

        if (returnsJSXFromPath(path)) {
          const key = makeKey(
            path.node.id!?.name,
            locStart(path.node),
            locEnd(path.node),
          );

          if (!ctx.seen.components.has(key)) {
            ctx.components.push({
              id: `component:${normalizeFilePath(ctx.filePath)}`,
              name: path.node.id!.name,
              start: locStart(path.node),
              end: locEnd(path.node),
            });
            ctx.seen.components.add(key);
          }
        }
      },

      VariableDeclarator(path: NodePath<VariableDeclarator>) {
        const { id, init } = path.node;

        if (init?.type === "NewExpression" || init?.type === "CallExpression") {
          const callee = init.callee;
          const isSchemaCtor =
            (callee.type === "Identifier" && callee.name === "Schema") ||
            (callee.type === "MemberExpression" &&
              (callee.object as any)?.name === "mongoose" &&
              (callee.property as any)?.name === "Schema");

          if (isSchemaCtor && init.arguments && init.arguments.length > 0) {
            const arg0 = init.arguments[0];
            const arg1 = init.arguments[1];
            if (arg0 && arg0.type === "ObjectExpression") {
              const start = path.node.loc?.start.line || 0;
              const end = path.node.loc?.end.line || null;
              const name =
                (id.type === "Identifier" && id.name) || "AnonymousSchema";
              const fields = extractObjectFields(arg0 as ObjectExpression);

              if (schemaOptionsHaveTimestamps(arg1)) {
                if (!fields.some((f) => f.name === "createdAt"))
                  fields.push({
                    name: "createdAt",
                    type: "Date",
                    raw: "timestamps",
                    auto: true,
                  });
                if (!fields.some((f) => f.name === "updatedAt"))
                  fields.push({
                    name: "updatedAt",
                    type: "Date",
                    raw: "timestamps",
                    auto: true,
                  });
              }

              addSchema({ name, framework: "mongoose", start, end, fields });
            }
          }
        }

        if (
          init &&
          init.type === "CallExpression" &&
          init.callee.type === "MemberExpression" &&
          init.callee.property.type === "Identifier" &&
          init.callee.property.name === "object"
        ) {
          const framework =
            (init.callee.object as Identifier).name === "z" ? "zod" : "yup";
          const arg0 = init.arguments?.[0];
          if (arg0 && arg0.type === "ObjectExpression") {
            const start = locStart(init);
            const end = locEnd(init);
            const schemaName =
              id.type === "Identifier"
                ? id.name
                : `${framework}.object@${start}`;
            const fields = extractObjectFields(arg0 as ObjectExpression);
            addSchema({ name: schemaName, framework, start, end, fields });
          }
        }

        if (init?.type === "ObjectExpression") {
          const start = path.node.loc?.start.line || 0;
          const end = path.node.loc?.end.line || null;
          const name = id.type === "Identifier" ? id.name : "objSchema";
          if (/schema/i.test(String(name))) {
            const fields = extractObjectFields(init as ObjectExpression);
            addSchema({ name, framework: "mongoose", start, end, fields });
          }
        }

        if (
          id.type === "Identifier" &&
          init &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(init.type)
        ) {
          if (returnsJSXFromPath(path)) {
            const key = makeKey(id.name, locStart(init), locEnd(init));

            if (!ctx.seen.components.has(key)) {
              ctx.seen.components.add(key);
              ctx.components.push({
                id: `component:${normalizeFilePath(ctx.filePath)}`,
                name: id.name,
                start: locStart(init),
                end: locEnd(init),
              });
            }
          }

          addSymbol(id.name, {
            type: "function",
            start: path.node.loc?.start.line,
            end: path.node.loc?.end.line,
          });
          addFnBodyAsBlock(
            id.name,
            init as ArrowFunctionExpression | FunctionExpression,
          );
        }
      },

      ClassDeclaration(path: NodePath<ClassDeclaration>) {
        addSymbol(path.node.id?.name, {
          type: "class",
          start: path.node.loc?.start.line,
          end: path.node.loc?.end.line,
        });

        const node: any = path.node;
        const className = node.id?.name || "AnonymousController";

        let basePath = "/";
        if (Array.isArray(node.decorators)) {
          const controllerDec = node.decorators.find((dec: any) => {
            const expr = dec.expression;
            return (
              expr &&
              expr.type === "CallExpression" &&
              expr.callee.type === "Identifier" &&
              expr.callee.name === "Controller"
            );
          });

          if (controllerDec?.expression?.type === "CallExpression") {
            basePath =
              getStringFromNode(controllerDec.expression.arguments?.[0]) || "/";
          }
        }

        const superClass = path.node.superClass;
        const isReactClass =
          superClass &&
          ((superClass.type === "MemberExpression" &&
            superClass.object.type === "Identifier" &&
            superClass.object.name === "React") ||
            (superClass.type === "Identifier" &&
              ["Component", "PureComponent"].includes(superClass.name)));

        if (isReactClass && path.node.id?.name) {
          const key = makeKey(
            path.node.id.name,
            locStart(path.node),
            locEnd(path.node),
          );
          if (!ctx.seen.components.has(key)) {
            ctx.components.push({
              id: `component:${normalizeFilePath(ctx.filePath)}`,
              name: path.node.id.name,
              start: locStart(path.node),
              end: locEnd(path.node),
            });
            ctx.seen.components.add(key);
          }
        }

        const elems = node.body?.body || [];
        for (const elem of elems) {
          if (!elem.decorators || elem.decorators.length === 0) continue;

          for (const mDec of elem.decorators) {
            const expr = mDec.expression;
            if (!expr) continue;

            let decName: string | null = null;
            let argNode: any = null;

            if (expr.type === "CallExpression") {
              if (expr.callee.type === "Identifier") decName = expr.callee.name;
              else if (expr.callee.type === "MemberExpression")
                decName = expr.callee.property?.name ?? null;
              argNode = expr.arguments?.[0];
            } else if (expr.type === "Identifier") {
              decName = expr.name;
            } else if (expr.type === "MemberExpression") {
              decName = expr.property?.name ?? null;
            }

            if (!decName) continue;
            const methodName = decName.toUpperCase();

            if (!HTTP_METHODS.has(methodName)) continue;

            const methodPathRaw = argNode
              ? getStringFromNode(argNode) || "/"
              : null;

            const methodPath = methodPathRaw || "/";
            const fullPath = joinPaths(basePath, methodPath);

            ctx.apis.push({
              id: `api:${normalizeFilePath(ctx.filePath)}`,
              method: methodName,
              path: fullPath,
              start: elem.loc?.start?.line ?? 0,
              end: elem.loc?.end?.line ?? null,
              framework: "nestjs",
              controller: className,
            });
          }
        }
      },

      ExportNamedDeclaration(path: NodePath<ExportNamedDeclaration>) {
        const decl = path.node.declaration as any;

        if (decl) {
          if (decl.type === "FunctionDeclaration" && decl.id?.name) {
            const method = decl.id.name.toUpperCase();
            if (HTTP_METHODS.has(method)) {
              const start = locStart(decl);
              const end = locEnd(decl);
              addApi({ method, path: "/", start, end, framework: "next" });
              addBlock(`${method} /`, start, end);
            }

            addSymbol(decl.id.name, {
              type: "function",
              addToExports: true,
              start: decl.loc?.start.line,
              end: decl.loc?.end.line,
            });
            if (decl.body)
              addBlock(decl.id.name, locStart(decl.body), locEnd(decl.body));
          } else if (decl.type === "ClassDeclaration" && decl.id?.name) {
            addSymbol(decl.id.name, {
              type: "class",
              addToExports: true,
              start: decl.loc?.start.line,
              end: decl.loc?.end.line,
            });
          } else if (
            decl.type === "TSInterfaceDeclaration" ||
            decl.type === "TSTypeAliasDeclaration"
          ) {
            addSymbol(decl.id.name, {
              type: "interface",
              addToExports: true,
              start: decl.loc?.start.line,
              end: decl.loc?.end.line,
            });
          } else if (decl.type === "VariableDeclaration") {
            decl.declarations.forEach((d: any) => {
              const name = d.id?.name;
              if (!name) return;
              addSymbol(name, {
                addToExports: true,
                start: d.loc?.start.line,
                end: d.loc?.end.line,
              });

              const init = d.init;
              if (
                init?.type === "ArrowFunctionExpression" ||
                init?.type === "FunctionExpression"
              ) {
                addSymbol(name, {
                  type: "function",
                  start: d.loc?.start.line,
                  end: d.loc?.end.line,
                });
                addFnBodyAsBlock(name, init);
              } else if (init?.type === "ClassExpression") {
                addSymbol(name, {
                  type: "class",
                  start: d.loc?.start.line,
                  end: d.loc?.end.line,
                });
              }

              if (
                d.id?.type === "Identifier" &&
                HTTP_METHODS.has(d.id?.name.toUpperCase()) &&
                init &&
                (init.type === "ArrowFunctionExpression" ||
                  init.type === "FunctionExpression")
              ) {
                addApi({
                  method: d.id?.name.toUpperCase(),
                  path: "/",
                  start: locStart(d),
                  end: locEnd(d),
                  framework: "next",
                });
              }
            });
          }
        }

        for (const spec of path.node.specifiers) {
          if (
            spec.type === "ExportSpecifier" &&
            spec.exported.type === "Identifier"
          ) {
            addSymbol(spec.exported.name, {
              addToExports: true,
              start: spec.loc?.start.line,
              end: spec.loc?.end.line,
            });
          }
        }
      },

      ExportDefaultDeclaration(path: NodePath<ExportDefaultDeclaration>) {
        const decl: any = path.node.declaration;
        const start = decl?.loc?.start.line ?? path.node.loc?.start.line;
        const end = decl?.loc?.end.line ?? path.node.loc?.end.line;

        if (
          filePath.includes("/app/api/") ||
          filePath.includes("/pages/api/")
        ) {
          if (
            decl &&
            (decl.type === "FunctionDeclaration" ||
              decl.type === "FunctionExpression" ||
              decl.type === "ArrowFunctionExpression")
          ) {
            const methods = Array.from(
              collectReqMethods(decl.body || decl, new Set()),
            );
            if (methods.length > 0) {
              methods.forEach((m) => {
                addApi({
                  method: m,
                  path: "/",
                  start,
                  end,
                  framework: "next",
                });
              });
            } else {
              addApi({
                method: "ALL",
                path: "/",
                start,
                end,
                framework: "next",
              });
            }
          }
        }

        if (decl?.id?.name) {
          addSymbol(decl.id.name, {
            addToExports: true,
            type:
              decl.type === "FunctionDeclaration"
                ? "function"
                : decl.type === "ClassDeclaration"
                  ? "class"
                  : undefined,
            start,
            end,
          });
          if (decl.type === "FunctionDeclaration" && decl.body) {
            addBlock(decl.id.name, locStart(decl.body), locEnd(decl.body));
          }
        } else if (decl?.name) {
          addSymbol(decl.name, { addToExports: true, start, end });
        }
      },

      AssignmentExpression(path: NodePath<AssignmentExpression>) {
        const left = path.node.left as any;
        const right = path.node.right as any;
        const start = path.node.loc?.start.line;
        const end = path.node.loc?.end.line;

        if (
          left.type === "MemberExpression" &&
          right &&
          (right.type === "FunctionExpression" ||
            right.type === "ArrowFunctionExpression")
        ) {
          const fnName =
            left.property?.type === "Identifier" ? left.property.name : null;

          if (fnName) {
            addSymbol(fnName, {
              type: "function",
              start,
              end,
            });
            addFnBodyAsBlock(fnName, right);
          }
        }

        if (
          left.type === "MemberExpression" &&
          left.object.type === "Identifier" &&
          ["exports", "module"].includes(left.object.name)
        ) {
          let key = "";
          if (left.property.type === "Identifier") key = left.property.name;
          else if (left.property.type === "StringLiteral")
            key = left.property.value;

          const isObjectExport =
            left.object.name === "module" &&
            left.property.type === "Identifier" &&
            left.property.name === "exports" &&
            right.type === "ObjectExpression";

          if (isObjectExport) {
            for (const prop of right.properties as any[]) {
              const pKey = prop.key?.name || prop.key?.value;
              if (!pKey) continue;
              addSymbol(pKey, {
                addToExports: true,
                start: prop.loc?.start.line,
                end: prop.loc?.end.line,
              });

              const val = prop.value;
              if (
                val.type === "FunctionExpression" ||
                val.type === "ArrowFunctionExpression"
              ) {
                addSymbol(pKey, {
                  type: "function",
                  start: val.loc?.start.line,
                  end: val.loc?.end.line,
                });
                addFnBodyAsBlock(pKey, val);
              } else if (val.type === "ClassExpression") {
                addSymbol(pKey, {
                  type: "class",
                  start: val.loc?.start.line,
                  end: val.loc?.end.line,
                });
              }
            }
          } else if (key) {
            addSymbol(key, { addToExports: true, start, end });

            if (
              right.type === "FunctionExpression" ||
              right.type === "ArrowFunctionExpression"
            ) {
              addSymbol(key, { type: "function", start, end });
              addFnBodyAsBlock(key, right);
            } else if (right.type === "ClassExpression") {
              addSymbol(key, { type: "class", start, end });
            }
          }
        }
      },
    };
  }

  function createBlockVisitor(ctx: ExtractContext) {
    return {
      BlockStatement(path: NodePath<BlockStatement>) {
        const parent = path.parentPath?.node;

        if (
          parent &&
          (parent.type === "FunctionDeclaration" ||
            parent.type === "FunctionExpression" ||
            parent.type === "ArrowFunctionExpression" ||
            parent.type === "ClassMethod")
        ) {
          return;
        }
        addBlock("{block}", locStart(path.node), locEnd(path.node));
      },

      IfStatement(path: NodePath<IfStatement>) {
        addBlock(
          "if",
          locStart(path.node.consequent),
          locEnd(path.node.consequent),
        );
        if (path.node.alternate) {
          addBlock(
            "else",
            locStart(path.node.alternate),
            locEnd(path.node.alternate),
          );
        }
      },

      ForStatement(path: NodePath<ForStatement>) {
        addBlock("for", locStart(path.node.body), locEnd(path.node.body));
      },

      WhileStatement(path: NodePath<WhileStatement>) {
        addBlock("while", locStart(path.node.body), locEnd(path.node.body));
      },

      SwitchStatement(path: NodePath<SwitchStatement>) {
        addBlock("switch", locStart(path.node), locEnd(path.node));
      },

      TryStatement(path: NodePath<TryStatement>) {
        if (path.node.block)
          addBlock("try", locStart(path.node.block), locEnd(path.node.block));
        if (path.node.finalizer)
          addBlock(
            "finally",
            locStart(path.node.finalizer),
            locEnd(path.node.finalizer),
          );
      },

      CatchClause(path: NodePath<CatchClause>) {
        addBlock("catch", locStart(path.node.body), locEnd(path.node.body));
      },

      ObjectExpression(path: NodePath<ObjectExpression>) {
        const start = locStart(path.node);
        const end = locEnd(path.node);
        if (!start || !end) return;
        if (!spansEnough(start, end) || end - start < 4) return;
        if (start === end) return;

        const p = path.parentPath;
        if (
          p &&
          (p.isCallExpression() ||
            p.isMemberExpression() ||
            p.isObjectProperty()) &&
          end - start < 2
        ) {
          return;
        }
        addBlock("{object}", start, end);
      },

      TSModuleBlock(path: NodePath<TSModuleBlock>) {
        const start = path.node.loc?.start.line;
        const end = path.node.loc?.end.line;
        if (start && end && end - start >= MIN_BLOCK_LINES) {
          addBlock("declare", start, end);
        }
      },

      JSXElement(path: NodePath<JSXElement>) {
        const p = path.parentPath;
        if (!p?.isReturnStatement() && !p?.isVariableDeclarator()) {
          return;
        }

        const start = locStart(path.node);
        const end = locEnd(path.node);
        if (!spansEnough(start, end) || end - start < 4) return;

        let name = "<JSX>";
        if (path.node.openingElement.name.type === "JSXIdentifier") {
          name = `<${path.node.openingElement.name.name}>`;
        }
        addBlock(name, start, end);
      },

      TSTypeLiteral(path: NodePath<TSTypeLiteral>) {
        const start = path.node.loc?.start.line;
        const end = path.node.loc?.end.line;
        if (start && end && end - start >= MIN_BLOCK_LINES) {
          addBlock("type", start, end);
        }
      },

      ReturnStatement(path: NodePath<ReturnStatement>) {
        const arg = path.node.argument;
        if (arg && arg.loc) {
          const start = arg.loc.start.line;
          const end = arg.loc.end.line;
          if (end - start >= MIN_BLOCK_LINES) {
            addBlock("return", start - 1, end + 1);
          }
        }
      },
    };
  }

  function createApiSchemaVisitor(ctx: ExtractContext) {
    return {
      CallExpression(path: NodePath<CallExpression>) {
        const node = path.node;
        const callee = path.node.callee as any;
        const args = path.node.arguments || [];

        try {
          if (
            node.callee &&
            node.callee.type === "MemberExpression" &&
            node.callee.property &&
            node.callee.property.type === "Identifier" &&
            node.callee.property.name === "use"
          ) {
            const args = node.arguments || [];
            const first = args[0];
            const basePath = getStringFromNode(first);
            for (let i = 1; i < args.length; i++) {
              const a = args[i];
              if (a && a.type === "Identifier" && basePath) {
                routerMounts.set(a.name, basePath);
              } else if (
                a &&
                a.type === "CallExpression" &&
                a.callee &&
                a.callee.type === "Identifier" &&
                a.callee.name === "Router"
              ) {
              }
            }
          }

          const callee = node.callee as any;
          if (
            callee &&
            callee.type === "MemberExpression" &&
            callee.object &&
            callee.object.type === "Identifier" &&
            callee.object.name === "mongoose" &&
            callee.property &&
            callee.property.type === "Identifier" &&
            callee.property.name === "model"
          ) {
            const args = node.arguments || [];
            const modelNameArg = args[0];
            const schemaArg = args[1];
            const modelName =
              getStringFromNode(modelNameArg) || `model@${locStart(node)}`;

            if (schemaArg && schemaArg.type === "NewExpression") {
              const ctor = schemaArg.callee;
              const isSchemaCtor =
                (ctor.type === "Identifier" && ctor.name === "Schema") ||
                (ctor.type === "MemberExpression" &&
                  (ctor.object as any)?.name === "mongoose" &&
                  (ctor.property as any)?.name === "Schema");
              if (isSchemaCtor) {
                const arg0 = schemaArg.arguments?.[0];
                const arg1 = schemaArg.arguments?.[1];
                if (arg0 && arg0.type === "ObjectExpression") {
                  const fields = extractObjectFields(arg0 as ObjectExpression);
                  if (schemaOptionsHaveTimestamps(arg1)) {
                    if (!fields.some((f) => f.name === "createdAt"))
                      fields.push({
                        name: "createdAt",
                        type: "Date",
                        raw: "timestamps",
                        auto: true,
                      });
                    if (!fields.some((f) => f.name === "updatedAt"))
                      fields.push({
                        name: "updatedAt",
                        type: "Date",
                        raw: "timestamps",
                        auto: true,
                      });
                  }
                  addSchema({
                    name: modelName,
                    framework: "mongoose",
                    start: locStart(node),
                    end: locEnd(node),
                    fields,
                  });
                }
              }
            }
          }
        } catch (err) {
          console.log(err);
        }

        const routeInfo = extractRouteFromCall(node);
        if (routeInfo) {
          let finalPath = routeInfo.path;
          if (routeInfo.mountFor && routerMounts.has(routeInfo.mountFor)) {
            finalPath = joinPaths(
              routerMounts.get(routeInfo.mountFor)!,
              routeInfo.path,
            );
          }

          addApi({
            method: routeInfo.method,
            path: finalPath,
            start: routeInfo.start,
            end: routeInfo.end,
            framework: routeInfo.framework,
          });
        }

        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "CallExpression" &&
          callee.object.callee.type === "MemberExpression" &&
          callee.object.callee.property.type === "Identifier" &&
          callee.object.callee.property.name === "route" &&
          callee.object.arguments.length >= 1 &&
          callee.object.arguments[0].type === "StringLiteral" &&
          callee.property.type === "Identifier"
        ) {
          const method = callee.property.name.toUpperCase();
          if (HTTP_METHODS.has(method)) {
            const pathArg = callee.object.arguments[0];
            addApi({
              method,
              path: (pathArg as any).value,
              start: locStart(node),
              end: locEnd(node),
              framework: "express",
            });
          }
        }

        let name;
        if (callee.type === "MemberExpression") name = calleeName(callee);
        if (!name) return;

        for (const arg of args) {
          if (
            arg &&
            (arg.type === "ArrowFunctionExpression" ||
              arg.type === "FunctionExpression") &&
            arg.body?.type === "BlockStatement"
          ) {
            const body = arg.body as BlockStatement;

            let displayName = name;
            if (name.includes(".")) displayName = name.split(".").pop()!;

            if (/^app\./.test(name)) displayName = name;

            addBlock(displayName, locStart(body), locEnd(body));
          }
        }
      },

      TSTypeAliasDeclaration(path: NodePath<TSTypeAliasDeclaration>) {
        const node: any = path.node;
        const name = node.id?.name;
        const start = node.loc?.start.line || 0;
        const end = node.loc?.end.line || null;
        const fields: SchemaField[] = [];

        const ta = node.typeAnnotation;
        if (ta && (ta as any).type === "TSTypeLiteral") {
          const members = (ta as any).members || [];
          for (const mem of members) {
            if ((mem as any).type === "TSPropertySignature") {
              const key =
                getPropName((mem as any).key) || (mem.key?.name ?? "unknown");
              const optional = Boolean((mem as any).optional);
              const tAnn: any =
                (mem as any).typeAnnotation?.typeAnnotation ?? null;
              const info = extractTSType(tAnn);
              fields.push({
                name: optional ? `${key}?` : key,
                type: info.type ?? null,
                children: info.children,
                auto: false,
              });
            }
          }
          if (name) addSchema({ name, framework: "ts", start, end, fields });
        }

        addSymbol(path.node.id.name, {
          type: "interface",
          start: path.node.loc?.start.line,
          end: path.node.loc?.end.line,
        });
      },

      TSInterfaceDeclaration(path: NodePath<TSInterfaceDeclaration>) {
        const node: any = path.node;
        const name = node.id?.name;
        const start = node.loc?.start.line || 0;
        const end = node.loc?.end.line || null;
        const fields: SchemaField[] = [];

        if (node.body && Array.isArray(node.body.body)) {
          for (const mem of node.body.body) {
            if ((mem as any).type === "TSPropertySignature") {
              const key =
                getPropName((mem as any).key) || (mem.key?.name ?? "unknown");

              const optional = Boolean((mem as any).optional);
              const tAnn: any =
                (mem as any).typeAnnotation?.typeAnnotation ?? null;
              const info = extractTSType(tAnn);
              fields.push({
                name: optional ? `${key}?` : key,
                type: info.type ?? null,
                children: info.children,
                auto: false,
              });
            }
          }
        }

        if (name) addSchema({ name, framework: "ts", start, end, fields });

        addSymbol(path.node.id.name, {
          type: "interface",
          start: path.node.loc?.start.line,
          end: path.node.loc?.end.line,
        });
      },
    };
  }

  function makeSymbolId(type: string, filePath: string, name: string) {
    return `${type}:${normalizeFilePath(filePath)}:${name}`;
  }

  function makeApiId(method: string, path: string) {
    return `api:${method.toUpperCase()}:${path}`;
  }

  function makeSchemaId(framework: string, name: string) {
    return `schema:${framework}:${name}`;
  }

  const makeKey = (name: string, start?: number, end?: number | null) =>
    `${name}:${start ?? 0}:${end ?? "?"}`;

  function locStart(n: any) {
    return n?.loc?.start?.line ?? 0;
  }
  function locEnd(n: any) {
    return n?.loc?.end?.line ?? null;
  }
  const spansEnough = (s?: number | null, e?: number | null) =>
    typeof s === "number" && typeof e === "number" && e - s >= MIN_BLOCK_SPAN;

  const addSymbol = (
    name: string | null | undefined,
    opts: AddSymbolOptions = {},
  ) => {
    if (!name) return;
    const start = opts.start ?? 0;
    const end = opts.end ?? null;
    const key = makeKey(name, start, end);

    if (opts.type === "function" && !ctx.seen.functions.has(key)) {
      ctx.functions.push({
        id: makeSymbolId("function", ctx.filePath, name),
        name,
        start,
        end,
      });
      ctx.seen.functions.add(key);
    }

    if (opts.type === "class" && !ctx.seen.classes.has(key)) {
      ctx.classes.push({
        id: makeSymbolId("class", ctx.filePath, name),
        name,
        start,
        end,
      });
      ctx.seen.classes.add(key);
    }

    if (opts.type === "interface" && !ctx.seen.interfaces.has(key)) {
      ctx.interfaces.push({
        id: makeSymbolId("interface", ctx.filePath, name),
        name,
        start,
        end,
      });
      ctx.seen.interfaces.add(key);
    }

    if (opts.addToExports && !ctx.seen.exports.has(key)) {
      ctx.exports.push({
        id: makeSymbolId("exports", ctx.filePath, name),
        name,
        start,
        end,
      });
      ctx.seen.exports.add(key);
    }
  };

  const addImportIfNew = (val: string, start: number, end: number | null) => {
    if (!ctx.seen.imports.has(val)) {
      ctx.seen.imports.add(val);
      ctx.imports.push({
        id: `import:${normalizeFilePath(ctx.filePath)}:${val}`,
        name: val,
        start,
        end,
      });
    }
  };

  function normalizePath(raw: string | null | undefined) {
    if (!raw) return "/";
    return (
      raw.replace(/^['"]/, "").replace(/['"]$/, "").replace(/\/+/g, "/") || "/"
    );
  }

  const addBlock = (
    name: string,
    start?: number | null,
    end?: number | null,
  ) => {
    if (!name) return;
    if (!spansEnough(start, end)) return;
    const key = makeKey(name, start!, end!);
    if (ctx.seen.blocks.has(key)) return;
    ctx.seen.blocks.add(key);
    ctx.blocks.push({
      id: `block:${normalizeFilePath(ctx.filePath)}:${name}:${start}`,
      name,
      start: start!,
      end: end!,
    });
  };

  function addApi(
    info: {
      method?: string;
      path?: string;
      start?: number;
      end?: number | null;
      framework?: ApiFramework;
    },
    alsoAddFoldBlock: boolean = true,
  ) {
    const method = (info.method ?? "").toUpperCase();
    const path = info.path ?? "/";
    const start = info.start ?? 0;
    const end = info.end ?? null;
    const framework: ApiFramework = info.framework ?? "unknown";

    if (!HTTP_METHODS.has(method)) return;

    const key = `${framework}|${method}|${path}|${start}|${end ?? "?"}`;
    if (ctx.seen.apis.has(key)) return;
    ctx.seen.apis.add(key);

    ctx.apis.push({
      id: makeApiId(method, path),
      method,
      path,
      start,
      end,
      framework,
    });

    if (alsoAddFoldBlock && end !== null && end - start >= MIN_BLOCK_LINES) {
      addBlock(`${method} ${path}`, start, end);
    }
  }

  function addSchema(s: {
    name: string;
    framework: SchemaInfo["framework"];
    start: number;
    end: number | null;
    fields?: SchemaField[];
  }) {
    const key = makeKey(s.name, s.start, s.end);
    if (ctx.seen.schemas.has(key)) return;
    ctx.seen.schemas.add(key);
    ctx.schemas.push({
      id: makeSchemaId(s.framework, s.name),
      name: s.name,
      framework: s.framework,
      start: s.start,
      end: s.end,
      fields: s.fields || [],
    });
  }

  function getStringFromNode(node: any): string | null {
    if (!node) return null;
    if (node.type === "StringLiteral") return node.value;
    if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
      return node.quasis.map((q: any) => q.value.cooked).join("");
    }
    return null;
  }

  const routerMounts = new Map<string, string>();

  function getRootIdentifier(expr: any): string | null {
    let cur = expr;
    while (cur) {
      if (cur.type === "Identifier") return cur.name;
      if (cur.type === "MemberExpression") {
        if (cur.object && cur.object.type === "Identifier")
          return cur.object.name;
        cur = cur.object;
        continue;
      }
      if (cur.type === "CallExpression") {
        cur = cur.callee;
        continue;
      }
      return null;
    }
    return null;
  }

  function returnsJSXFromPath(path: NodePath<any>): boolean {
    let found = false;

    path.traverse({
      ReturnStatement(p) {
        const arg = p.node.argument;
        if (!arg) return;

        if (arg.type === "JSXElement" || arg.type === "JSXFragment") {
          found = true;
          p.stop();
          return;
        }

        if (
          arg.type === "CallExpression" &&
          arg.callee.type === "MemberExpression" &&
          arg.callee.object.type === "Identifier" &&
          arg.callee.object.name === "React" &&
          arg.callee.property.type === "Identifier" &&
          arg.callee.property.name === "createElement"
        ) {
          found = true;
          p.stop();
        }
      },
    });

    return found;
  }

  function joinPaths(
    base: string | null | undefined,
    part: string | null | undefined,
  ) {
    const b = (base || "/").toString();
    const p = (part || "/").toString();

    const baseNorm = b === "/" ? "" : b.replace(/\/+$/, "");
    const partNorm = p.startsWith("/") ? p : `/${p}`;

    const out = `${baseNorm}${partNorm}`.replace(/\/+/g, "/");
    return out === "" ? "/" : out;
  }

  function detectFrameworkFromCallee(callee: any): ApiFramework {
    if (!callee) return "unknown";

    const root = getRootIdentifier(callee.object);
    if (root === "app" || root === "router") return "express";

    try {
      if (callee.object && callee.object.type === "CallExpression") {
        const inner = callee.object.callee;
        if (
          inner &&
          inner.type === "MemberExpression" &&
          inner.property?.name === "route"
        ) {
          return "express";
        }
      }
    } catch (e) {}

    return "unknown";
  }

  function findNearestRouteCallFromMember(calleeNode: any) {
    let cur: any = calleeNode;
    while (cur) {
      if (
        cur.type === "CallExpression" &&
        cur.callee &&
        cur.callee.type === "MemberExpression" &&
        cur.callee.property &&
        cur.callee.property.type === "Identifier" &&
        cur.callee.property.name === "route"
      ) {
        return cur;
      }

      if (
        cur.type === "CallExpression" &&
        cur.callee?.type === "MemberExpression"
      ) {
        cur = cur.callee.object;
        continue;
      }

      if (cur.type === "MemberExpression") {
        cur = cur.object;
        continue;
      }

      break;
    }
    return null;
  }

  function getRootIdentifierName(node: any) {
    let cur = node;
    while (cur) {
      if (cur.type === "Identifier") return cur.name;
      if (cur.type === "MemberExpression") {
        cur = cur.object;
        continue;
      }
      if (cur.type === "CallExpression" && cur.callee) {
        cur = cur.callee.object ?? cur.arguments?.[0] ?? null;
        continue;
      }
      break;
    }
    return null;
  }

  function extractRouteFromCall(node: any) {
    const callee = node.callee;
    if (!callee || callee.type !== "MemberExpression") return null;

    const prop = callee.property;
    if (!prop || prop.type !== "Identifier") return null;
    const method = prop.name.toUpperCase();
    if (!HTTP_METHODS.has(method)) return null;

    if (
      callee.object &&
      callee.object.type === "Identifier" &&
      ["app", "router"].includes(callee.object.name)
    ) {
      const firstArg = node.arguments && node.arguments[0];
      const pathStr = getStringFromNode(firstArg) ?? "<dynamic>";
      return {
        method,
        path: pathStr,
        start: locStart(node),
        end: locEnd(node),
        mountFor: callee.object.name,
        framework: "express",
      };
    }

    const routeCall = findNearestRouteCallFromMember(callee);
    if (routeCall) {
      const routeArg = routeCall.arguments?.[0];
      const routePath = getStringFromNode(routeArg) ?? "<dynamic>";

      const routeRootName = getRootIdentifierName(
        routeCall.callee?.object ?? routeCall.callee,
      );

      return {
        method,
        path: routePath,
        start: locStart(node),
        end: locEnd(node),
        mountFor: routeRootName,
        framework: "express",
      };
    }

    if (callee.object && callee.object.type === "CallExpression") {
      const firstArg = node.arguments && node.arguments[0];
      const pathStr = getStringFromNode(firstArg) ?? "<dynamic>";
      const rootName = getRootIdentifierName(
        callee.object.callee?.object ?? callee.object.callee,
      );
      return {
        method,
        path: pathStr,
        start: locStart(node),
        end: locEnd(node),
        mountFor: rootName,
        framework: "express",
      };
    }

    return null;
  }

  function isReqMethodMember(node: any) {
    return (
      node &&
      node.type === "MemberExpression" &&
      node.object?.type === "Identifier" &&
      node.object.name === "req" &&
      ((node.property?.type === "Identifier" &&
        node.property.name === "method") ||
        (node.property?.type === "StringLiteral" &&
          node.property.value === "method"))
    );
  }

  function collectReqMethods(node: any, out = new Set<string>()) {
    if (!node || typeof node !== "object") return out;
    if (
      node.type === "BinaryExpression" &&
      (node.operator === "===" || node.operator === "==")
    ) {
      if (
        isReqMethodMember(node.left) &&
        node.right?.type === "StringLiteral"
      ) {
        out.add(node.right.value.toUpperCase());
      } else if (
        isReqMethodMember(node.right) &&
        node.left?.type === "StringLiteral"
      ) {
        out.add(node.left.value.toUpperCase());
      }
    }

    if (
      node.type === "SwitchStatement" &&
      isReqMethodMember(node.discriminant)
    ) {
      for (const cs of node.cases || []) {
        if (cs.test && cs.test.type === "StringLiteral")
          out.add(cs.test.value.toUpperCase());
      }
    }

    for (const k of Object.keys(node)) {
      const v = (node as any)[k];
      if (Array.isArray(v)) {
        v.forEach((c) => collectReqMethods(c, out));
      } else if (v && typeof v === "object") {
        collectReqMethods(v, out);
      }
    }
    return out;
  }

  function getPropName(key: any): string | null {
    if (!key) return null;
    if (key.type === "Identifier") return (key as Identifier).name;
    if (key.type === "StringLiteral") return (key as StringLiteral).value;
    if (key.type === "NumericLiteral")
      return String((key as NumericLiteral).value);
    return null;
  }

  function getCalleeParts(expr: any): string[] {
    if (!expr) return [];
    if (expr.type === "Identifier") return [(expr as any).name];
    if (expr.type === "MemberExpression") {
      const parts: string[] = [];
      let cur: any = expr;
      while (cur) {
        if (cur.property) {
          if (cur.property.type === "Identifier")
            parts.unshift(cur.property.name);
          else if (cur.property.type === "StringLiteral")
            parts.unshift(cur.property.value);
        }
        if (cur.object?.type === "Identifier") {
          parts.unshift(cur.object.name);
          break;
        } else if (cur.object?.type === "MemberExpression") {
          cur = cur.object;
          continue;
        } else if (cur.object?.type === "CallExpression") {
          const inner = getCalleeParts(cur.object.callee);
          if (inner.length) {
            parts.unshift(...inner);
          }
          break;
        } else {
          break;
        }
      }
      return parts;
    }
    if (expr.type === "CallExpression") return getCalleeParts(expr.callee);
    return [];
  }

  function simplifyTypeName(raw: string | null | undefined): string {
    if (!raw) return "any";
    let s = raw;
    s = s.replace(/\(\)$/g, "");

    const arrMatch = s.match(/^array<(.+)>$/);
    if (arrMatch) return `array<${simplifyTypeName(arrMatch[1])}>`;

    const parts = s.split(".");
    if (parts.length >= 2) {
      const root = parts[0].toLowerCase();
      if (root === "z" || root === "zod") return parts[1];
      if (root === "yup" || root === "y") return parts[1];
    }

    if (s.includes(".")) {
      const p = s.split(".");
      return p[p.length - 1];
    }

    return s;
  }

  function nodeToTypeString(n?: Node | null): string | null {
    if (!n) return null;
    switch (n.type) {
      case "Identifier":
        return (n as Identifier).name;
      case "StringLiteral":
        return "string";
      case "NumericLiteral":
        return "number";
      case "BooleanLiteral":
        return "boolean";
      case "ArrayExpression":
        return "array";
      case "ObjectExpression":
        return "object";
      case "MemberExpression": {
        const mem = n as MemberExpression;
        try {
          let parts: string[] = [];
          let cur: any = mem;
          while (cur) {
            if (cur.property?.name) parts.unshift(cur.property.name);
            if (cur.object?.name) {
              parts.unshift(cur.object.name);
              break;
            }
            cur = cur.object;
          }
          return parts.join(".");
        } catch {
          return "member";
        }
      }
      case "CallExpression": {
        const call = n as CallExpression;
        const parts = getCalleeParts(call.callee as any);

        if (parts.length) {
          const root = parts[0]?.toLowerCase();
          const method = parts[1] ?? parts[parts.length - 1];

          if (root === "z" || root === "zod") {
            if (method === "array") {
              const arg = call.arguments?.[0];
              if (arg) {
                if (arg.type === "ObjectExpression") return "array<object>";
                const inner = nodeToTypeString(arg as Node) || "any";
                return `array<${simplifyTypeName(inner)}>`;
              }
              return "array<any>";
            }
            if (method === "object") {
              return "object";
            }
            if (method) {
              return method;
            }
          }

          if (root === "yup" || root === "y") {
            if (method === "array") {
              if (call.callee && call.callee.type === "MemberExpression") {
                const prop = (call.callee as MemberExpression).property;
                if (prop && prop.type === "Identifier" && prop.name === "of") {
                  const inner = call.arguments?.[0];
                  const innerType = nodeToTypeString(inner as Node) || "any";
                  return `array<${simplifyTypeName(innerType)}>`;
                }
              }
              const arg = call.arguments?.[0];
              if (arg) {
                if (arg.type === "ObjectExpression") return "array<object>";
                const inner = nodeToTypeString(arg as Node) || "any";
                return `array<${simplifyTypeName(inner)}>`;
              }
              return "array<any>";
            }
            if (method === "object") return "object";
            if (method) return method;
          }
        }

        if (call.callee.type === "Identifier")
          return simplifyTypeName((call.callee as Identifier).name + "()");
        if (call.callee.type === "MemberExpression")
          return simplifyTypeName(
            memberToString(call.callee as MemberExpression) + "()",
          );
        return "call";
      }
      default:
        return n.type;
    }
  }

  function extractObjectFields(obj: ObjectExpression): SchemaField[] {
    const fields: SchemaField[] = [];

    for (const prop of obj.properties) {
      if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod")
        continue;
      if (prop.type === "ObjectMethod") {
        continue;
      }
      const p = prop as ObjectProperty;
      const name = getPropName(p.key) || "<computed>";
      const value = p.value;
      const field: SchemaField = {
        name,
        type: null,
        raw: undefined,
        auto: false,
      };

      if (!value) {
        fields.push(field);
        continue;
      }

      const extractTypeProp = (objExpr: ObjectExpression) => {
        const typeProp = objExpr.properties.find(
          (pr) =>
            pr.type === "ObjectProperty" &&
            getPropName((pr as ObjectProperty).key) === "type",
        ) as ObjectProperty | undefined;
        return typeProp ?? null;
      };
      if (value.type === "ObjectExpression") {
        const childObj = value as ObjectExpression;
        const typeProp = extractTypeProp(childObj);

        if (typeProp) {
          const tnode: any = (typeProp as ObjectProperty).value;

          if (tnode.type === "ArrayExpression") {
            const el = (tnode as any).elements?.[0];
            if (el && el.type === "ObjectExpression") {
              field.type = "array<object>";
              field.children = extractObjectFields(el as ObjectExpression);
              field.raw = objToText(el as ObjectExpression) || undefined;
            } else {
              const elType = el ? nodeToTypeString(el as Node) : "any";
              field.type = `array<${elType ?? "any"}>`;
              field.raw = objToText(childObj) || undefined;
            }
          } else if (tnode.type === "ObjectExpression") {
            field.type = "object";
            field.children = extractObjectFields(tnode as ObjectExpression);
            field.raw = objToText(tnode as ObjectExpression) || undefined;
          } else {
            field.type = nodeToTypeString(tnode as Node) || null;
            field.raw = objToText(childObj) || undefined;
          }
        } else {
          field.type = "object";
          field.children = extractObjectFields(childObj);
          field.raw = objToText(childObj) || undefined;
        }
      } else if (value.type === "ArrayExpression") {
        const arr = value as any;
        const el = arr.elements?.[0];
        if (el) {
          if (el.type === "ObjectExpression") {
            field.type = "array<object>";
            field.children = extractObjectFields(el as ObjectExpression);
            field.raw = objToText(el as ObjectExpression) || undefined;
          } else {
            const t = nodeToTypeString(el as Node) || "any";
            field.type = `array<${t}>`;
            field.raw = el.type;
          }
        } else {
          field.type = "array<any>";
        }
      } else if (value.type === "CallExpression") {
        const call = value as CallExpression;
        const callee = call.callee as any;

        if (callee && callee.type === "MemberExpression") {
          const obj = callee.object as any;
          const propName =
            callee.property?.name ?? callee.property?.value ?? "";

          if (
            obj &&
            obj.type === "Identifier" &&
            (obj.name === "z" ||
              obj.name === "zod" ||
              obj.name === "yup" ||
              obj.name === "Yup")
          ) {
            if (propName === "array") {
              const arg0 = call.arguments?.[0];
              if (arg0) {
                if (arg0.type === "ObjectExpression") {
                  field.type = "array<object>";
                  field.children = extractObjectFields(
                    arg0 as ObjectExpression,
                  );
                  field.raw = objToText(arg0 as ObjectExpression) || undefined;
                } else if (arg0.type === "CallExpression") {
                  const innerCall = arg0 as CallExpression;
                  const innerCallee = innerCall.callee as any;
                  if (
                    innerCallee &&
                    innerCallee.type === "MemberExpression" &&
                    innerCallee.property?.name === "object"
                  ) {
                    const innerArg = innerCall.arguments?.[0];
                    if (innerArg && innerArg.type === "ObjectExpression") {
                      field.type = "array<object>";
                      field.children = extractObjectFields(
                        innerArg as ObjectExpression,
                      );
                      field.raw =
                        objToText(innerArg as ObjectExpression) || undefined;
                    } else {
                      const innerType =
                        nodeToTypeString(innerCall.arguments?.[0] as Node) ||
                        "any";
                      field.type = `array<${innerType}>`;
                      field.raw = "call";
                    }
                  } else {
                    const innerType = nodeToTypeString(arg0 as Node) || "any";
                    field.type = `array<${innerType}>`;
                    field.raw = "call";
                  }
                } else {
                  const innerType = nodeToTypeString(arg0 as Node) || "any";
                  field.type = `array<${innerType}>`;
                  field.raw = "call";
                }
              } else {
                field.type = "array<any>";
              }
            } else if (propName === "object") {
              const arg0 = call.arguments?.[0];
              if (arg0 && arg0.type === "ObjectExpression") {
                field.type = "object";
                field.children = extractObjectFields(arg0 as ObjectExpression);
                field.raw = objToText(arg0 as ObjectExpression) || undefined;
              } else {
                field.type = "object";
                field.raw = "call";
              }
            } else if (
              ["string", "number", "boolean", "date"].includes(propName)
            ) {
              const map: any = {
                string: "string",
                number: "number",
                boolean: "boolean",
                date: "Date",
              };
              field.type = map[propName] || propName;
              field.raw = "call";
            } else {
              field.type = nodeToTypeString(call as Node) || null;
              field.raw = "call";
            }

            fields.push(field);
            continue;
          }
        }

        field.type = nodeToTypeString(call as Node) || null;
        field.raw = "call";
        fields.push(field);
        continue;
      }

      fields.push(field);
    }

    return fields;
  }

  function objToText(node: ObjectExpression | null | undefined): string | null {
    if (!node) return null;
    try {
      const parts: string[] = [];
      for (const prop of node.properties) {
        if (prop.type === "ObjectProperty") {
          const pn = getPropName((prop as ObjectProperty).key) || "k";
          const val = (prop as ObjectProperty).value;
          let v = "";
          if (val.type === "Identifier") v = (val as Identifier).name;
          else if (val.type === "StringLiteral")
            v = "${(val as StringLiteral).value}";
          else if (val.type === "ArrayExpression") v = "[]";
          else if (val.type === "ObjectExpression") v = "{...}";
          else v = val.type;
          parts.push(`${pn}: ${v}`);
        }
      }
      return `{ ${parts.join(", ")} }`;
    } catch {
      return null;
    }
  }

  function schemaOptionsHaveTimestamps(node: any): boolean {
    if (!node) return false;
    if (node.type !== "ObjectExpression") return false;
    for (const prop of node.properties) {
      if (prop.type !== "ObjectProperty") continue;
      const key = getPropName((prop as ObjectProperty).key);
      if (key === "timestamps") {
        const val = (prop as ObjectProperty).value;
        if (!val) return false;
        if (val.type === "BooleanLiteral") return !!(val as any).value;
        if (val.type === "ObjectExpression") return true;
      }
    }
    return false;
  }

  const memberToString = (m: MemberExpression): string => {
    const object =
      m.object.type === "Identifier"
        ? (m.object as Identifier).name
        : m.object.type === "MemberExpression"
          ? memberToString(m.object as MemberExpression)
          : "";
    const prop =
      m.property.type === "Identifier"
        ? (m.property as Identifier).name
        : m.property.type === "StringLiteral"
          ? (m.property as StringLiteral).value
          : "";
    return object && prop ? `${object}.${prop}` : prop || object || "";
  };

  function getTsTypeName(typeName: any): string {
    if (!typeName) return "unknown";
    if (typeName.type === "Identifier") return typeName.name;
    if (typeName.type === "TSQualifiedName") {
      const left = getTsTypeName(typeName.left);
      const right = getTsTypeName(typeName.right);
      return `${left}.${right}`;
    }
    return "unknown";
  }

  function extractTSType(node: any): {
    type: string | null;
    children?: SchemaField[];
  } {
    if (!node) return { type: null };

    switch (node.type) {
      case "TSTypeReference": {
        const tn = getTsTypeName(node.typeName);
        return { type: tn || "type" };
      }

      case "TSTypeLiteral": {
        const children = extractTSTypeLiteralMembers(node);
        return { type: "object", children };
      }

      case "TSArrayType": {
        const el = node.elementType;
        const elInfo = extractTSType(el);
        if (elInfo.children && elInfo.type === "object") {
          return { type: "array<object>", children: elInfo.children };
        }
        return { type: `array<${elInfo.type ?? "any"}>` };
      }

      case "TSUnionType": {
        const parts = (node.types || []).map(
          (t: any) => extractTSType(t).type || "any",
        );
        return { type: parts.join("|") };
      }

      case "TSLiteralType": {
        const lit = node.literal;
        if (!lit) return { type: "literal" };
        if (lit.type === "StringLiteral") return { type: `\"${lit.value}\"` };
        if (lit.type === "NumericLiteral") return { type: String(lit.value) };
        if (lit.type === "BooleanLiteral") return { type: String(lit.value) };
        return { type: "literal" };
      }

      case "TSParenthesizedType":
        return extractTSType(node.typeAnnotation);

      case "TSFunctionType":
        return { type: "function" };

      default: {
        try {
          const t =
            typeof nodeToTypeString === "function"
              ? nodeToTypeString(node)
              : null;
          return { type: t || node.type };
        } catch {
          return { type: node.type };
        }
      }
    }
  }

  function extractTSTypeLiteralMembers(node: any): SchemaField[] {
    const members = node?.members || [];
    const out: SchemaField[] = [];
    for (const mem of members) {
      if (mem.type !== "TSPropertySignature") continue;
      const key = getPropName(mem.key) || (mem.key?.name ?? "unknown");
      const optional = Boolean(mem.optional);
      const tAnn = mem.typeAnnotation?.typeAnnotation ?? null;
      const info = extractTSType(tAnn);
      out.push({
        name: optional ? `${key}?` : key,
        type: info.type ?? null,
        children: info.children,
        auto: false,
      });
    }
    return out;
  }

  const exprToName = (expr: Expression | LVal | null | undefined): string => {
    if (!expr) return "";
    if (expr.type === "Identifier") return (expr as Identifier).name;
    if (expr.type === "MemberExpression")
      return memberToString(expr as MemberExpression);
    return "";
  };

  const calleeName = (expr: Expression | null | undefined): string => {
    if (!expr) return "";
    if (expr.type === "Identifier") return (expr as Identifier).name;
    if (expr.type === "MemberExpression")
      return memberToString(expr as MemberExpression);
    return "";
  };

  const addFnBodyAsBlock = (
    name: string,
    fn: ArrowFunctionExpression | FunctionExpression,
  ) => {
    if (fn.body && fn.body.type === "BlockStatement") {
      addBlock(name, locStart(fn.body), locEnd(fn.body));
    }
  };

  const hasApi =
    code.includes(".get(") ||
    code.includes(".post(") ||
    code.includes(".put(") ||
    code.includes(".delete(") ||
    code.includes("route(");

  const hasSchema =
    code.includes("Schema(") ||
    code.includes(".object(") ||
    code.includes("interface ") ||
    code.includes("type ");

  const hasJSX = code.includes("<") && code.includes(">");

  const hasBlocks = code.includes("{") && code.includes("}");

  if (!hasApi && !hasSchema && !hasJSX && !hasBlocks) {
    traverse(ast, {
      ...createImportVisitor(ctx),
      ...createSymbolVisitor(ctx),
    });
  } else {
    try {
      traverse(ast, {
        ...createImportVisitor(ctx),
        ...createSymbolVisitor(ctx),
        ...createBlockVisitor(ctx),
        ...createApiSchemaVisitor(ctx),
      });
    } catch (err) {
      ctx.errors.push({
        message: `Traversal failed : ${(err as any)?.message ?? err}`,
      });
    }
  }

  const sortByStart = (arr: any) =>
    arr.sort((a: any, b: any) => (a.start || 0) - (b.start || 0));

  return {
    imports: sortByStart(ctx.imports),
    functions: sortByStart(ctx.functions),
    classes: sortByStart(ctx.classes),
    components: sortByStart(ctx.components),
    interfaces: sortByStart(ctx.interfaces),
    exports: sortByStart(ctx.exports),
    blocks: sortByStart(ctx.blocks),
    apis: sortByStart(ctx.apis),
    schemas: sortByStart(ctx.schemas),
    ...(ctx.errors.length ? { errors: ctx.errors } : {}),
  };
}

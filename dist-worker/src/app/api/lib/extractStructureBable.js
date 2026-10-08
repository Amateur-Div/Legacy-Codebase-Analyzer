"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractStructureBabel = extractStructureBabel;
const babelParser = __importStar(require("@babel/parser"));
const traverse_1 = __importDefault(require("@babel/traverse"));
const types_1 = require("@babel/types");
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
function createContext(filePath, code) {
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
function normalizeFilePath(path) {
    return path.replace(/\\/g, "/");
}
function createImportVisitor(ctx) {
    return {
        enter(path) {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
            const node = path.node;
            if ((0, types_1.isImportDeclaration)(node) && (0, types_1.isStringLiteral)(node.source)) {
                const val = node.source.value;
                if (!ctx.seen.imports.has(val)) {
                    ctx.seen.imports.add(val);
                    ctx.imports.push({
                        id: `import:${normalizeFilePath(ctx.filePath)}:${val}`,
                        name: val,
                        start: (_b = (_a = node.loc) === null || _a === void 0 ? void 0 : _a.start.line) !== null && _b !== void 0 ? _b : 0,
                        end: (_d = (_c = node.loc) === null || _c === void 0 ? void 0 : _c.end.line) !== null && _d !== void 0 ? _d : null,
                    });
                }
            }
            if ((0, types_1.isCallExpression)(node) &&
                node.callee.type === "Identifier" &&
                node.callee.name === "require" &&
                node.arguments.length === 1 &&
                (0, types_1.isStringLiteral)(node.arguments[0])) {
                const val = node.arguments[0].value;
                if (!ctx.seen.imports.has(val)) {
                    ctx.seen.imports.add(val);
                    ctx.imports.push({
                        id: `import:${normalizeFilePath(ctx.filePath)}:${val}`,
                        name: val,
                        start: (_f = (_e = node.loc) === null || _e === void 0 ? void 0 : _e.start.line) !== null && _f !== void 0 ? _f : 0,
                        end: (_h = (_g = node.loc) === null || _g === void 0 ? void 0 : _g.end.line) !== null && _h !== void 0 ? _h : null,
                    });
                }
            }
            if ((0, types_1.isCallExpression)(node) &&
                node.callee.type === "Import" &&
                node.arguments.length === 1 &&
                (0, types_1.isStringLiteral)(node.arguments[0])) {
                const val = node.arguments[0].value;
                if (!ctx.seen.imports.has(val)) {
                    ctx.seen.imports.add(val);
                    ctx.imports.push({
                        id: `import:${normalizeFilePath(ctx.filePath)}:${val}`,
                        name: val,
                        start: (_k = (_j = node.loc) === null || _j === void 0 ? void 0 : _j.start.line) !== null && _k !== void 0 ? _k : 0,
                        end: (_m = (_l = node.loc) === null || _l === void 0 ? void 0 : _l.end.line) !== null && _m !== void 0 ? _m : null,
                    });
                }
            }
        },
    };
}
function extractStructureBabel(filePath, code) {
    var _a, _b, _c, _d;
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
    if (filePath.includes(".spec.") ||
        filePath.includes(".test.") ||
        filePath.includes("/e2e/") ||
        filePath.includes("/__tests__/")) {
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
    }
    catch (err) {
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
                    message: (_a = err.message) !== null && _a !== void 0 ? _a : "Failed to parse file",
                    line: (_b = err.loc) === null || _b === void 0 ? void 0 : _b.line,
                    column: (_c = err.loc) === null || _c === void 0 ? void 0 : _c.column,
                },
            ],
        };
    }
    const ctx = createContext(filePath, code);
    function createSymbolVisitor(ctx) {
        return {
            FunctionDeclaration(path) {
                var _a, _b, _c, _d, _e;
                addSymbol((_a = path.node.id) === null || _a === void 0 ? void 0 : _a.name, {
                    type: "function",
                    start: (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.start.line,
                    end: (_c = path.node.loc) === null || _c === void 0 ? void 0 : _c.end.line,
                });
                if (((_d = path.node.id) === null || _d === void 0 ? void 0 : _d.name) && path.node.body) {
                    addBlock(path.node.id.name, locStart(path.node.body), locEnd(path.node.body));
                }
                if (returnsJSXFromPath(path)) {
                    const key = makeKey((_e = path.node.id) === null || _e === void 0 ? void 0 : _e.name, locStart(path.node), locEnd(path.node));
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
            },
            VariableDeclarator(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                const { id, init } = path.node;
                if ((init === null || init === void 0 ? void 0 : init.type) === "NewExpression" || (init === null || init === void 0 ? void 0 : init.type) === "CallExpression") {
                    const callee = init.callee;
                    const isSchemaCtor = (callee.type === "Identifier" && callee.name === "Schema") ||
                        (callee.type === "MemberExpression" &&
                            ((_a = callee.object) === null || _a === void 0 ? void 0 : _a.name) === "mongoose" &&
                            ((_b = callee.property) === null || _b === void 0 ? void 0 : _b.name) === "Schema");
                    if (isSchemaCtor && init.arguments && init.arguments.length > 0) {
                        const arg0 = init.arguments[0];
                        const arg1 = init.arguments[1];
                        if (arg0 && arg0.type === "ObjectExpression") {
                            const start = ((_c = path.node.loc) === null || _c === void 0 ? void 0 : _c.start.line) || 0;
                            const end = ((_d = path.node.loc) === null || _d === void 0 ? void 0 : _d.end.line) || null;
                            const name = (id.type === "Identifier" && id.name) || "AnonymousSchema";
                            const fields = extractObjectFields(arg0);
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
                if (init &&
                    init.type === "CallExpression" &&
                    init.callee.type === "MemberExpression" &&
                    init.callee.property.type === "Identifier" &&
                    init.callee.property.name === "object") {
                    const framework = init.callee.object.name === "z" ? "zod" : "yup";
                    const arg0 = (_e = init.arguments) === null || _e === void 0 ? void 0 : _e[0];
                    if (arg0 && arg0.type === "ObjectExpression") {
                        const start = locStart(init);
                        const end = locEnd(init);
                        const schemaName = id.type === "Identifier"
                            ? id.name
                            : `${framework}.object@${start}`;
                        const fields = extractObjectFields(arg0);
                        addSchema({ name: schemaName, framework, start, end, fields });
                    }
                }
                if ((init === null || init === void 0 ? void 0 : init.type) === "ObjectExpression") {
                    const start = ((_f = path.node.loc) === null || _f === void 0 ? void 0 : _f.start.line) || 0;
                    const end = ((_g = path.node.loc) === null || _g === void 0 ? void 0 : _g.end.line) || null;
                    const name = id.type === "Identifier" ? id.name : "objSchema";
                    if (/schema/i.test(String(name))) {
                        const fields = extractObjectFields(init);
                        addSchema({ name, framework: "mongoose", start, end, fields });
                    }
                }
                if (id.type === "Identifier" &&
                    init &&
                    ["ArrowFunctionExpression", "FunctionExpression"].includes(init.type)) {
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
                        start: (_h = path.node.loc) === null || _h === void 0 ? void 0 : _h.start.line,
                        end: (_j = path.node.loc) === null || _j === void 0 ? void 0 : _j.end.line,
                    });
                    addFnBodyAsBlock(id.name, init);
                }
            },
            ClassDeclaration(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
                addSymbol((_a = path.node.id) === null || _a === void 0 ? void 0 : _a.name, {
                    type: "class",
                    start: (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.start.line,
                    end: (_c = path.node.loc) === null || _c === void 0 ? void 0 : _c.end.line,
                });
                const node = path.node;
                const className = ((_d = node.id) === null || _d === void 0 ? void 0 : _d.name) || "AnonymousController";
                let basePath = "/";
                if (Array.isArray(node.decorators)) {
                    const controllerDec = node.decorators.find((dec) => {
                        const expr = dec.expression;
                        return (expr &&
                            expr.type === "CallExpression" &&
                            expr.callee.type === "Identifier" &&
                            expr.callee.name === "Controller");
                    });
                    if (((_e = controllerDec === null || controllerDec === void 0 ? void 0 : controllerDec.expression) === null || _e === void 0 ? void 0 : _e.type) === "CallExpression") {
                        basePath =
                            getStringFromNode((_f = controllerDec.expression.arguments) === null || _f === void 0 ? void 0 : _f[0]) || "/";
                    }
                }
                const superClass = path.node.superClass;
                const isReactClass = superClass &&
                    ((superClass.type === "MemberExpression" &&
                        superClass.object.type === "Identifier" &&
                        superClass.object.name === "React") ||
                        (superClass.type === "Identifier" &&
                            ["Component", "PureComponent"].includes(superClass.name)));
                if (isReactClass && ((_g = path.node.id) === null || _g === void 0 ? void 0 : _g.name)) {
                    const key = makeKey(path.node.id.name, locStart(path.node), locEnd(path.node));
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
                const elems = ((_h = node.body) === null || _h === void 0 ? void 0 : _h.body) || [];
                for (const elem of elems) {
                    if (!elem.decorators || elem.decorators.length === 0)
                        continue;
                    for (const mDec of elem.decorators) {
                        const expr = mDec.expression;
                        if (!expr)
                            continue;
                        let decName = null;
                        let argNode = null;
                        if (expr.type === "CallExpression") {
                            if (expr.callee.type === "Identifier")
                                decName = expr.callee.name;
                            else if (expr.callee.type === "MemberExpression")
                                decName = (_k = (_j = expr.callee.property) === null || _j === void 0 ? void 0 : _j.name) !== null && _k !== void 0 ? _k : null;
                            argNode = (_l = expr.arguments) === null || _l === void 0 ? void 0 : _l[0];
                        }
                        else if (expr.type === "Identifier") {
                            decName = expr.name;
                        }
                        else if (expr.type === "MemberExpression") {
                            decName = (_o = (_m = expr.property) === null || _m === void 0 ? void 0 : _m.name) !== null && _o !== void 0 ? _o : null;
                        }
                        if (!decName)
                            continue;
                        const methodName = decName.toUpperCase();
                        if (!HTTP_METHODS.has(methodName))
                            continue;
                        const methodPathRaw = argNode
                            ? getStringFromNode(argNode) || "/"
                            : null;
                        const methodPath = methodPathRaw || "/";
                        const fullPath = joinPaths(basePath, methodPath);
                        ctx.apis.push({
                            id: `api:${normalizeFilePath(ctx.filePath)}`,
                            method: methodName,
                            path: fullPath,
                            start: (_r = (_q = (_p = elem.loc) === null || _p === void 0 ? void 0 : _p.start) === null || _q === void 0 ? void 0 : _q.line) !== null && _r !== void 0 ? _r : 0,
                            end: (_u = (_t = (_s = elem.loc) === null || _s === void 0 ? void 0 : _s.end) === null || _t === void 0 ? void 0 : _t.line) !== null && _u !== void 0 ? _u : null,
                            framework: "nestjs",
                            controller: className,
                        });
                    }
                }
            },
            ExportNamedDeclaration(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                const decl = path.node.declaration;
                if (decl) {
                    if (decl.type === "FunctionDeclaration" && ((_a = decl.id) === null || _a === void 0 ? void 0 : _a.name)) {
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
                            start: (_b = decl.loc) === null || _b === void 0 ? void 0 : _b.start.line,
                            end: (_c = decl.loc) === null || _c === void 0 ? void 0 : _c.end.line,
                        });
                        if (decl.body)
                            addBlock(decl.id.name, locStart(decl.body), locEnd(decl.body));
                    }
                    else if (decl.type === "ClassDeclaration" && ((_d = decl.id) === null || _d === void 0 ? void 0 : _d.name)) {
                        addSymbol(decl.id.name, {
                            type: "class",
                            addToExports: true,
                            start: (_e = decl.loc) === null || _e === void 0 ? void 0 : _e.start.line,
                            end: (_f = decl.loc) === null || _f === void 0 ? void 0 : _f.end.line,
                        });
                    }
                    else if (decl.type === "TSInterfaceDeclaration" ||
                        decl.type === "TSTypeAliasDeclaration") {
                        addSymbol(decl.id.name, {
                            type: "interface",
                            addToExports: true,
                            start: (_g = decl.loc) === null || _g === void 0 ? void 0 : _g.start.line,
                            end: (_h = decl.loc) === null || _h === void 0 ? void 0 : _h.end.line,
                        });
                    }
                    else if (decl.type === "VariableDeclaration") {
                        decl.declarations.forEach((d) => {
                            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                            const name = (_a = d.id) === null || _a === void 0 ? void 0 : _a.name;
                            if (!name)
                                return;
                            addSymbol(name, {
                                addToExports: true,
                                start: (_b = d.loc) === null || _b === void 0 ? void 0 : _b.start.line,
                                end: (_c = d.loc) === null || _c === void 0 ? void 0 : _c.end.line,
                            });
                            const init = d.init;
                            if ((init === null || init === void 0 ? void 0 : init.type) === "ArrowFunctionExpression" ||
                                (init === null || init === void 0 ? void 0 : init.type) === "FunctionExpression") {
                                addSymbol(name, {
                                    type: "function",
                                    start: (_d = d.loc) === null || _d === void 0 ? void 0 : _d.start.line,
                                    end: (_e = d.loc) === null || _e === void 0 ? void 0 : _e.end.line,
                                });
                                addFnBodyAsBlock(name, init);
                            }
                            else if ((init === null || init === void 0 ? void 0 : init.type) === "ClassExpression") {
                                addSymbol(name, {
                                    type: "class",
                                    start: (_f = d.loc) === null || _f === void 0 ? void 0 : _f.start.line,
                                    end: (_g = d.loc) === null || _g === void 0 ? void 0 : _g.end.line,
                                });
                            }
                            if (((_h = d.id) === null || _h === void 0 ? void 0 : _h.type) === "Identifier" &&
                                HTTP_METHODS.has((_j = d.id) === null || _j === void 0 ? void 0 : _j.name.toUpperCase()) &&
                                init &&
                                (init.type === "ArrowFunctionExpression" ||
                                    init.type === "FunctionExpression")) {
                                addApi({
                                    method: (_k = d.id) === null || _k === void 0 ? void 0 : _k.name.toUpperCase(),
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
                    if (spec.type === "ExportSpecifier" &&
                        spec.exported.type === "Identifier") {
                        addSymbol(spec.exported.name, {
                            addToExports: true,
                            start: (_j = spec.loc) === null || _j === void 0 ? void 0 : _j.start.line,
                            end: (_k = spec.loc) === null || _k === void 0 ? void 0 : _k.end.line,
                        });
                    }
                }
            },
            ExportDefaultDeclaration(path) {
                var _a, _b, _c, _d, _e, _f, _g;
                const decl = path.node.declaration;
                const start = (_b = (_a = decl === null || decl === void 0 ? void 0 : decl.loc) === null || _a === void 0 ? void 0 : _a.start.line) !== null && _b !== void 0 ? _b : (_c = path.node.loc) === null || _c === void 0 ? void 0 : _c.start.line;
                const end = (_e = (_d = decl === null || decl === void 0 ? void 0 : decl.loc) === null || _d === void 0 ? void 0 : _d.end.line) !== null && _e !== void 0 ? _e : (_f = path.node.loc) === null || _f === void 0 ? void 0 : _f.end.line;
                if (filePath.includes("/app/api/") ||
                    filePath.includes("/pages/api/")) {
                    if (decl &&
                        (decl.type === "FunctionDeclaration" ||
                            decl.type === "FunctionExpression" ||
                            decl.type === "ArrowFunctionExpression")) {
                        const methods = Array.from(collectReqMethods(decl.body || decl, new Set()));
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
                        }
                        else {
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
                if ((_g = decl === null || decl === void 0 ? void 0 : decl.id) === null || _g === void 0 ? void 0 : _g.name) {
                    addSymbol(decl.id.name, {
                        addToExports: true,
                        type: decl.type === "FunctionDeclaration"
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
                }
                else if (decl === null || decl === void 0 ? void 0 : decl.name) {
                    addSymbol(decl.name, { addToExports: true, start, end });
                }
            },
            AssignmentExpression(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
                const left = path.node.left;
                const right = path.node.right;
                const start = (_a = path.node.loc) === null || _a === void 0 ? void 0 : _a.start.line;
                const end = (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.end.line;
                if (left.type === "MemberExpression" &&
                    right &&
                    (right.type === "FunctionExpression" ||
                        right.type === "ArrowFunctionExpression")) {
                    const fnName = ((_c = left.property) === null || _c === void 0 ? void 0 : _c.type) === "Identifier" ? left.property.name : null;
                    if (fnName) {
                        addSymbol(fnName, {
                            type: "function",
                            start,
                            end,
                        });
                        addFnBodyAsBlock(fnName, right);
                    }
                }
                if (left.type === "MemberExpression" &&
                    left.object.type === "Identifier" &&
                    ["exports", "module"].includes(left.object.name)) {
                    let key = "";
                    if (left.property.type === "Identifier")
                        key = left.property.name;
                    else if (left.property.type === "StringLiteral")
                        key = left.property.value;
                    const isObjectExport = left.object.name === "module" &&
                        left.property.type === "Identifier" &&
                        left.property.name === "exports" &&
                        right.type === "ObjectExpression";
                    if (isObjectExport) {
                        for (const prop of right.properties) {
                            const pKey = ((_d = prop.key) === null || _d === void 0 ? void 0 : _d.name) || ((_e = prop.key) === null || _e === void 0 ? void 0 : _e.value);
                            if (!pKey)
                                continue;
                            addSymbol(pKey, {
                                addToExports: true,
                                start: (_f = prop.loc) === null || _f === void 0 ? void 0 : _f.start.line,
                                end: (_g = prop.loc) === null || _g === void 0 ? void 0 : _g.end.line,
                            });
                            const val = prop.value;
                            if (val.type === "FunctionExpression" ||
                                val.type === "ArrowFunctionExpression") {
                                addSymbol(pKey, {
                                    type: "function",
                                    start: (_h = val.loc) === null || _h === void 0 ? void 0 : _h.start.line,
                                    end: (_j = val.loc) === null || _j === void 0 ? void 0 : _j.end.line,
                                });
                                addFnBodyAsBlock(pKey, val);
                            }
                            else if (val.type === "ClassExpression") {
                                addSymbol(pKey, {
                                    type: "class",
                                    start: (_k = val.loc) === null || _k === void 0 ? void 0 : _k.start.line,
                                    end: (_l = val.loc) === null || _l === void 0 ? void 0 : _l.end.line,
                                });
                            }
                        }
                    }
                    else if (key) {
                        addSymbol(key, { addToExports: true, start, end });
                        if (right.type === "FunctionExpression" ||
                            right.type === "ArrowFunctionExpression") {
                            addSymbol(key, { type: "function", start, end });
                            addFnBodyAsBlock(key, right);
                        }
                        else if (right.type === "ClassExpression") {
                            addSymbol(key, { type: "class", start, end });
                        }
                    }
                }
            },
        };
    }
    function createBlockVisitor(ctx) {
        return {
            BlockStatement(path) {
                var _a;
                const parent = (_a = path.parentPath) === null || _a === void 0 ? void 0 : _a.node;
                if (parent &&
                    (parent.type === "FunctionDeclaration" ||
                        parent.type === "FunctionExpression" ||
                        parent.type === "ArrowFunctionExpression" ||
                        parent.type === "ClassMethod")) {
                    return;
                }
                addBlock("{block}", locStart(path.node), locEnd(path.node));
            },
            IfStatement(path) {
                addBlock("if", locStart(path.node.consequent), locEnd(path.node.consequent));
                if (path.node.alternate) {
                    addBlock("else", locStart(path.node.alternate), locEnd(path.node.alternate));
                }
            },
            ForStatement(path) {
                addBlock("for", locStart(path.node.body), locEnd(path.node.body));
            },
            WhileStatement(path) {
                addBlock("while", locStart(path.node.body), locEnd(path.node.body));
            },
            SwitchStatement(path) {
                addBlock("switch", locStart(path.node), locEnd(path.node));
            },
            TryStatement(path) {
                if (path.node.block)
                    addBlock("try", locStart(path.node.block), locEnd(path.node.block));
                if (path.node.finalizer)
                    addBlock("finally", locStart(path.node.finalizer), locEnd(path.node.finalizer));
            },
            CatchClause(path) {
                addBlock("catch", locStart(path.node.body), locEnd(path.node.body));
            },
            ObjectExpression(path) {
                const start = locStart(path.node);
                const end = locEnd(path.node);
                if (!start || !end)
                    return;
                if (!spansEnough(start, end) || end - start < 4)
                    return;
                if (start === end)
                    return;
                const p = path.parentPath;
                if (p &&
                    (p.isCallExpression() ||
                        p.isMemberExpression() ||
                        p.isObjectProperty()) &&
                    end - start < 2) {
                    return;
                }
                addBlock("{object}", start, end);
            },
            TSModuleBlock(path) {
                var _a, _b;
                const start = (_a = path.node.loc) === null || _a === void 0 ? void 0 : _a.start.line;
                const end = (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.end.line;
                if (start && end && end - start >= MIN_BLOCK_LINES) {
                    addBlock("declare", start, end);
                }
            },
            JSXElement(path) {
                const p = path.parentPath;
                if (!(p === null || p === void 0 ? void 0 : p.isReturnStatement()) && !(p === null || p === void 0 ? void 0 : p.isVariableDeclarator())) {
                    return;
                }
                const start = locStart(path.node);
                const end = locEnd(path.node);
                if (!spansEnough(start, end) || end - start < 4)
                    return;
                let name = "<JSX>";
                if (path.node.openingElement.name.type === "JSXIdentifier") {
                    name = `<${path.node.openingElement.name.name}>`;
                }
                addBlock(name, start, end);
            },
            TSTypeLiteral(path) {
                var _a, _b;
                const start = (_a = path.node.loc) === null || _a === void 0 ? void 0 : _a.start.line;
                const end = (_b = path.node.loc) === null || _b === void 0 ? void 0 : _b.end.line;
                if (start && end && end - start >= MIN_BLOCK_LINES) {
                    addBlock("type", start, end);
                }
            },
            ReturnStatement(path) {
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
    function createApiSchemaVisitor(ctx) {
        return {
            CallExpression(path) {
                var _a, _b, _c, _d, _e;
                const node = path.node;
                const callee = path.node.callee;
                const args = path.node.arguments || [];
                try {
                    if (node.callee &&
                        node.callee.type === "MemberExpression" &&
                        node.callee.property &&
                        node.callee.property.type === "Identifier" &&
                        node.callee.property.name === "use") {
                        const args = node.arguments || [];
                        const first = args[0];
                        const basePath = getStringFromNode(first);
                        for (let i = 1; i < args.length; i++) {
                            const a = args[i];
                            if (a && a.type === "Identifier" && basePath) {
                                routerMounts.set(a.name, basePath);
                            }
                            else if (a &&
                                a.type === "CallExpression" &&
                                a.callee &&
                                a.callee.type === "Identifier" &&
                                a.callee.name === "Router") {
                            }
                        }
                    }
                    const callee = node.callee;
                    if (callee &&
                        callee.type === "MemberExpression" &&
                        callee.object &&
                        callee.object.type === "Identifier" &&
                        callee.object.name === "mongoose" &&
                        callee.property &&
                        callee.property.type === "Identifier" &&
                        callee.property.name === "model") {
                        const args = node.arguments || [];
                        const modelNameArg = args[0];
                        const schemaArg = args[1];
                        const modelName = getStringFromNode(modelNameArg) || `model@${locStart(node)}`;
                        if (schemaArg && schemaArg.type === "NewExpression") {
                            const ctor = schemaArg.callee;
                            const isSchemaCtor = (ctor.type === "Identifier" && ctor.name === "Schema") ||
                                (ctor.type === "MemberExpression" &&
                                    ((_a = ctor.object) === null || _a === void 0 ? void 0 : _a.name) === "mongoose" &&
                                    ((_b = ctor.property) === null || _b === void 0 ? void 0 : _b.name) === "Schema");
                            if (isSchemaCtor) {
                                const arg0 = (_c = schemaArg.arguments) === null || _c === void 0 ? void 0 : _c[0];
                                const arg1 = (_d = schemaArg.arguments) === null || _d === void 0 ? void 0 : _d[1];
                                if (arg0 && arg0.type === "ObjectExpression") {
                                    const fields = extractObjectFields(arg0);
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
                }
                catch (err) {
                    console.log(err);
                }
                const routeInfo = extractRouteFromCall(node);
                if (routeInfo) {
                    let finalPath = routeInfo.path;
                    if (routeInfo.mountFor && routerMounts.has(routeInfo.mountFor)) {
                        finalPath = joinPaths(routerMounts.get(routeInfo.mountFor), routeInfo.path);
                    }
                    addApi({
                        method: routeInfo.method,
                        path: finalPath,
                        start: routeInfo.start,
                        end: routeInfo.end,
                        framework: routeInfo.framework,
                    });
                }
                if (callee.type === "MemberExpression" &&
                    callee.object.type === "CallExpression" &&
                    callee.object.callee.type === "MemberExpression" &&
                    callee.object.callee.property.type === "Identifier" &&
                    callee.object.callee.property.name === "route" &&
                    callee.object.arguments.length >= 1 &&
                    callee.object.arguments[0].type === "StringLiteral" &&
                    callee.property.type === "Identifier") {
                    const method = callee.property.name.toUpperCase();
                    if (HTTP_METHODS.has(method)) {
                        const pathArg = callee.object.arguments[0];
                        addApi({
                            method,
                            path: pathArg.value,
                            start: locStart(node),
                            end: locEnd(node),
                            framework: "express",
                        });
                    }
                }
                let name;
                if (callee.type === "MemberExpression")
                    name = calleeName(callee);
                if (!name)
                    return;
                for (const arg of args) {
                    if (arg &&
                        (arg.type === "ArrowFunctionExpression" ||
                            arg.type === "FunctionExpression") &&
                        ((_e = arg.body) === null || _e === void 0 ? void 0 : _e.type) === "BlockStatement") {
                        const body = arg.body;
                        let displayName = name;
                        if (name.includes("."))
                            displayName = name.split(".").pop();
                        if (/^app\./.test(name))
                            displayName = name;
                        addBlock(displayName, locStart(body), locEnd(body));
                    }
                }
            },
            TSTypeAliasDeclaration(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                const node = path.node;
                const name = (_a = node.id) === null || _a === void 0 ? void 0 : _a.name;
                const start = ((_b = node.loc) === null || _b === void 0 ? void 0 : _b.start.line) || 0;
                const end = ((_c = node.loc) === null || _c === void 0 ? void 0 : _c.end.line) || null;
                const fields = [];
                const ta = node.typeAnnotation;
                if (ta && ta.type === "TSTypeLiteral") {
                    const members = ta.members || [];
                    for (const mem of members) {
                        if (mem.type === "TSPropertySignature") {
                            const key = getPropName(mem.key) || ((_e = (_d = mem.key) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "unknown");
                            const optional = Boolean(mem.optional);
                            const tAnn = (_g = (_f = mem.typeAnnotation) === null || _f === void 0 ? void 0 : _f.typeAnnotation) !== null && _g !== void 0 ? _g : null;
                            const info = extractTSType(tAnn);
                            fields.push({
                                name: optional ? `${key}?` : key,
                                type: (_h = info.type) !== null && _h !== void 0 ? _h : null,
                                children: info.children,
                                auto: false,
                            });
                        }
                    }
                    if (name)
                        addSchema({ name, framework: "ts", start, end, fields });
                }
                addSymbol(path.node.id.name, {
                    type: "interface",
                    start: (_j = path.node.loc) === null || _j === void 0 ? void 0 : _j.start.line,
                    end: (_k = path.node.loc) === null || _k === void 0 ? void 0 : _k.end.line,
                });
            },
            TSInterfaceDeclaration(path) {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                const node = path.node;
                const name = (_a = node.id) === null || _a === void 0 ? void 0 : _a.name;
                const start = ((_b = node.loc) === null || _b === void 0 ? void 0 : _b.start.line) || 0;
                const end = ((_c = node.loc) === null || _c === void 0 ? void 0 : _c.end.line) || null;
                const fields = [];
                if (node.body && Array.isArray(node.body.body)) {
                    for (const mem of node.body.body) {
                        if (mem.type === "TSPropertySignature") {
                            const key = getPropName(mem.key) || ((_e = (_d = mem.key) === null || _d === void 0 ? void 0 : _d.name) !== null && _e !== void 0 ? _e : "unknown");
                            const optional = Boolean(mem.optional);
                            const tAnn = (_g = (_f = mem.typeAnnotation) === null || _f === void 0 ? void 0 : _f.typeAnnotation) !== null && _g !== void 0 ? _g : null;
                            const info = extractTSType(tAnn);
                            fields.push({
                                name: optional ? `${key}?` : key,
                                type: (_h = info.type) !== null && _h !== void 0 ? _h : null,
                                children: info.children,
                                auto: false,
                            });
                        }
                    }
                }
                if (name)
                    addSchema({ name, framework: "ts", start, end, fields });
                addSymbol(path.node.id.name, {
                    type: "interface",
                    start: (_j = path.node.loc) === null || _j === void 0 ? void 0 : _j.start.line,
                    end: (_k = path.node.loc) === null || _k === void 0 ? void 0 : _k.end.line,
                });
            },
        };
    }
    function makeSymbolId(type, filePath, name) {
        return `${type}:${normalizeFilePath(filePath)}:${name}`;
    }
    function makeApiId(method, path) {
        return `api:${method.toUpperCase()}:${path}`;
    }
    function makeSchemaId(framework, name) {
        return `schema:${framework}:${name}`;
    }
    const makeKey = (name, start, end) => `${name}:${start !== null && start !== void 0 ? start : 0}:${end !== null && end !== void 0 ? end : "?"}`;
    function locStart(n) {
        var _a, _b, _c;
        return (_c = (_b = (_a = n === null || n === void 0 ? void 0 : n.loc) === null || _a === void 0 ? void 0 : _a.start) === null || _b === void 0 ? void 0 : _b.line) !== null && _c !== void 0 ? _c : 0;
    }
    function locEnd(n) {
        var _a, _b, _c;
        return (_c = (_b = (_a = n === null || n === void 0 ? void 0 : n.loc) === null || _a === void 0 ? void 0 : _a.end) === null || _b === void 0 ? void 0 : _b.line) !== null && _c !== void 0 ? _c : null;
    }
    const spansEnough = (s, e) => typeof s === "number" && typeof e === "number" && e - s >= MIN_BLOCK_SPAN;
    const addSymbol = (name, opts = {}) => {
        var _a, _b;
        if (!name)
            return;
        const start = (_a = opts.start) !== null && _a !== void 0 ? _a : 0;
        const end = (_b = opts.end) !== null && _b !== void 0 ? _b : null;
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
    const addImportIfNew = (val, start, end) => {
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
    function normalizePath(raw) {
        if (!raw)
            return "/";
        return (raw.replace(/^['"]/, "").replace(/['"]$/, "").replace(/\/+/g, "/") || "/");
    }
    const addBlock = (name, start, end) => {
        if (!name)
            return;
        if (!spansEnough(start, end))
            return;
        const key = makeKey(name, start, end);
        if (ctx.seen.blocks.has(key))
            return;
        ctx.seen.blocks.add(key);
        ctx.blocks.push({
            id: `block:${normalizeFilePath(ctx.filePath)}:${name}:${start}`,
            name,
            start: start,
            end: end,
        });
    };
    function addApi(info, alsoAddFoldBlock = true) {
        var _a, _b, _c, _d, _e;
        const method = ((_a = info.method) !== null && _a !== void 0 ? _a : "").toUpperCase();
        const path = (_b = info.path) !== null && _b !== void 0 ? _b : "/";
        const start = (_c = info.start) !== null && _c !== void 0 ? _c : 0;
        const end = (_d = info.end) !== null && _d !== void 0 ? _d : null;
        const framework = (_e = info.framework) !== null && _e !== void 0 ? _e : "unknown";
        if (!HTTP_METHODS.has(method))
            return;
        const key = `${framework}|${method}|${path}|${start}|${end !== null && end !== void 0 ? end : "?"}`;
        if (ctx.seen.apis.has(key))
            return;
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
    function addSchema(s) {
        const key = makeKey(s.name, s.start, s.end);
        if (ctx.seen.schemas.has(key))
            return;
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
    function getStringFromNode(node) {
        if (!node)
            return null;
        if (node.type === "StringLiteral")
            return node.value;
        if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
            return node.quasis.map((q) => q.value.cooked).join("");
        }
        return null;
    }
    const routerMounts = new Map();
    function getRootIdentifier(expr) {
        let cur = expr;
        while (cur) {
            if (cur.type === "Identifier")
                return cur.name;
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
    function returnsJSXFromPath(path) {
        let found = false;
        path.traverse({
            ReturnStatement(p) {
                const arg = p.node.argument;
                if (!arg)
                    return;
                if (arg.type === "JSXElement" || arg.type === "JSXFragment") {
                    found = true;
                    p.stop();
                    return;
                }
                if (arg.type === "CallExpression" &&
                    arg.callee.type === "MemberExpression" &&
                    arg.callee.object.type === "Identifier" &&
                    arg.callee.object.name === "React" &&
                    arg.callee.property.type === "Identifier" &&
                    arg.callee.property.name === "createElement") {
                    found = true;
                    p.stop();
                }
            },
        });
        return found;
    }
    function joinPaths(base, part) {
        const b = (base || "/").toString();
        const p = (part || "/").toString();
        const baseNorm = b === "/" ? "" : b.replace(/\/+$/, "");
        const partNorm = p.startsWith("/") ? p : `/${p}`;
        const out = `${baseNorm}${partNorm}`.replace(/\/+/g, "/");
        return out === "" ? "/" : out;
    }
    function detectFrameworkFromCallee(callee) {
        var _a;
        if (!callee)
            return "unknown";
        const root = getRootIdentifier(callee.object);
        if (root === "app" || root === "router")
            return "express";
        try {
            if (callee.object && callee.object.type === "CallExpression") {
                const inner = callee.object.callee;
                if (inner &&
                    inner.type === "MemberExpression" &&
                    ((_a = inner.property) === null || _a === void 0 ? void 0 : _a.name) === "route") {
                    return "express";
                }
            }
        }
        catch (e) { }
        return "unknown";
    }
    function findNearestRouteCallFromMember(calleeNode) {
        var _a;
        let cur = calleeNode;
        while (cur) {
            if (cur.type === "CallExpression" &&
                cur.callee &&
                cur.callee.type === "MemberExpression" &&
                cur.callee.property &&
                cur.callee.property.type === "Identifier" &&
                cur.callee.property.name === "route") {
                return cur;
            }
            if (cur.type === "CallExpression" &&
                ((_a = cur.callee) === null || _a === void 0 ? void 0 : _a.type) === "MemberExpression") {
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
    function getRootIdentifierName(node) {
        var _a, _b, _c;
        let cur = node;
        while (cur) {
            if (cur.type === "Identifier")
                return cur.name;
            if (cur.type === "MemberExpression") {
                cur = cur.object;
                continue;
            }
            if (cur.type === "CallExpression" && cur.callee) {
                cur = (_c = (_a = cur.callee.object) !== null && _a !== void 0 ? _a : (_b = cur.arguments) === null || _b === void 0 ? void 0 : _b[0]) !== null && _c !== void 0 ? _c : null;
                continue;
            }
            break;
        }
        return null;
    }
    function extractRouteFromCall(node) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const callee = node.callee;
        if (!callee || callee.type !== "MemberExpression")
            return null;
        const prop = callee.property;
        if (!prop || prop.type !== "Identifier")
            return null;
        const method = prop.name.toUpperCase();
        if (!HTTP_METHODS.has(method))
            return null;
        if (callee.object &&
            callee.object.type === "Identifier" &&
            ["app", "router"].includes(callee.object.name)) {
            const firstArg = node.arguments && node.arguments[0];
            const pathStr = (_a = getStringFromNode(firstArg)) !== null && _a !== void 0 ? _a : "<dynamic>";
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
            const routeArg = (_b = routeCall.arguments) === null || _b === void 0 ? void 0 : _b[0];
            const routePath = (_c = getStringFromNode(routeArg)) !== null && _c !== void 0 ? _c : "<dynamic>";
            const routeRootName = getRootIdentifierName((_e = (_d = routeCall.callee) === null || _d === void 0 ? void 0 : _d.object) !== null && _e !== void 0 ? _e : routeCall.callee);
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
            const pathStr = (_f = getStringFromNode(firstArg)) !== null && _f !== void 0 ? _f : "<dynamic>";
            const rootName = getRootIdentifierName((_h = (_g = callee.object.callee) === null || _g === void 0 ? void 0 : _g.object) !== null && _h !== void 0 ? _h : callee.object.callee);
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
    function isReqMethodMember(node) {
        var _a, _b, _c;
        return (node &&
            node.type === "MemberExpression" &&
            ((_a = node.object) === null || _a === void 0 ? void 0 : _a.type) === "Identifier" &&
            node.object.name === "req" &&
            ((((_b = node.property) === null || _b === void 0 ? void 0 : _b.type) === "Identifier" &&
                node.property.name === "method") ||
                (((_c = node.property) === null || _c === void 0 ? void 0 : _c.type) === "StringLiteral" &&
                    node.property.value === "method")));
    }
    function collectReqMethods(node, out = new Set()) {
        var _a, _b;
        if (!node || typeof node !== "object")
            return out;
        if (node.type === "BinaryExpression" &&
            (node.operator === "===" || node.operator === "==")) {
            if (isReqMethodMember(node.left) &&
                ((_a = node.right) === null || _a === void 0 ? void 0 : _a.type) === "StringLiteral") {
                out.add(node.right.value.toUpperCase());
            }
            else if (isReqMethodMember(node.right) &&
                ((_b = node.left) === null || _b === void 0 ? void 0 : _b.type) === "StringLiteral") {
                out.add(node.left.value.toUpperCase());
            }
        }
        if (node.type === "SwitchStatement" &&
            isReqMethodMember(node.discriminant)) {
            for (const cs of node.cases || []) {
                if (cs.test && cs.test.type === "StringLiteral")
                    out.add(cs.test.value.toUpperCase());
            }
        }
        for (const k of Object.keys(node)) {
            const v = node[k];
            if (Array.isArray(v)) {
                v.forEach((c) => collectReqMethods(c, out));
            }
            else if (v && typeof v === "object") {
                collectReqMethods(v, out);
            }
        }
        return out;
    }
    function getPropName(key) {
        if (!key)
            return null;
        if (key.type === "Identifier")
            return key.name;
        if (key.type === "StringLiteral")
            return key.value;
        if (key.type === "NumericLiteral")
            return String(key.value);
        return null;
    }
    function getCalleeParts(expr) {
        var _a, _b, _c;
        if (!expr)
            return [];
        if (expr.type === "Identifier")
            return [expr.name];
        if (expr.type === "MemberExpression") {
            const parts = [];
            let cur = expr;
            while (cur) {
                if (cur.property) {
                    if (cur.property.type === "Identifier")
                        parts.unshift(cur.property.name);
                    else if (cur.property.type === "StringLiteral")
                        parts.unshift(cur.property.value);
                }
                if (((_a = cur.object) === null || _a === void 0 ? void 0 : _a.type) === "Identifier") {
                    parts.unshift(cur.object.name);
                    break;
                }
                else if (((_b = cur.object) === null || _b === void 0 ? void 0 : _b.type) === "MemberExpression") {
                    cur = cur.object;
                    continue;
                }
                else if (((_c = cur.object) === null || _c === void 0 ? void 0 : _c.type) === "CallExpression") {
                    const inner = getCalleeParts(cur.object.callee);
                    if (inner.length) {
                        parts.unshift(...inner);
                    }
                    break;
                }
                else {
                    break;
                }
            }
            return parts;
        }
        if (expr.type === "CallExpression")
            return getCalleeParts(expr.callee);
        return [];
    }
    function simplifyTypeName(raw) {
        if (!raw)
            return "any";
        let s = raw;
        s = s.replace(/\(\)$/g, "");
        const arrMatch = s.match(/^array<(.+)>$/);
        if (arrMatch)
            return `array<${simplifyTypeName(arrMatch[1])}>`;
        const parts = s.split(".");
        if (parts.length >= 2) {
            const root = parts[0].toLowerCase();
            if (root === "z" || root === "zod")
                return parts[1];
            if (root === "yup" || root === "y")
                return parts[1];
        }
        if (s.includes(".")) {
            const p = s.split(".");
            return p[p.length - 1];
        }
        return s;
    }
    function nodeToTypeString(n) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (!n)
            return null;
        switch (n.type) {
            case "Identifier":
                return n.name;
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
                const mem = n;
                try {
                    let parts = [];
                    let cur = mem;
                    while (cur) {
                        if ((_a = cur.property) === null || _a === void 0 ? void 0 : _a.name)
                            parts.unshift(cur.property.name);
                        if ((_b = cur.object) === null || _b === void 0 ? void 0 : _b.name) {
                            parts.unshift(cur.object.name);
                            break;
                        }
                        cur = cur.object;
                    }
                    return parts.join(".");
                }
                catch {
                    return "member";
                }
            }
            case "CallExpression": {
                const call = n;
                const parts = getCalleeParts(call.callee);
                if (parts.length) {
                    const root = (_c = parts[0]) === null || _c === void 0 ? void 0 : _c.toLowerCase();
                    const method = (_d = parts[1]) !== null && _d !== void 0 ? _d : parts[parts.length - 1];
                    if (root === "z" || root === "zod") {
                        if (method === "array") {
                            const arg = (_e = call.arguments) === null || _e === void 0 ? void 0 : _e[0];
                            if (arg) {
                                if (arg.type === "ObjectExpression")
                                    return "array<object>";
                                const inner = nodeToTypeString(arg) || "any";
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
                                const prop = call.callee.property;
                                if (prop && prop.type === "Identifier" && prop.name === "of") {
                                    const inner = (_f = call.arguments) === null || _f === void 0 ? void 0 : _f[0];
                                    const innerType = nodeToTypeString(inner) || "any";
                                    return `array<${simplifyTypeName(innerType)}>`;
                                }
                            }
                            const arg = (_g = call.arguments) === null || _g === void 0 ? void 0 : _g[0];
                            if (arg) {
                                if (arg.type === "ObjectExpression")
                                    return "array<object>";
                                const inner = nodeToTypeString(arg) || "any";
                                return `array<${simplifyTypeName(inner)}>`;
                            }
                            return "array<any>";
                        }
                        if (method === "object")
                            return "object";
                        if (method)
                            return method;
                    }
                }
                if (call.callee.type === "Identifier")
                    return simplifyTypeName(call.callee.name + "()");
                if (call.callee.type === "MemberExpression")
                    return simplifyTypeName(memberToString(call.callee) + "()");
                return "call";
            }
            default:
                return n.type;
        }
    }
    function extractObjectFields(obj) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const fields = [];
        for (const prop of obj.properties) {
            if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod")
                continue;
            if (prop.type === "ObjectMethod") {
                continue;
            }
            const p = prop;
            const name = getPropName(p.key) || "<computed>";
            const value = p.value;
            const field = {
                name,
                type: null,
                raw: undefined,
                auto: false,
            };
            if (!value) {
                fields.push(field);
                continue;
            }
            const extractTypeProp = (objExpr) => {
                const typeProp = objExpr.properties.find((pr) => pr.type === "ObjectProperty" &&
                    getPropName(pr.key) === "type");
                return typeProp !== null && typeProp !== void 0 ? typeProp : null;
            };
            if (value.type === "ObjectExpression") {
                const childObj = value;
                const typeProp = extractTypeProp(childObj);
                if (typeProp) {
                    const tnode = typeProp.value;
                    if (tnode.type === "ArrayExpression") {
                        const el = (_a = tnode.elements) === null || _a === void 0 ? void 0 : _a[0];
                        if (el && el.type === "ObjectExpression") {
                            field.type = "array<object>";
                            field.children = extractObjectFields(el);
                            field.raw = objToText(el) || undefined;
                        }
                        else {
                            const elType = el ? nodeToTypeString(el) : "any";
                            field.type = `array<${elType !== null && elType !== void 0 ? elType : "any"}>`;
                            field.raw = objToText(childObj) || undefined;
                        }
                    }
                    else if (tnode.type === "ObjectExpression") {
                        field.type = "object";
                        field.children = extractObjectFields(tnode);
                        field.raw = objToText(tnode) || undefined;
                    }
                    else {
                        field.type = nodeToTypeString(tnode) || null;
                        field.raw = objToText(childObj) || undefined;
                    }
                }
                else {
                    field.type = "object";
                    field.children = extractObjectFields(childObj);
                    field.raw = objToText(childObj) || undefined;
                }
            }
            else if (value.type === "ArrayExpression") {
                const arr = value;
                const el = (_b = arr.elements) === null || _b === void 0 ? void 0 : _b[0];
                if (el) {
                    if (el.type === "ObjectExpression") {
                        field.type = "array<object>";
                        field.children = extractObjectFields(el);
                        field.raw = objToText(el) || undefined;
                    }
                    else {
                        const t = nodeToTypeString(el) || "any";
                        field.type = `array<${t}>`;
                        field.raw = el.type;
                    }
                }
                else {
                    field.type = "array<any>";
                }
            }
            else if (value.type === "CallExpression") {
                const call = value;
                const callee = call.callee;
                if (callee && callee.type === "MemberExpression") {
                    const obj = callee.object;
                    const propName = (_f = (_d = (_c = callee.property) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : (_e = callee.property) === null || _e === void 0 ? void 0 : _e.value) !== null && _f !== void 0 ? _f : "";
                    if (obj &&
                        obj.type === "Identifier" &&
                        (obj.name === "z" ||
                            obj.name === "zod" ||
                            obj.name === "yup" ||
                            obj.name === "Yup")) {
                        if (propName === "array") {
                            const arg0 = (_g = call.arguments) === null || _g === void 0 ? void 0 : _g[0];
                            if (arg0) {
                                if (arg0.type === "ObjectExpression") {
                                    field.type = "array<object>";
                                    field.children = extractObjectFields(arg0);
                                    field.raw = objToText(arg0) || undefined;
                                }
                                else if (arg0.type === "CallExpression") {
                                    const innerCall = arg0;
                                    const innerCallee = innerCall.callee;
                                    if (innerCallee &&
                                        innerCallee.type === "MemberExpression" &&
                                        ((_h = innerCallee.property) === null || _h === void 0 ? void 0 : _h.name) === "object") {
                                        const innerArg = (_j = innerCall.arguments) === null || _j === void 0 ? void 0 : _j[0];
                                        if (innerArg && innerArg.type === "ObjectExpression") {
                                            field.type = "array<object>";
                                            field.children = extractObjectFields(innerArg);
                                            field.raw =
                                                objToText(innerArg) || undefined;
                                        }
                                        else {
                                            const innerType = nodeToTypeString((_k = innerCall.arguments) === null || _k === void 0 ? void 0 : _k[0]) ||
                                                "any";
                                            field.type = `array<${innerType}>`;
                                            field.raw = "call";
                                        }
                                    }
                                    else {
                                        const innerType = nodeToTypeString(arg0) || "any";
                                        field.type = `array<${innerType}>`;
                                        field.raw = "call";
                                    }
                                }
                                else {
                                    const innerType = nodeToTypeString(arg0) || "any";
                                    field.type = `array<${innerType}>`;
                                    field.raw = "call";
                                }
                            }
                            else {
                                field.type = "array<any>";
                            }
                        }
                        else if (propName === "object") {
                            const arg0 = (_l = call.arguments) === null || _l === void 0 ? void 0 : _l[0];
                            if (arg0 && arg0.type === "ObjectExpression") {
                                field.type = "object";
                                field.children = extractObjectFields(arg0);
                                field.raw = objToText(arg0) || undefined;
                            }
                            else {
                                field.type = "object";
                                field.raw = "call";
                            }
                        }
                        else if (["string", "number", "boolean", "date"].includes(propName)) {
                            const map = {
                                string: "string",
                                number: "number",
                                boolean: "boolean",
                                date: "Date",
                            };
                            field.type = map[propName] || propName;
                            field.raw = "call";
                        }
                        else {
                            field.type = nodeToTypeString(call) || null;
                            field.raw = "call";
                        }
                        fields.push(field);
                        continue;
                    }
                }
                field.type = nodeToTypeString(call) || null;
                field.raw = "call";
                fields.push(field);
                continue;
            }
            fields.push(field);
        }
        return fields;
    }
    function objToText(node) {
        if (!node)
            return null;
        try {
            const parts = [];
            for (const prop of node.properties) {
                if (prop.type === "ObjectProperty") {
                    const pn = getPropName(prop.key) || "k";
                    const val = prop.value;
                    let v = "";
                    if (val.type === "Identifier")
                        v = val.name;
                    else if (val.type === "StringLiteral")
                        v = "${(val as StringLiteral).value}";
                    else if (val.type === "ArrayExpression")
                        v = "[]";
                    else if (val.type === "ObjectExpression")
                        v = "{...}";
                    else
                        v = val.type;
                    parts.push(`${pn}: ${v}`);
                }
            }
            return `{ ${parts.join(", ")} }`;
        }
        catch {
            return null;
        }
    }
    function schemaOptionsHaveTimestamps(node) {
        if (!node)
            return false;
        if (node.type !== "ObjectExpression")
            return false;
        for (const prop of node.properties) {
            if (prop.type !== "ObjectProperty")
                continue;
            const key = getPropName(prop.key);
            if (key === "timestamps") {
                const val = prop.value;
                if (!val)
                    return false;
                if (val.type === "BooleanLiteral")
                    return !!val.value;
                if (val.type === "ObjectExpression")
                    return true;
            }
        }
        return false;
    }
    const memberToString = (m) => {
        const object = m.object.type === "Identifier"
            ? m.object.name
            : m.object.type === "MemberExpression"
                ? memberToString(m.object)
                : "";
        const prop = m.property.type === "Identifier"
            ? m.property.name
            : m.property.type === "StringLiteral"
                ? m.property.value
                : "";
        return object && prop ? `${object}.${prop}` : prop || object || "";
    };
    function getTsTypeName(typeName) {
        if (!typeName)
            return "unknown";
        if (typeName.type === "Identifier")
            return typeName.name;
        if (typeName.type === "TSQualifiedName") {
            const left = getTsTypeName(typeName.left);
            const right = getTsTypeName(typeName.right);
            return `${left}.${right}`;
        }
        return "unknown";
    }
    function extractTSType(node) {
        var _a;
        if (!node)
            return { type: null };
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
                return { type: `array<${(_a = elInfo.type) !== null && _a !== void 0 ? _a : "any"}>` };
            }
            case "TSUnionType": {
                const parts = (node.types || []).map((t) => extractTSType(t).type || "any");
                return { type: parts.join("|") };
            }
            case "TSLiteralType": {
                const lit = node.literal;
                if (!lit)
                    return { type: "literal" };
                if (lit.type === "StringLiteral")
                    return { type: `\"${lit.value}\"` };
                if (lit.type === "NumericLiteral")
                    return { type: String(lit.value) };
                if (lit.type === "BooleanLiteral")
                    return { type: String(lit.value) };
                return { type: "literal" };
            }
            case "TSParenthesizedType":
                return extractTSType(node.typeAnnotation);
            case "TSFunctionType":
                return { type: "function" };
            default: {
                try {
                    const t = typeof nodeToTypeString === "function"
                        ? nodeToTypeString(node)
                        : null;
                    return { type: t || node.type };
                }
                catch {
                    return { type: node.type };
                }
            }
        }
    }
    function extractTSTypeLiteralMembers(node) {
        var _a, _b, _c, _d, _e;
        const members = (node === null || node === void 0 ? void 0 : node.members) || [];
        const out = [];
        for (const mem of members) {
            if (mem.type !== "TSPropertySignature")
                continue;
            const key = getPropName(mem.key) || ((_b = (_a = mem.key) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "unknown");
            const optional = Boolean(mem.optional);
            const tAnn = (_d = (_c = mem.typeAnnotation) === null || _c === void 0 ? void 0 : _c.typeAnnotation) !== null && _d !== void 0 ? _d : null;
            const info = extractTSType(tAnn);
            out.push({
                name: optional ? `${key}?` : key,
                type: (_e = info.type) !== null && _e !== void 0 ? _e : null,
                children: info.children,
                auto: false,
            });
        }
        return out;
    }
    const exprToName = (expr) => {
        if (!expr)
            return "";
        if (expr.type === "Identifier")
            return expr.name;
        if (expr.type === "MemberExpression")
            return memberToString(expr);
        return "";
    };
    const calleeName = (expr) => {
        if (!expr)
            return "";
        if (expr.type === "Identifier")
            return expr.name;
        if (expr.type === "MemberExpression")
            return memberToString(expr);
        return "";
    };
    const addFnBodyAsBlock = (name, fn) => {
        if (fn.body && fn.body.type === "BlockStatement") {
            addBlock(name, locStart(fn.body), locEnd(fn.body));
        }
    };
    const hasApi = code.includes(".get(") ||
        code.includes(".post(") ||
        code.includes(".put(") ||
        code.includes(".delete(") ||
        code.includes("route(");
    const hasSchema = code.includes("Schema(") ||
        code.includes(".object(") ||
        code.includes("interface ") ||
        code.includes("type ");
    const hasJSX = code.includes("<") && code.includes(">");
    const hasBlocks = code.includes("{") && code.includes("}");
    if (!hasApi && !hasSchema && !hasJSX && !hasBlocks) {
        (0, traverse_1.default)(ast, {
            ...createImportVisitor(ctx),
            ...createSymbolVisitor(ctx),
        });
    }
    else {
        try {
            (0, traverse_1.default)(ast, {
                ...createImportVisitor(ctx),
                ...createSymbolVisitor(ctx),
                ...createBlockVisitor(ctx),
                ...createApiSchemaVisitor(ctx),
            });
        }
        catch (err) {
            ctx.errors.push({
                message: `Traversal failed : ${(_d = err === null || err === void 0 ? void 0 : err.message) !== null && _d !== void 0 ? _d : err}`,
            });
        }
    }
    const sortByStart = (arr) => arr.sort((a, b) => (a.start || 0) - (b.start || 0));
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

import * as babelParser from "@babel/parser";
import generate from "@babel/generator";
import * as t from "@babel/types";
import { FlowEdge, FlowGraph, FlowNode } from "./analyzer/types";

export function instrumentExecutionBabel(code: string): FlowGraph {
  let idCounter = 0;
  const makeId = (prefix = "n") => `${prefix}#${Date.now()}_${++idCounter}`;

  const tryGen = (node?: t.Node | null) => {
    if (!node) return undefined;
    try {
      return generate(node as any, { concise: true }).code;
    } catch {
      return undefined;
    }
  };

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const addNode = (node: FlowNode) => {
    nodes.push(node);
    return node;
  };

  const addEdge = (from: FlowNode, to: FlowNode, label?: string) => {
    edges.push({ id: `${from.id}->${to.id}`, from: from.id, to: to.id, label });
  };

  const handleStatementSequence = (
    stmts: t.Statement[],
    parentNode?: FlowNode,
  ) => {
    let prevNodes: FlowNode[] = [];

    for (const s of stmts) {
      const line = s.loc?.start?.line ?? 0;
      const code = tryGen(s)?.slice(0, 400);

      if (
        !code ||
        code.startsWith('"use strict"') ||
        code.startsWith("'use strict'")
      ) {
        continue;
      }

      if (t.isIfStatement(s)) {
        const exits = handleIfStatement(
          s,
          prevNodes.length > 0 ? prevNodes[0] : parentNode,
        );

        prevNodes = exits;
        parentNode = undefined;

        continue;
      }

      const nodeType =
        t.isForStatement(s) ||
        t.isWhileStatement(s) ||
        t.isDoWhileStatement(s) ||
        t.isForOfStatement(s) ||
        t.isForInStatement(s)
          ? "loop"
          : t.isFunctionDeclaration(s) || t.isFunctionExpression(s)
            ? "function"
            : "statement";

      const node: FlowNode = addNode({
        id: makeId(nodeType),
        type: nodeType,
        line,
        code,
      });

      if (parentNode) {
        addEdge(parentNode, node, "executes");
      }

      for (const p of prevNodes) {
        addEdge(p, node, "next");
      }
      prevNodes = [node];

      if (
        t.isForStatement(s) ||
        t.isWhileStatement(s) ||
        t.isDoWhileStatement(s) ||
        t.isForOfStatement(s) ||
        t.isForInStatement(s)
      ) {
        handleLoopStatement(s as any, node);
      } else if (t.isFunctionDeclaration(s) || t.isFunctionExpression(s)) {
        const fnDecl = s as t.FunctionDeclaration | t.FunctionExpression;
        const fnName = (fnDecl as any).id?.name ?? "anonymous";

        const fnNode: FlowNode = addNode({
          id: makeId("fn"),
          type: "function",
          name: fnName,
          line,
          code: tryGen(fnDecl)?.slice(0, 400),
        });

        addEdge(node, fnNode, "declares");

        if (fnDecl.body && t.isBlockStatement(fnDecl.body)) {
          const body = fnDecl.body.body;
          if (body.length) {
            const first = body[0];
            const entry: FlowNode = addNode({
              id: makeId("fn-entry"),
              type: "fn-entry",
              code: tryGen(first)?.slice(0, 300),
              line: first.loc?.start.line ?? line,
            });
            addEdge(fnNode, entry, "entry");
            handleStatementSequence(body, entry);
          }
        }
      }
    }

    return prevNodes;
  };

  const handleIfStatement = (
    node: t.IfStatement,
    containerNode?: FlowNode | null,
  ): FlowNode[] => {
    const exits: FlowNode[] = [];

    const ifNode: FlowNode = addNode({
      id: makeId("if"),
      type: "if",
      code: tryGen(node.test),
      line: node.loc?.start?.line ?? 0,
    });

    if (containerNode) {
      addEdge(containerNode, ifNode, "if");
    }

    if (node.consequent) {
      if (t.isBlockStatement(node.consequent) && node.consequent.body.length) {
        const first = node.consequent.body[0];
        const entry = addNode({
          id: makeId("if-true"),
          type: "if-true",
          code: tryGen(first)?.slice(0, 300),
          line: first.loc?.start?.line ?? 0,
        });
        addEdge(ifNode, entry, "true");

        const branchExits = handleStatementSequence(
          node.consequent.body,
          entry,
        );
        exits.push(...branchExits);
      } else if (t.isStatement(node.consequent)) {
        const single = addNode({
          id: makeId("if-true"),
          type: "if-true",
          code: tryGen(node.consequent)?.slice(0, 300),
          line: node.consequent.loc?.start?.line ?? 0,
        });
        addEdge(ifNode, single, "true");
        exits.push(single);
      }
    } else {
      exits.push(ifNode);
    }

    if (node.alternate) {
      if (t.isBlockStatement(node.alternate) && node.alternate.body.length) {
        const first = node.alternate.body[0];
        const entry = addNode({
          id: makeId("if-false"),
          type: "if-false",
          code: tryGen(first)?.slice(0, 300),
          line: first.loc?.start?.line ?? 0,
        });
        addEdge(ifNode, entry, "false");

        const branchExits = handleStatementSequence(node.alternate.body, entry);
        exits.push(...branchExits);
      } else if (t.isStatement(node.alternate)) {
        const single = addNode({
          id: makeId("if-false"),
          type: "if-false",
          code: tryGen(node.alternate)?.slice(0, 300),
          line: node.alternate.loc?.start?.line ?? 0,
        });
        addEdge(ifNode, single, "false");
        exits.push(single);
      }
    } else {
      exits.push(ifNode);
    }

    return exits;
  };

  const handleLoopStatement = (
    node: t.Statement & any,
    containerNode: FlowNode,
  ) => {
    const cond = tryGen(node.test ?? node.right ?? node.init) ?? tryGen(node);
    const loopNode: FlowNode = addNode({
      id: makeId("loop"),
      type: "loop",
      code: cond,
      line: node.loc?.start?.line ?? 0,
    });
    addEdge(containerNode, loopNode, "loop");

    if (node.body && t.isBlockStatement(node.body) && node.body.body.length) {
      const first = node.body.body[0];
      const entry = addNode({
        id: makeId("loop-body"),
        type: "loop-body",
        code: tryGen(first)?.slice(0, 300),
        line: first.loc?.start?.line ?? 0,
      });
      addEdge(loopNode, entry, "body");

      const innerExits = handleStatementSequence(node.body.body, entry);
      for (const exitNode of innerExits) {
        addEdge(exitNode, loopNode, "back");
      }

      const after = addNode({
        id: makeId("after-loop"),
        type: "after-loop",
        code: "after loop",
      });
      addEdge(loopNode, after, "exit");
    } else if (node.body) {
      const entry = addNode({
        id: makeId("loop-body"),
        type: "loop-body",
        code: tryGen(node.body)?.slice(0, 300),
      });
      addEdge(loopNode, entry, "body");
      if (t.isStatement(node.body)) handleStatementSequence([node.body], entry);
    }
  };

  try {
    const ast = babelParser.parse(code, {
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

    const prog = ast.program;

    const rootNode: FlowNode = addNode({
      id: "root",
      type: "root",
      code: "root",
      line: 0,
    });

    handleStatementSequence(prog.body as any as t.Statement[], rootNode);
  } catch (err: any) {
    const errNode: FlowNode = addNode({
      id: makeId("error"),
      type: "error",
      code: String(err?.message ?? err),
    });
  }

  return { nodes, edges };
}

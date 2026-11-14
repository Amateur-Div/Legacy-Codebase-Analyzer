import { describe, expect, it } from "vitest";
import { instrumentExecutionBabel } from "../app/api/lib/instrumentExecutionBabel";

describe("instrumentExecutionBabel - control flow", () => {
  it("creates exactly one if node for an IfStatement", () => {
    const code = `
      if (isReady) {
        run();
      } else {
        stop();
      }
    `;

    const graph = instrumentExecutionBabel(code);

    const ifNodes = graph.nodes.filter((node) => node.type === "if");

    expect(ifNodes).toHaveLength(1);
  });

  it("does not create a generic statement node for an IfStatement", () => {
    const code = `
      if (isReady) {
        run();
      } else {
        stop();
      }
    `;

    const graph = instrumentExecutionBabel(code);

    const duplicateIfStatements = graph.nodes.filter(
      (node) =>
        node.type === "statement" && node.code?.trim().startsWith("if ("),
    );

    expect(duplicateIfStatements).toHaveLength(0);
  });

  it("connects both branch exits to the subsequent statement", () => {
    const code = `
      if (isReady) {
        run();
      } else {
        stop();
      }

      finish();
    `;

    const graph = instrumentExecutionBabel(code);

    const finishNode = graph.nodes.find(
      (node) => node.type === "statement" && node.code?.includes("finish()"),
    );

    expect(finishNode).toBeDefined();

    const incomingNextEdges = graph.edges.filter(
      (edge) => edge.to === finishNode?.id && edge.label === "next",
    );

    expect(incomingNextEdges).toHaveLength(2);
  });

  it("handles an if statement without an else branch", () => {
    const code = `
      if (isReady) {
        run();
      }

      finish();
    `;

    const graph = instrumentExecutionBabel(code);

    const ifNodes = graph.nodes.filter((node) => node.type === "if");

    expect(ifNodes).toHaveLength(1);

    const finishNode = graph.nodes.find(
      (node) => node.type === "statement" && node.code?.includes("finish()"),
    );

    expect(finishNode).toBeDefined();

    const incomingNextEdges = graph.edges.filter(
      (edge) => edge.to === finishNode?.id && edge.label === "next",
    );

    expect(incomingNextEdges.length).toBeGreaterThanOrEqual(1);
  });
});

export function collectReachable(start: string, adj: Map<string, string[]>) {
  const visited = new Set<string>();
  const queue = [start];

  let index = 0;

  while (index < queue.length) {
    const current = queue[index++];

    if (visited.has(current)) continue;

    visited.add(current);

    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        queue.push(next);
      }
    }
  }

  return visited;
}

export function normalizePath(p?: string) {
  if (!p) return null;
  return p.replace(/^\/+/, "").replace(/\\/g, "/");
}

export function normalizeType(type?: string) {
  if (!type) return "statement";

  const t = type.toLowerCase();

  if (t.includes("function")) return "function";

  if (t.includes("loop") || t.includes("for") || t.includes("while")) {
    return "loop";
  }

  if (t.includes("if") || t.includes("switch") || t.includes("case")) {
    return "if";
  }

  if (t.includes("return")) return "statement";

  return t;
}

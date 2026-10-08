"use client";

import { useEffect, useMemo } from "react";
import type { ProjectDependencyAnalysis } from "@/app/api/lib/analyzer/types";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleAlert,
  FileCode2,
  GitBranch,
  Network,
  X,
} from "lucide-react";

type Props = {
  dependencyAnalysis: ProjectDependencyAnalysis;
  selectedFileNode: any;
  fileTree: any;
  fileId: string;
  onClose: () => void;
  onFileChange?: (path: string) => void;
};

function findFileNode(nodes: any, filePath: string): any {
  for (const node of nodes) {
    if (node.type === "file" && node.fullPath === filePath) {
      return node;
    }

    if (node.children) {
      const found = findFileNode(node.children, filePath);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function cleanFileId(fileId: string) {
  return fileId.replace(/^file::/, "");
}

export function ImpactDetailsDrawer({
  dependencyAnalysis,
  selectedFileNode,
  fileTree,
  fileId,
  onClose,
  onFileChange,
}: Props) {
  const cleanPath = fileId.replace(/^file::/, "");

  const fileNode = useMemo(
    () => findFileNode(fileTree, cleanPath),
    [fileTree, cleanPath],
  );

  useEffect(() => {
    console.log(fileNode);
  }, [fileNode]);

  const metric = useMemo(
    () =>
      dependencyAnalysis.fileMetrics?.find((file) => file.fileId === fileId) ??
      null,
    [dependencyAnalysis, fileId],
  );

  const importance = useMemo(
    () =>
      dependencyAnalysis.intelligence.importanceRanking?.find(
        (file) => file.fileId === fileId,
      )?.score ?? 0,
    [dependencyAnalysis, fileId],
  );

  const isDead = useMemo(
    () => dependencyAnalysis.intelligence.deadFiles?.includes(fileId) ?? false,
    [dependencyAnalysis, fileId],
  );

  const cycle = useMemo(
    () =>
      dependencyAnalysis.intelligence.circularDependencies?.find((cycle) =>
        cycle.includes(fileId),
      ) ?? null,
    [dependencyAnalysis, fileId],
  );

  const imports = useMemo(() => fileNode?.impact?.imports ?? [], [fileNode]);

  const usedBy = useMemo(() => fileNode?.impact?.usedBy ?? [], [fileNode]);

  const brokenImports = useMemo(
    () => fileNode?.impact?.brokenImports ?? [],
    [fileNode],
  );

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close impact details"
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
      />

      <aside className="absolute inset-y-0 right-0 w-full max-w-[460px] border-l bg-background shadow-2xl">
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b px-6 py-5">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <FileCode2 className="h-5 w-5 shrink-0 text-primary" />

                <h2 className="text-lg font-semibold">Impact Details</h2>
              </div>

              <p className="break-all text-xs text-muted-foreground">
                {cleanPath}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-md p-2 transition-colors hover:bg-muted"
              aria-label="Close"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
            <div className="grid grid-cols-2 gap-3">
              <InfoCard
                icon={<Network className="h-4 w-4" />}
                label="Importance"
                value={importance}
              />

              <InfoCard
                icon={<GitBranch className="h-4 w-4" />}
                label="Circular"
                value={cycle ? "Yes" : "No"}
              />
            </div>

            {metric && (
              <SectionCard
                title="Connectivity"
                icon={<Network className="h-4 w-4" />}
              >
                <div className="grid grid-cols-3 gap-2">
                  <Metric label="Incoming" value={metric.inDegree} />

                  <Metric label="Outgoing" value={metric.outDegree} />

                  <Metric label="Total" value={metric.totalDegree} />
                </div>

                <div className="rounded-lg border bg-muted/20 px-3 py-3">
                  <div className="mb-1 text-xs text-muted-foreground">
                    Connectivity score
                  </div>

                  <div className="text-sm font-semibold">
                    {metric.score.toFixed(2)}
                  </div>
                </div>
              </SectionCard>
            )}

            <SectionCard
              title="Risk Signals"
              icon={<AlertTriangle className="h-4 w-4" />}
            >
              <div className="space-y-2">
                <StatusRow
                  label="Circular dependency"
                  active={Boolean(cycle)}
                  activeText="File participates in a dependency cycle"
                  inactiveText="No circular dependency detected"
                />

                <StatusRow
                  label="Dead-file analysis"
                  active={isDead}
                  activeText="File is classified as unreachable"
                  inactiveText="File is not classified as dead"
                />

                <StatusRow
                  label="Broken imports"
                  active={brokenImports.length > 0}
                  activeText={`${brokenImports.length} broken import${
                    brokenImports.length === 1 ? "" : "s"
                  } detected`}
                  inactiveText="No broken imports detected"
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Direct Dependents"
              icon={<ArrowDownToLine className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground">
                Files that directly import or depend on this file.
              </p>

              {usedBy.length === 0 ? (
                <EmptyState text="No direct dependents found" />
              ) : (
                <PathList paths={usedBy} onFileChange={onFileChange} />
              )}
            </SectionCard>

            <SectionCard
              title="Dependencies"
              icon={<ArrowUpFromLine className="h-4 w-4" />}
            >
              <p className="text-xs text-muted-foreground">
                Files directly imported by this file.
              </p>

              {imports.length === 0 ? (
                <EmptyState text="No internal dependencies found" />
              ) : (
                <PathList paths={imports} onFileChange={onFileChange} />
              )}
            </SectionCard>

            <SectionCard
              title="Broken Imports"
              icon={<CircleAlert className="h-4 w-4" />}
            >
              {brokenImports.length === 0 ? (
                <EmptyState text="No broken imports found" />
              ) : (
                <ul className="space-y-2">
                  {brokenImports.map((item: any) => (
                    <li
                      key={item.source}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm break-all text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                    >
                      {item.source}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {cycle && (
              <SectionCard
                title="Circular Dependency"
                icon={<GitBranch className="h-4 w-4" />}
              >
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-3 text-sm dark:border-violet-900 dark:bg-violet-950/30">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Detected cycle
                  </p>

                  <div className="break-all text-sm">
                    {cycle.map(cleanFileId).join(" → ")}
                  </div>
                </div>
              </SectionCard>
            )}
          </div>

          {onFileChange && (
            <div className="border-t px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  onFileChange(cleanPath);
                  onClose();
                }}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Open File
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function PathList({
  paths,
  onFileChange,
}: {
  paths: string[];
  onFileChange?: (path: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {paths.map((path) => {
        const cleanPath = cleanFileId(path);

        return (
          <li key={path}>
            {onFileChange ? (
              <button
                type="button"
                onClick={() => onFileChange(cleanPath)}
                className="w-full rounded-lg border bg-muted/30 px-3 py-2 text-left text-sm break-all transition-colors hover:bg-muted"
              >
                {cleanPath}
              </button>
            ) : (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm break-all">
                {cleanPath}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusRow({
  label,
  active,
  activeText,
  inactiveText,
}: {
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>

      <div className="text-sm font-medium">
        {active ? activeText : inactiveText}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/20 px-3 py-3 text-center">
      <div className="text-lg font-semibold">{value}</div>

      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}

        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>

      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2">
        {icon}

        <h3 className="text-sm font-semibold">{title}</h3>
      </div>

      {children}
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

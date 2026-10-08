"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Flame, GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImpactDetailsDrawer } from "./ImpactDetailsDrawer";
import type { ProjectDependencyAnalysis } from "@/app/api/lib/analyzer/types";

type Props = {
  dependencyAnalysis: ProjectDependencyAnalysis;
  selectedFileNode: any;
  fileTree: any;
  onFileChange: (path: string) => void;
};

export function ImpactSummaryCard({
  dependencyAnalysis,
  selectedFileNode,
  fileTree,
  onFileChange,
}: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const intelligence = dependencyAnalysis.intelligence;

  const topFiles = useMemo(
    () => intelligence.importanceRanking?.slice(0, 5) ?? [],
    [intelligence],
  );

  const deadCount = intelligence.deadFiles?.length ?? 0;

  const circularCount = intelligence.circularDependencies?.length ?? 0;

  const missingDependencyCount =
    dependencyAnalysis.stats?.missingDependencyCount ?? 0;

  const riskLevel = useMemo(() => {
    if (circularCount > 0) {
      return {
        label: "High",
        className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
      };
    }

    if (missingDependencyCount > 0 || deadCount > 0) {
      return {
        label: "Medium",
        className:
          "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
      };
    }

    return {
      label: "Low",
      className:
        "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    };
  }, [circularCount, missingDependencyCount, deadCount]);

  return (
    <>
      <Card className="rounded-2xl border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-primary" />

            <span>Impact Summary</span>
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <InfoStat
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Risk"
              value={
                <Badge className={riskLevel.className}>{riskLevel.label}</Badge>
              }
            />

            <InfoStat
              icon={<GitBranch className="h-4 w-4" />}
              label="Cycles"
              value={circularCount}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <InfoStat label="Missing Imports" value={missingDependencyCount} />

            <InfoStat label="Dead Candidates" value={deadCount} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Flame className="h-4 w-4 text-orange-500" />

              <span>Critical Files</span>
            </div>

            {topFiles.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No importance ranking available.
              </div>
            ) : (
              <div className="space-y-2">
                {topFiles.map((file) => {
                  const cleanPath = file.fileId.replace(/^file::/, "");

                  return (
                    <div
                      key={file.fileId}
                      className="rounded-xl border bg-muted/30 px-3 py-2"
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => onFileChange(cleanPath)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="break-all text-sm font-medium">
                            {cleanPath}
                          </p>
                        </button>

                        <Badge variant="secondary" className="shrink-0">
                          {file.score}
                        </Badge>

                        <button
                          type="button"
                          onClick={() => setSelectedFile(file.fileId)}
                          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label={`View impact details for ${cleanPath}`}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedFile && (
        <ImpactDetailsDrawer
          dependencyAnalysis={dependencyAnalysis}
          selectedFileNode={selectedFileNode}
          fileTree={fileTree}
          fileId={selectedFile}
          onClose={() => setSelectedFile(null)}
          onFileChange={onFileChange}
        />
      )}
    </>
  );
}

function InfoStat({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        {icon}

        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>

      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

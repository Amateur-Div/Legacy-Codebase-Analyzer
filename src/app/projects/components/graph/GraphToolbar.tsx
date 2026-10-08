"use client";

import React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Button } from "@/components/ui/button";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { BookOpen, Flame, RotateCcw } from "lucide-react";

interface GraphToolbarProps {
  heatmapMode: "none" | "complexity" | "importance";
  setHeatmapMode: (value: "none" | "complexity" | "importance") => void;

  filterType: string | null;
  setFilterType: (value: string | null) => void;

  hideDeadCode: boolean;
  setHideDeadCode: (value: boolean) => void;

  showLegend: boolean;
  setShowLegend: (value: boolean) => void;

  resetGraphState: () => void;
}

export default function GraphToolbar({
  heatmapMode,
  setHeatmapMode,
  filterType,
  setFilterType,
  hideDeadCode,
  setHideDeadCode,
  showLegend,
  setShowLegend,
  resetGraphState,
}: GraphToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-3 sm:px-4">
      <Select
        value={heatmapMode}
        onValueChange={(value) =>
          setHeatmapMode(value as "none" | "complexity" | "importance")
        }
      >
        <SelectTrigger className="w-full sm:w-[180px] lg:w-[200px]">
          <div className="flex min-w-0 items-center gap-2">
            <Flame className="h-4 w-4 shrink-0" />

            <span className="truncate text-muted-foreground">Heatmap:</span>

            <SelectValue />
          </div>
        </SelectTrigger>

        <SelectContent className="z-50 border bg-white text-popover-foreground shadow-lg">
          <SelectItem value="none">Off</SelectItem>

          <SelectItem value="complexity">Complexity</SelectItem>

          <SelectItem value="importance">Importance</SelectItem>
        </SelectContent>
      </Select>

      <Select
        value={filterType ?? "all"}
        onValueChange={(value) => setFilterType(value === "all" ? null : value)}
      >
        <SelectTrigger className="w-full sm:w-[180px] lg:w-[200px]">
          <SelectValue placeholder="Filter" />
        </SelectTrigger>

        <SelectContent className="z-50 border bg-white text-popover-foreground shadow-lg">
          <SelectItem value="all">All Nodes</SelectItem>

          <SelectItem value="function">Functions</SelectItem>

          <SelectItem value="if">Branches</SelectItem>

          <SelectItem value="loop">Loops</SelectItem>

          <SelectItem value="statement">Statements</SelectItem>
        </SelectContent>
      </Select>

      {/*
        Dead-code filtering is intentionally kept disabled for now.
      */}

      <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLegend(!showLegend)}
              >
                <BookOpen size={16} className="mr-2 h-4 w-4" />
                Legend
              </Button>
            </TooltipTrigger>

            <TooltipContent>Toggle graph legend</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Button size="sm" onClick={resetGraphState}>
          <RotateCcw className="mr-1 h-4 w-4" />
          Reset
        </Button>
      </div>
    </div>
  );
}

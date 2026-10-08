"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Download,
  ExternalLink,
  Code2,
  MoreVertical,
  Clipboard,
  FileText,
  BookText,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ObjectId } from "bson";
import { getAuth } from "firebase/auth";
import {
  FlowGraph,
  ProjectDependencyAnalysis,
} from "@/app/api/lib/analyzer/types";
import FlowVisualizer from "./FlowVisualizer";
import FileInsightsSidebar from "./FileInsightsSidebar";
import CodeEditorPanel from "./CodeEditorPanel";

interface FileViewerPanelProps {
  id: any;
  projectId: number | ObjectId;
  project: JSON | any;

  fileTree: any;
  graphData: FlowGraph;
  setGraphData: any;
  dependencyAnalysis?: ProjectDependencyAnalysis;

  handleFileClick: (path: string) => void;

  selectedPath: string | null;
  setSelectedPath: (filePath: string | null) => string | void;

  fileContent: string;
  selectedFileNode: any;

  lineNumber: number | null;

  readmeContent: string | null;
  readmeSummary: string | null;

  getLanguageMeta: (filePath: string) => {
    name: string;
    color: string;
  };
}

export default function FileViewerPanel({
  id,
  projectId,
  project,
  graphData,
  handleFileClick,
  fileTree,
  setGraphData,
  selectedPath,
  setSelectedPath,
  fileContent,
  selectedFileNode,
  dependencyAnalysis,
  lineNumber,
  readmeContent,
  readmeSummary,
  getLanguageMeta,
}: FileViewerPanelProps) {
  const { targetLineNumber, setTargetLineNumber } = useAuth();
  const [viewMode, setViewMode] = useState<"code" | "graph">("code");
  const [searchTerm, setSearchTerm] = useState<any>("");
  const codeContainerRef = useRef<HTMLDivElement | null>(null);
  const [lastScrolledLine, setLastScrolledLine] = useState<number | null>(null);
  const [showRawData, setShowRawData] = useState(false);
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const [hoveredLinePos, setHoveredLinePos] = useState<number | null>(null);
  const [openCommentDialog, setOpenCommentDialog] = useState<{
    open: boolean;
    line: number | null;
  }>({
    open: false,
    line: null,
  });
  const [comments, setComments] = useState<Record<number, string[]> | null>();
  const [commentText, setCommentText] = useState("");
  const [innerScrollLeft, setInnerScrollLeft] = useState(0);
  const innerPreRef = useRef<HTMLElement | null>(null);
  const [foldedRanges, setFoldedRanges] = useState<Set<string>>(new Set());
  const [foldPositions, setFoldPositions] = useState<
    Record<string, { toggleTop: number; placeholderTop: number }>
  >({});
  const [showDocs, setShowDocs] = useState(false);

  const lineCount = useMemo(
    () => fileContent.split("\n").length ?? 0,
    [fileContent],
  );

  useEffect(() => {
    console.log(selectedFileNode);
  }, [selectedFileNode]);

  const isLargeFile = lineCount > 1000;

  useEffect(() => {
    const pre = codeContainerRef.current?.querySelector("pre");
    if (pre) {
      innerPreRef.current = pre as HTMLElement;

      const handleScroll = () => {
        setInnerScrollLeft(pre.scrollLeft);
        setHoveredLine(null);
        setHoveredLinePos(null);
      };

      pre.addEventListener("scroll", handleScroll, { passive: true });
      handleScroll();

      return () => {
        pre.removeEventListener("scroll", handleScroll);
      };
    }
  }, [fileContent]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      const container = codeContainerRef.current;

      if (!container) return;

      const target = e.target as Node;

      if (!container.contains(target)) {
        setHoveredLine(null);
        setHoveredLinePos(null);
      }
    };

    document.addEventListener("mousemove", handleGlobalMouseMove);

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove);
    };
  }, []);

  const foldBlocks = useMemo(() => {
    if (!selectedFileNode) return [];
    const candidates: any[] = [];

    [
      "functions",
      "classes",
      "components",
      "exports",
      "blocks",
      "apis",
      "schemas",
    ].forEach((k) => {
      const arr = selectedFileNode[k] || [];
      arr.forEach((it: any) => {
        const start = it.start ?? it.loc ?? null;
        const end = it.end ?? null;
        if (
          typeof start === "number" &&
          typeof end === "number" &&
          end > start
        ) {
          candidates.push({
            name: it.name,
            start,
            end,
            kind: k,
          });
        }
      });
    });

    const map = new Map<string, any>();
    candidates
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .forEach((c) => {
        if (c.end <= c.start) return;

        const existing = Array.from(map.values()).find(
          (b) =>
            (b.start == c.start && b.end === c.end) ||
            (b.end === c.end && b.start < c.start),
        );

        if (!existing) {
          map.set(`${c.start}-${c.end}`, c);
        }
      });

    return Array.from(map.values()).sort((a, b) => a.start - b.start);
  }, [selectedFileNode]);

  useLayoutEffect(() => {
    const container = codeContainerRef.current;
    if (!container) return;
    if (isLargeFile) return;

    const next: Record<string, { toggleTop: number; placeholderTop: number }> =
      {};

    foldBlocks.forEach((block) => {
      const el = container.querySelector(
        `[data-line-number="${block.start}"]`,
      ) as HTMLElement | null;
      if (!el) return;
      const toggleTop =
        el.offsetTop + Math.max(2, Math.round(el.offsetHeight / 6));
      const placeholderTop = el.offsetTop + el.offsetHeight;
      next[`${block.start}-${block.end}`] = { toggleTop, placeholderTop };
    });

    setFoldPositions(next);
  }, [
    foldBlocks,
    comments,
    fileContent,
    showRawData,
    foldedRanges,
    selectedPath,
  ]);

  useEffect(() => {
    const getComment = async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();

        const res = await fetch(
          `/api/comments?projectId=${projectId}&filePath=${selectedPath}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        const data = await res.json();
        const grouped: { [line: number]: string[] } = {};
        data.forEach((c: any) => {
          if (!grouped[c.lineNumber]) grouped[c.lineNumber] = [];
          grouped[c.lineNumber].push(c.text);
        });

        setComments(grouped);
      } catch (error) {
        console.log("Error fetching comments : ", error);
      }
    };

    getComment();
  }, [selectedPath]);

  useEffect(() => {
    setSearchTerm("");
    setLastScrolledLine(null);
  }, [selectedPath]);

  const addComment = async () => {
    if (!openCommentDialog.line) return;
    await fetch("/api/comments", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        filePath: selectedPath,
        lineNumber: openCommentDialog.line,
        text: commentText,
      }),
    });

    setComments((prev) => {
      const copy = { ...(prev ?? {}) };
      const ln = openCommentDialog.line!;
      copy[ln] = copy[ln] ? [...copy[ln], commentText] : [commentText];
      return copy;
    });

    setCommentText("");
    setOpenCommentDialog({ open: false, line: null });
  };

  const downloadFile = () => {
    const blob = new Blob([fileContent], { type: "text/plain; charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedPath?.split("/").pop() || "file.txt";
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const debounce = (fn: Function, delay: number) => {
    let timer: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  const debouncedScroll = debounce((line: number) => {
    jumpToLine(line);
  }, 200);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);

    if (!term.trim()) {
      setTargetLineNumber(null);
      setLastScrolledLine(null);
      return;
    }

    const lines = fileContent.split("\n");
    const matchIndex = lines.findIndex((line) =>
      line.toLowerCase().includes(term.toLowerCase()),
    );

    if (matchIndex !== -1) {
      const newLine = matchIndex + 1;
      setTargetLineNumber(newLine);

      if (newLine !== lastScrolledLine) {
        setLastScrolledLine(newLine);
        debouncedScroll(newLine);
      }
    } else {
      setTargetLineNumber(null);
      setLastScrolledLine(null);
    }
  };

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const jumpToLine = (lineNumber: number) => {
    setTargetLineNumber(lineNumber);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const lineElement = codeContainerRef.current?.querySelector(
      `[data-line-number="${lineNumber}"]`,
    );

    if (lineElement) {
      (lineElement as HTMLElement).scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }

    timeoutRef.current = setTimeout(() => {
      setTargetLineNumber(null);
    }, 1500);
  };

  const handleMouseEnterLine = (lineNumber: number, top: number) => {
    setHoveredLine((prev) => (prev === lineNumber ? prev : lineNumber));
    setHoveredLinePos(top);
  };

  useEffect(() => {
    if (lineNumber) {
      jumpToLine(lineNumber);
    }
  }, [fileContent, lineNumber]);

  const toggleFold = (key: string) => {
    setFoldedRanges((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isLineHidden = (ln: number) => {
    for (const key of foldedRanges) {
      const [sStr, eStr] = key.split("-");
      const s = Number(sStr);
      const e = Number(eStr);
      if (ln > s && ln < e) return true;
    }
    return false;
  };

  const downloadRawFile = async () => {
    const token = await getAuth().currentUser?.getIdToken();

    const res = await fetch(
      `/api/project/file/raw?projectId=${project.projectId}&filePath=${encodeURIComponent(selectedPath!)}&token=${encodeURIComponent(token!)}`,
    );

    const blob = await res.blob();

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = selectedPath!.split("/").pop() ?? "file";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="bg-card border rounded-2xl h-full w-full min-h-0 p-4 shadow-sm space-y-4">
        <div className="flex gap-2 bg-muted p-1 rounded-lg w-fit">
          <button
            type="button"
            onClick={() => setViewMode("code")}
            className={`px-3 py-1 text-sm rounded-md transition ${
              viewMode === "code"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground"
            }`}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => setViewMode("graph")}
            className={`px-3 py-1 text-sm rounded-md transition ${
              viewMode === "graph"
                ? "bg-background shadow-sm font-medium"
                : "text-muted-foreground"
            }`}
          >
            Graph
          </button>
        </div>

        <div className="h-[650px] min-h-0 sm:h-[700px] lg:h-[750px]">
          {viewMode === "code" ? (
            selectedPath ? (
              <div className="grid h-full min-h-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="flex flex-col min-w-0 min-h-0 h-full">
                  <div className="sticky top-0 z-10 flex min-w-0 items-center gap-2 border-b bg-card pb-3 mb-3 sm:gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      <FileText className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-mono text-sm font-medium truncate block w-full">
                        {selectedPath}
                      </span>
                    </div>

                    <div className="shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                            aria-label="File actions"
                          >
                            <MoreVertical size={16} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="w-44 bg-white"
                        >
                          <DropdownMenuItem
                            onClick={downloadFile}
                            className="gap-2 cursor-pointer"
                          >
                            <Download size={14} />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={downloadRawFile}
                            className="gap-2 cursor-pointer"
                          >
                            <Download size={14} />
                            Download Raw
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              if (selectedPath) {
                                navigator.clipboard.writeText(selectedPath);
                                toast.success("Path copied", {
                                  description: selectedPath,
                                });
                              }
                            }}
                            className="gap-2 cursor-pointer"
                          >
                            <Clipboard size={14} />
                            Copy Path
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={async () => {
                              const token =
                                await getAuth().currentUser?.getIdToken();

                              window.open(
                                `/api/project/file/raw?projectId=${project.projectId}&filePath=${encodeURIComponent(selectedPath)}&token=${encodeURIComponent(token!)}`,
                                "_blank",
                                "noopener,noreferrer",
                              );
                            }}
                          >
                            <ExternalLink className="h-4 w-4" />
                            Open in New Tab
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setShowRawData((prev) => !prev)}
                            className="gap-2 cursor-pointer"
                          >
                            <Code2 size={14} />
                            {showRawData
                              ? "View Syntax Highlighted"
                              : "View Raw"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap w-full items-center gap-3">
                    <input
                      type="text"
                      placeholder="Search in file..."
                      value={searchTerm}
                      onChange={(e) => handleSearchChange(e)}
                      className="h-10 w-full text-sm px-3 py-2 rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  <CodeEditorPanel
                    fileContent={fileContent}
                    selectedPath={selectedPath}
                    showRawData={showRawData}
                    isLargeFile={isLargeFile}
                    lineCount={lineCount}
                    codeContainerRef={codeContainerRef}
                    getLanguageMeta={getLanguageMeta}
                    targetLineNumber={targetLineNumber}
                    comments={comments}
                    hoveredLine={hoveredLine}
                    hoveredLinePos={hoveredLinePos}
                    setHoveredLine={setHoveredLine}
                    setHoveredLinePos={setHoveredLinePos}
                    openCommentDialog={openCommentDialog}
                    commentText={commentText}
                    setCommentText={setCommentText}
                    setOpenCommentDialog={setOpenCommentDialog}
                    addComment={addComment}
                    foldedRanges={foldedRanges}
                    foldBlocks={foldBlocks}
                    foldPositions={foldPositions}
                    toggleFold={toggleFold}
                    isLineHidden={isLineHidden}
                    handleMouseEnterLine={handleMouseEnterLine}
                    innerScrollLeft={innerScrollLeft}
                  />
                </div>

                <div className="min-h-0 h-full overflow-y-auto lg:min-w-0">
                  <FileInsightsSidebar
                    selectedFileNode={selectedFileNode}
                    dependencyAnalysis={dependencyAnalysis}
                    fileTree={fileTree}
                    onFileChange={handleFileClick}
                    setShowDocs={setShowDocs}
                    showDocs={showDocs}
                    jumpToLine={jumpToLine}
                  />
                </div>
              </div>
            ) : readmeContent ? (
              <>
                {readmeSummary && (
                  <div className="bg-muted border border-border rounded-lg p-4 mb-6">
                    <h2 className="text-base font-semibold mb-2 flex items-center gap-1">
                      <BookText className="w-4 h-4 text-primary" />
                      README Summary
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {readmeSummary}
                    </p>
                  </div>
                )}

                <h2 className="text-base font-bold mb-2">README.md</h2>
                <div className="prose prose-sm max-w-none text-foreground prose-headings:mb-2 prose-p:mb-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {readmeContent}
                  </ReactMarkdown>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm text-center py-20">
                Select a file to preview its content.
              </p>
            )
          ) : (
            <>
              <div className="flex-1 overflow-hidden">
                <FlowVisualizer
                  selectedPath={selectedPath}
                  id={id}
                  graphData={graphData}
                  setGraphData={setGraphData}
                  selectedFileNode={selectedFileNode}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

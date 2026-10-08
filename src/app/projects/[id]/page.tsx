"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAuth } from "firebase/auth";
import { toast } from "sonner";
import ProjectHeader from "../components/ProjectHeader";
import ProjectFilesPanel from "../components/ProjectFilesPanel";
import ProjectOverview from "../components/ProjectOverview";
import FileViewerPanel from "../components/FileViewerPanel";
import { generateSummary } from "../utils/markdown";
import {
  filterFileTree,
  findReadmePath,
  findSelectedFileNode,
} from "../utils/fileTree";
import { useProjectPolling } from "@/hooks/useProjectPolling";
import { useProjectData } from "@/hooks/useProjectData";
import { useFileHandler } from "@/hooks/useFileHandler";
import { getLanguage } from "../utils/language";
import ProjectWorkspaceTabs from "../components/ProjectWorkspaceTabs";
import {
  FlowGraph,
  ProjectDependencyAnalysis,
} from "@/app/api/lib/analyzer/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export default function ProjectDetailPage() {
  const router = useRouter();
  const { id: projectId } = useParams() as { id: string };

  const { project, setProject, isLoaded } = useProjectData(projectId);
  const { selectedPath, setSelectedPath, fileContent, handleFileClick } =
    useFileHandler(project?.projectId);
  const [readmeContent, setReadmeContent] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[] | []>([]);
  const [insights, setInsights] = useState<any>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [graphData, setGraphData] = useState<FlowGraph>({
    nodes: [],
    edges: [],
  });
  const [readmeSummary, setReadmeSummary] = useState("");
  const [line, setLine] = useState<number | null>(null);
  const { jobStatus, jobProgress, jobMessage, graphReady } = useProjectPolling(
    project?.projectId,
  );
  const [activeView, setActiveView] = useState<"overview" | "explorer">(
    "overview",
  );

  useEffect(() => {
    if (!graphReady || !projectId) return;

    const refreshProject = async () => {
      try {
        const token = await getAuth().currentUser?.getIdToken();

        const res = await fetch(`/api/project?id=${projectId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) return;

        const updatedProject = await res.json();

        setProject(updatedProject);
      } catch (err) {
        console.error("Failed to refresh project:", err);
      }
    };

    refreshProject();
  }, [graphReady, projectId, setProject]);

  useEffect(() => {
    if (project?.projectName) {
      setNewName(project.projectName);
    }

    console.log(project);
  }, [project]);

  useEffect(() => {
    if (!graphReady || !isLoaded || !project) {
      return;
    }

    const getReadMeData = async () => {
      let readmePath;
      if (isLoaded) {
        readmePath = findReadmePath(project.fileTree);
        setTags(project.tags);
        setInsights(project.insights);
      }

      if (readmePath) {
        const contentRes = await fetch(
          `/api/project/file?projectId=${
            project?.projectId
          }&filePath=${encodeURIComponent(readmePath)}`,
        );
        const contentData = await contentRes.json();

        const content = contentData.content;
        setReadmeContent(content);
        setReadmeSummary(generateSummary(content));
      }
    };
    getReadMeData();
  }, [graphReady, isLoaded, project]);

  const dependencyAnalysis = project?.dependencyAnalysis as
    | ProjectDependencyAnalysis
    | undefined;

  const handleDelete = async () => {
    const token = await getAuth().currentUser?.getIdToken();
    const res = await fetch(`/api/project?id=${projectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      toast.success("Project deleted successfully");
      router.push("/projects");
    } else {
      toast.error("Failed to delete project");
    }
  };

  const handleRename = async () => {
    setEditingName(false);
    if (!newName || newName === project.projectName) return;

    const token = await getAuth().currentUser?.getIdToken();
    const res = await fetch("/api/project", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ id: project._id, newName }),
    });

    if (res.ok) {
      setProject({ ...project, projectName: newName });
      toast.success("Project renamed!");
    }
  };

  const selectedFileNode = useMemo(() => {
    if (isLoaded && selectedPath)
      return findSelectedFileNode(project.fileTree, selectedPath);
  }, [isLoaded, selectedPath, project]);

  if (!project) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-48 bg-muted animate-pulse rounded" />
        <div className="h-5 w-32 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (jobStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] text-red-600">
        <p className="text-lg font-semibold">
          Analysis Failed Something went wrong while analysing your repository.
          Please try uploading repository again.
        </p>
        <p className="text-sm">{jobMessage}</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-36 hover:bg-red-600 hover:text-white"
            >
              <Trash2 size={14} className="mr-2" />
              Delete Project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Project</AlertDialogTitle>
              <AlertDialogDescription>Analysis failed.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={handleDelete}
              >
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (!project.analysisComplete) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] space-y-6">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Analyzing your repository</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {jobMessage || "This may take a few seconds..."}
          </p>
        </div>

        <div className="w-96 bg-gray-300 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-2 transition-all duration-500 ease-out"
            style={{ width: `${jobProgress}%` }}
          />
        </div>

        <div className="text-sm text-muted-foreground">
          {jobProgress}% complete
        </div>

        <div className="flex space-x-1">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-150" />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce delay-300" />
        </div>
      </div>
    );
  }

  const filteredTree = project?.fileTree
    ? filterFileTree(project.fileTree, searchTerm)
    : [];

  return (
    <div className="min-h-screen space-y-6 px-4 py-5 sm:p-6">
      <ProjectHeader
        projectName={project.projectName}
        projectId={projectId}
        editingName={editingName}
        newName={newName}
        setNewName={setNewName}
        setEditingName={setEditingName}
        handleRename={handleRename}
        tags={tags}
        tagInput={tagInput}
        setTagInput={setTagInput}
        setTags={setTags}
        handleDelete={handleDelete}
      />

      <ProjectWorkspaceTabs
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {activeView === "overview" && (
        <div className="space-y-6">
          <div className="col-span-12 lg:col-span-4">
            <ProjectOverview
              summary={readmeSummary}
              insights={insights}
              packageInfo={project?.packageInfo}
              getLanguageMeta={getLanguage}
            />
          </div>
        </div>
      )}

      {activeView === "explorer" && (
        <div className="grid grid-cols-12 gap-6 items-stretch min-h-[900px]">
          <div className="col-span-12 xl:col-span-5 flex min-w-0">
            <ProjectFilesPanel
              project={project}
              setLine={setLine}
              handleFileClick={handleFileClick}
              fileTree={filteredTree}
              setSelectedPath={setSelectedPath}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              entryPoints={project?.entryPoints || []}
              selectedPath={selectedPath}
            />
          </div>

          <div className="col-span-12 xl:col-span-7 flex min-w-0">
            <FileViewerPanel
              id={project.projectId}
              projectId={project._id}
              project={project}
              handleFileClick={handleFileClick}
              fileTree={filteredTree}
              graphData={graphData}
              setGraphData={setGraphData}
              selectedPath={selectedPath}
              setSelectedPath={setSelectedPath}
              fileContent={fileContent}
              lineNumber={line}
              selectedFileNode={selectedFileNode}
              dependencyAnalysis={dependencyAnalysis}
              readmeContent={readmeContent}
              readmeSummary={readmeSummary}
              getLanguageMeta={getLanguage}
            />
          </div>
        </div>
      )}
    </div>
  );
}

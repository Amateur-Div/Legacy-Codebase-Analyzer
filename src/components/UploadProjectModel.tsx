"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { UploadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

type Props = {
  open: boolean;
  onClose: () => void;
};

type InitiateUploadResponse = {
  uploadIntentId: string;
  projectId: string;
  uploadUrl: string;
  expiresAt: string;
};

type CompleteUploadResponse = {
  message?: string;
  projectId?: string;
  jobId?: string;
  error?: string;
};

const MAX_ZIP_SIZE = 100 * 1024 * 1024;
const ZIP_CONTENT_TYPE = "application/zip";

async function getResponseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export default function UploadProjectModal({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { setJobId } = useAuth();

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open && !uploading) {
      setFile(null);
      setDragOver(false);

      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }, [open, uploading]);

  const validateAndSetFile = (uploaded?: File) => {
    if (!uploaded) return;

    if (!uploaded.name.toLowerCase().endsWith(".zip")) {
      toast.error("Only ZIP files are supported.");
      return;
    }

    if (uploaded.size <= 0) {
      toast.error("The selected ZIP file is empty.");
      return;
    }

    if (uploaded.size > MAX_ZIP_SIZE) {
      toast.error("Repository ZIP cannot exceed 100 MB.");
      return;
    }

    setFile(uploaded);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateAndSetFile(e.target.files?.[0]);
  };

  const handleUpload = async () => {
    if (!file || uploading) return;

    setUploading(true);

    try {
      const user = auth.currentUser;

      if (!user) {
        throw new Error("Please log in again.");
      }

      const token = await user.getIdToken();

      const initiateResponse = await fetch("/api/upload/initiate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      if (!initiateResponse.ok) {
        throw new Error(await getResponseError(initiateResponse));
      }

      const uploadData =
        (await initiateResponse.json()) as InitiateUploadResponse;

      if (
        !uploadData.uploadIntentId ||
        !uploadData.uploadUrl ||
        !uploadData.projectId
      ) {
        throw new Error("Invalid upload initialization response.");
      }

      const blobResponse = await fetch(uploadData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": ZIP_CONTENT_TYPE,
        },
        body: file,
      });

      if (!blobResponse.ok) {
        throw new Error(
          `Cloud upload failed (${blobResponse.status}). Please try again.`,
        );
      }

      const completeResponse = await fetch("/api/upload/complete", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploadIntentId: uploadData.uploadIntentId,
        }),
      });

      if (!completeResponse.ok) {
        throw new Error(await getResponseError(completeResponse));
      }

      const completeData =
        (await completeResponse.json()) as CompleteUploadResponse;

      if (!completeData.jobId) {
        throw new Error(
          "Upload completed, but the analysis job ID was not returned.",
        );
      }

      setJobId(completeData.jobId);

      toast.success(
        "Repository uploaded successfully. Analysis will begin shortly.",
      );

      setFile(null);

      if (inputRef.current) {
        inputRef.current.value = "";
      }

      onClose();
    } catch (error) {
      console.error("REPOSITORY_UPLOAD_ERROR:", error);

      toast.error(
        error instanceof Error
          ? error.message
          : "Upload failed. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !uploading) {
          onClose();
        }
      }}
    >
      <DialogContent className="w-[95vw] max-w-md p-6">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Upload Repository
          </DialogTitle>
        </DialogHeader>

        <div
          onClick={() => {
            if (!uploading) inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);

            if (!uploading) {
              validateAndSetFile(e.dataTransfer.files?.[0]);
            }
          }}
          className={clsx(
            "group rounded-2xl border border-dashed min-h-[220px] px-6 py-8 text-center transition-all duration-200",
            !uploading && "cursor-pointer",
            dragOver && "border-primary bg-primary/5 scale-[1.01]",
            file && "border-green-500 bg-green-500/5",
            !dragOver && !file && "hover:bg-muted/40 hover:border-primary/40",
            uploading && "opacity-60 cursor-not-allowed",
          )}
        >
          <UploadCloud
            className={clsx(
              "mx-auto mb-3 transition-transform duration-200",
              dragOver
                ? "scale-110 text-primary"
                : "text-muted-foreground group-hover:text-primary",
            )}
            size={42}
          />

          <div className="space-y-1">
            <p className="text-sm font-medium break-all line-clamp-2">
              {file ? file.name : "Click or drag a ZIP file here to upload"}
            </p>

            <p className="text-xs text-muted-foreground">
              Upload a ZIP archive containing your project repository.
            </p>

            <p className="text-xs">Maximum supported size: 100 MB</p>

            {file && (
              <p className="text-xs text-muted-foreground">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            )}
          </div>
        </div>

        <input
          type="file"
          accept=".zip,application/zip"
          hidden
          ref={inputRef}
          disabled={uploading}
          onChange={handleFileChange}
        />

        <Button
          disabled={!file || uploading}
          onClick={handleUpload}
          className="mt-2 w-full h-11"
        >
          {uploading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Uploading repository...
            </>
          ) : (
            "Upload"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

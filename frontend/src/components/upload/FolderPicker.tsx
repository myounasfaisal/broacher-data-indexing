import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type PickMode = "folder" | "files";

/**
 * Unified picker that lets the admin choose:
 *  - a whole folder  (webkitdirectory)
 *  - one or more individual PDF files
 *
 * The returned FileList is always filtered to PDFs only.
 */
export function FolderPicker({
  onFiles,
  disabled,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const folderRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef<HTMLInputElement | null>(null);
  const [activeMode, setActiveMode] = useState<PickMode | null>(null);

  function filterPdfs(fileList: FileList | null): File[] {
    return Array.from(fileList ?? []).filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
  }

  function handleFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const pdfs = filterPdfs(e.target.files);
    if (pdfs.length === 0) {
      // toast is shown by parent via onFiles([])
    }
    onFiles(pdfs);
    if (folderRef.current) folderRef.current.value = "";
  }

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const pdfs = filterPdfs(e.target.files);
    onFiles(pdfs);
    if (filesRef.current) filesRef.current.value = "";
  }

  function pickFolder() {
    setActiveMode("folder");
    folderRef.current?.click();
  }

  function pickFiles() {
    setActiveMode("files");
    filesRef.current?.click();
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Hidden folder input */}
      <input
        ref={(el) => {
          folderRef.current = el;
          if (el) {
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
          }
        }}
        type="file"
        multiple
        className="hidden"
        onChange={handleFolderChange}
      />

      {/* Hidden multi-file PDF input */}
      <input
        ref={filesRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden"
        onChange={handleFilesChange}
      />

      <Button
        type="button"
        variant={activeMode === "folder" ? "default" : "outline"}
        onClick={pickFolder}
        disabled={disabled}
      >
        📁 Select folder
      </Button>

      <Button
        type="button"
        variant={activeMode === "files" ? "default" : "outline"}
        onClick={pickFiles}
        disabled={disabled}
      >
        📄 Select PDF(s)
      </Button>
    </div>
  );
}

import { useRef, useState } from "react";
import { UploadCloud, Folder, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Unified drop-or-browse target for choosing brochures. The admin can:
 *  - drop a whole folder, several PDFs, or a single PDF onto the zone, or
 *  - click to browse for individual PDFs, or a whole folder.
 *
 * Everything is filtered to PDFs only before it reaches `onFiles`. Note the
 * browser constraint: one native <input> can't offer both folder-picking
 * (webkitdirectory) and file-picking, so the two click paths stay separate —
 * but drag-and-drop is the single target that swallows either kind.
 *
 * This only *collects* files; it does not upload. The parent stages them for
 * review so a stray folder can be caught before anything is sent.
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
  const [dragging, setDragging] = useState(false);

  function filterPdfs(files: File[]): File[] {
    return files.filter(
      (f) =>
        f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
  }

  function emit(files: File[]) {
    onFiles(filterPdfs(files));
  }

  function handleFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    emit(Array.from(e.target.files ?? []));
    if (folderRef.current) folderRef.current.value = "";
  }

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    emit(Array.from(e.target.files ?? []));
    if (filesRef.current) filesRef.current.value = "";
  }

  // --- Drag and drop: walk dropped folders recursively into a flat list. ---
  async function readEntry(
    entry: FileSystemEntry,
    out: File[],
  ): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries yields in batches; keep reading until it returns empty.
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        for (const child of batch) await readEntry(child, out);
      } while (batch.length > 0);
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;

    const items = Array.from(e.dataTransfer.items);
    const entries = items
      .map((it) => it.webkitGetAsEntry?.())
      .filter((x): x is FileSystemEntry => Boolean(x));

    if (entries.length > 0) {
      const collected: File[] = [];
      for (const entry of entries) await readEntry(entry, collected);
      emit(collected);
      return;
    }
    // Fallback for browsers without the entries API: flat file list only.
    emit(Array.from(e.dataTransfer.files ?? []));
  }

  return (
    <div>
      {/* Hidden folder input (webkitdirectory) */}
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

      {/*
        The zone is a drop target and, for mouse users, a click-to-browse
        convenience — but it is NOT a focusable control itself. Keyboard and
        assistive-tech users operate the two real buttons below (nesting a
        focusable role="button" around focusable buttons is the a11y trap).
      */}
      <div
        onClick={() => !disabled && filesRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={[
          "flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors",
          disabled
            ? "cursor-not-allowed border-line bg-muted/40 opacity-60"
            : dragging
              ? "cursor-copy border-brand bg-brand-soft"
              : "cursor-pointer border-line hover:border-brand/60 hover:bg-hover",
        ].join(" ")}
      >
        <span
          className={[
            "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
            dragging ? "bg-brand text-on-brand" : "bg-brand-soft text-brand-soft-text",
          ].join(" ")}
        >
          <UploadCloud className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-medium text-fg">
            {dragging ? "Drop to add these files" : "Drag a folder or PDFs here"}
          </p>
          <p className="mt-0.5 text-xs text-fg-muted">
            or browse below — nothing uploads until you review the list
          </p>
        </div>
        {/* Real, focusable controls. stopPropagation so they don't also fire the
            zone's own click (which would open a second file dialog). */}
        <div className="mt-1 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              filesRef.current?.click();
            }}
          >
            <FileText className="h-4 w-4" aria-hidden /> Choose PDFs
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              folderRef.current?.click();
            }}
          >
            <Folder className="h-4 w-4" aria-hidden /> Choose folder
          </Button>
        </div>
      </div>
    </div>
  );
}

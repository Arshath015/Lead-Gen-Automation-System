import { useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { Button } from "../../components/ui/Button";

interface Props {
  uploading: boolean;
  uploadError: string | null;
  onUpload: (files: File[]) => void;
}

const ACCEPT = ".xlsx,.csv";

export function UploadStep({ uploading, uploadError, onUpload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    onUpload(Array.from(fileList));
  }

  return (
    <div className="px-6 pb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-2xl border border-dashed py-16 text-center transition-colors ${
          dragOver ? "border-accent-400 bg-accent-50/40" : "border-border"
        }`}
      >
        <div className="flex size-12 items-center justify-center rounded-xl bg-accent-50 text-accent-600">
          <UploadCloud className="size-6" />
        </div>
        <p className="mt-3 text-[14px] font-medium text-ink">Drag and drop a workbook, or browse</p>
        <p className="mt-1 max-w-sm text-[13px] text-gray-500">
          .xlsx or .csv, up to 150MB. Nothing is imported until you review a preview and confirm.
        </p>
        <Button variant="primary" className="mt-4" onClick={() => inputRef.current?.click()} loading={uploading}>
          <FileSpreadsheet className="size-3.5" />
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {uploadError && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{uploadError}</span>
        </div>
      )}
    </div>
  );
}

import { useRef, useCallback, useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Upload, AlertCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useCsvImport } from "@/hooks/use-csv-import"
import { cn } from "@/lib/utils"

interface CsvImportModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CsvImportModal({ open, onOpenChange }: CsvImportModalProps) {
  const navigate = useNavigate()
  const {
    step,
    fileError,
    headerMapping,
    parsedRows,
    validations,
    processFile,
    reset,
  } = useCsvImport()

  const fileInputRef = useRef<HTMLInputElement>(null!)
  const [isDragging, setIsDragging] = useState(false)

  // Reset state when modal closes
  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  // Navigate to the preview page when parsing is done
  useEffect(() => {
    if (step === "preview") {
      onOpenChange(false)
      navigate("/employees/import", {
        state: {
          rows: parsedRows,
          validationEntries: [...validations.entries()],
          mappedColumnCount: headerMapping?.columnToField.size ?? 0,
        },
      })
    }
  }, [step, navigate, onOpenChange, parsedRows, validations, headerMapping])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile]
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) processFile(file)
      // Reset input so re-selecting the same file works
      e.target.value = ""
    },
    [processFile]
  )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[480px] gap-0 p-0 overflow-hidden">
          {/* Upload Step */}
          {step === "upload" && (
            <div className="p-6 flex flex-col gap-5">
              <DialogHeader>
                <DialogTitle>Import employees</DialogTitle>
                <DialogDescription>
                  Upload a CSV file to bulk-add employees to your workspace. You'll be able to preview the data before finalizing the import
                </DialogDescription>
              </DialogHeader>

              {/* Drop zone */}
              <div
                className={cn(
                  "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors cursor-pointer",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : fileError
                      ? "border-destructive/50 bg-destructive/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div
                  className={cn(
                    "flex items-center justify-center size-10 rounded-lg",
                    fileError
                      ? "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {fileError ? (
                    <AlertCircle className="size-5" />
                  ) : (
                    <Upload className="size-5" />
                  )}
                </div>
                <div className="flex flex-col items-center gap-1 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {fileError
                      ? "Upload failed"
                      : "Drag & drop your CSV file here"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {fileError || (
                      <>
                        or{" "}
                        <span className="text-primary font-medium underline underline-offset-2">
                          browse files
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>

            </div>
          )}

        </DialogContent>
      </Dialog>
    </>
  )
}

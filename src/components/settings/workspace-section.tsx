import { useRef, useCallback } from "react"
import { CloudUpload } from "lucide-react"

import { validateImageFile } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar } from "@/components/ui/avatar"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"

interface WorkspaceSectionProps {
  workspaceName: string
  onWorkspaceNameChange: (value: string) => void
  displayedLogo: string | null
  onLogoFileSelect: (file: File) => void
  onLogoRemove: () => void
  isOwner: boolean
  // Danger zone
  deleteDialogOpen: boolean
  onDeleteDialogOpenChange: (open: boolean) => void
  deleteConfirmation: string
  onDeleteConfirmationChange: (value: string) => void
  onDeleteWorkspace: () => void
  deleting: boolean
  workspaceDisplayName: string | undefined
}

export function WorkspaceSection({
  workspaceName,
  onWorkspaceNameChange,
  displayedLogo,
  onLogoFileSelect,
  onLogoRemove,
  isOwner,
  deleteDialogOpen,
  onDeleteDialogOpenChange,
  deleteConfirmation,
  onDeleteConfirmationChange,
  onDeleteWorkspace,
  deleting,
  workspaceDisplayName,
}: WorkspaceSectionProps) {
  const logoInputRef = useRef<HTMLInputElement>(null)
  const hasLogo = !!displayedLogo

  const handleLogoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateImageFile(file)
    if (validationError) {
      addToast({ title: "Invalid file", description: validationError })
      return
    }
    onLogoFileSelect(file)
    e.target.value = ""
  }, [onLogoFileSelect])

  return (
    <>
      <section className="flex flex-col gap-5">
        <h2 className="text-base font-semibold leading-6 text-foreground">General</h2>

        {/* Workspace name */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium leading-5 text-foreground">
            Workspace name
          </label>
          <Input
            value={workspaceName}
            onChange={(e) => onWorkspaceNameChange(e.target.value)}
            placeholder="Your workspace"
          />
        </div>

        {/* Workspace logo */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium leading-5 text-foreground">
            Workspace logo
          </label>
          <div className="flex items-center gap-4">
            <Avatar
              size="xl"
              shape="square"
              src={displayedLogo ?? undefined}
              fallback={workspaceName ? workspaceName.charAt(0).toUpperCase() : "W"}
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => logoInputRef.current?.click()}
                >
                  <CloudUpload className="size-4" />
                  {hasLogo ? "Replace logo" : "Upload logo"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasLogo}
                  onClick={onLogoRemove}
                >
                  Remove
                </Button>
              </div>
              <p className="text-xs leading-4 text-muted-foreground">
                PNG or JPG, up to 5 MB
              </p>
            </div>
          </div>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleLogoSelect}
          />
        </div>
      </section>

      {/* Danger Zone — owner only */}
      {isOwner && (
        <section className="flex flex-col gap-4">
          <h2 className="text-base font-semibold leading-6 text-error">
            Danger Zone
          </h2>
          <div className="flex items-center justify-between rounded-lg border border-error/30 p-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium leading-5 text-foreground">
                Delete this workspace
              </p>
              <p className="text-sm leading-5 text-muted-foreground">
                Permanently delete this workspace and all its data. This action cannot be undone.
              </p>
            </div>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                onDeleteDialogOpenChange(open)
                if (!open) onDeleteConfirmationChange("")
              }}
            >
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="shrink-0 ml-4">
                  Delete workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete workspace</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the workspace &ldquo;{workspaceDisplayName}&rdquo;,
                    all employees, time-off requests, categories, and settings.
                    All team members will be signed out and removed.
                    This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium leading-5 text-foreground">
                    Type <span className="font-semibold">{workspaceDisplayName}</span> to confirm
                  </label>
                  <Input
                    value={deleteConfirmation}
                    onChange={(e) => onDeleteConfirmationChange(e.target.value)}
                    placeholder={workspaceDisplayName}
                    autoComplete="off"
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <Button
                    variant="destructive"
                    onClick={onDeleteWorkspace}
                    disabled={deleteConfirmation !== workspaceDisplayName}
                    loading={deleting}
                    loadingText="Deleting..."
                  >
                    Delete workspace
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </section>
      )}
    </>
  )
}

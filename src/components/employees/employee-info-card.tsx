import { useState } from "react"
import {
  ChevronDown,
  PencilLine,
  UserMinus,
  UserCheck,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar } from "@/components/ui/avatar"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover"
import { ComboboxMenu } from "@/components/ui/combobox-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"

interface EmployeeInfoCardProps {
  displayName: string
  email: string
  avatarUrl?: string | null
  initials?: string
  role?: string
  isActive: boolean
  canManage: boolean
  isSelfView: boolean
  onEdit: () => void
  onDeactivate: () => void
  onActivate: () => void
  onDelete: () => void
}

export function EmployeeInfoCard({
  displayName,
  email,
  avatarUrl,
  initials,
  role,
  isActive,
  canManage,
  isSelfView,
  onEdit,
  onDeactivate,
  onActivate,
  onDelete,
}: EmployeeInfoCardProps) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const deleteItem = {
    type: "icon" as const,
    variant: "destructive" as const,
    icon: <Trash2 className="size-4" />,
    label: "Delete employee",
    onClick: () => {
      setActionsOpen(false)
      setDeleteDialogOpen(true)
    },
  }

  const editItem = {
    type: "icon" as const,
    icon: <PencilLine className="size-4" />,
    label: "Edit details",
    onClick: () => {
      setActionsOpen(false)
      onEdit()
    },
  }

  const deactivateItem = {
    type: "icon" as const,
    icon: <UserMinus className="size-4" />,
    label: "Deactivate",
    onClick: () => {
      setActionsOpen(false)
      onDeactivate()
    },
  }

  const activateItem = {
    type: "icon" as const,
    icon: <UserCheck className="size-4" />,
    label: "Activate",
    onClick: () => {
      setActionsOpen(false)
      onActivate()
    },
  }

  // Build action groups based on context
  const actionGroups = isSelfView
    ? isActive
      ? [{ items: [deactivateItem] }, { items: [deleteItem] }]
      : [{ items: [activateItem] }, { items: [deleteItem] }]
    : isActive
      ? [{ items: [editItem, deactivateItem] }, { items: [deleteItem] }]
      : [{ items: [activateItem] }, { items: [deleteItem] }]

  return (
    <>
      <div className="flex items-center gap-4 w-[600px]">
        <Avatar
          src={avatarUrl ?? undefined}
          alt={displayName}
          fallback={initials}
          size="xl"
          shape="square"
        />
        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold leading-7 tracking-tight text-foreground">
              {displayName || "—"}
            </p>
            <Badge variant={role === "owner" ? "default" : "secondary"}>
              {role === "owner" ? "Owner" : role === "admin" ? "Admin" : "User"}
            </Badge>
          </div>
          <p className="text-sm leading-5 tracking-tight text-muted-foreground">
            {email}
          </p>
        </div>

        {canManage && !isSelfView && (
          <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="default">
                Actions
                <ChevronDown className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-0 border-0 shadow-none">
              <ComboboxMenu groups={actionGroups} />
            </PopoverContent>
          </Popover>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete employee</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {displayName || email}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDeleteDialogOpen(false)
                onDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

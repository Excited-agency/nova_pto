import { useState, useEffect, useMemo, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Settings, User } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/hooks/use-auth"
import { useNavigationGuard } from "@/contexts/navigation-guard-context"
import { getInitials } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { useDepartments } from "@/hooks/use-departments"
import {
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  deleteWorkspace,
  updateWorkspace,
  updateProfile,
  uploadImage,
  removeImage,
} from "@/lib/settings-service"
import { departmentKeys, employeeKeys } from "@/lib/query-keys"
import { addToast } from "@/lib/toast"
import type { Department } from "@/types/department"
import { WorkspaceSection } from "@/components/settings/workspace-section"
import { ProfileSection } from "@/components/settings/profile-section"
import { DepartmentsSection } from "@/components/settings/departments-section"

interface DepartmentRow {
  id: string
  name: string
  isNew: boolean
}

interface InitialValues {
  workspaceName: string
  firstName: string
  lastName: string
  logoUrl: string | null
  avatarUrl: string | null
  departments: DepartmentRow[]
  departmentId: string
  location: string
  hireDate: Date | undefined
}

export function SettingsPage() {
  const { workspace, profile, user, refreshWorkspace, refreshProfile, signOut } = useAuth()
  const { registerGuard, unregisterGuard } = useNavigationGuard()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { data: cachedDepartments } = useDepartments()

  const [workspaceName, setWorkspaceName] = useState("")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [logoRemoved, setLogoRemoved] = useState(false)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [departmentId, setDepartmentId] = useState<string>("")
  const [location, setLocation] = useState<string>("")
  const [hireDate, setHireDate] = useState<Date | undefined>(undefined)
  const [departments, setDepartments] = useState<DepartmentRow[]>([])
  const [deletedDepartmentIds, setDeletedDepartmentIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [initialValues, setInitialValues] = useState<InitialValues | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState("")
  const [deleting, setDeleting] = useState(false)

  const isOwner = workspace?.owner_id === user?.id

  const logoPreviewRef = useRef<string | null>(null)
  const avatarPreviewRef = useRef<string | null>(null)

  // Load initial data from auth context + cached departments
  useEffect(() => {
    if (!workspace || !profile || !cachedDepartments) return

    const wName = workspace.name || ""
    const fName = profile.first_name || ""
    const lName = profile.last_name || ""
    const lUrl = workspace.logo_url || null
    const aUrl = profile.avatar_url || null
    const deptId = profile.department_id ?? ""
    const loc = profile.location ?? ""
    const hDate = profile.hire_date ? new Date(profile.hire_date) : undefined

    setWorkspaceName(wName)
    setFirstName(fName)
    setLastName(lName)
    setLogoUrl(lUrl)
    setAvatarUrl(aUrl)
    setDepartmentId(deptId)
    setLocation(loc)
    setHireDate(hDate)

    const rows = cachedDepartments.map((d: Department) => ({ id: d.id, name: d.name, isNew: false }))
    setDepartments(rows)
    setInitialValues({
      workspaceName: wName,
      firstName: fName,
      lastName: lName,
      logoUrl: lUrl,
      avatarUrl: aUrl,
      departments: rows,
      departmentId: deptId,
      location: loc,
      hireDate: hDate,
    })
  }, [workspace?.id, profile?.id, cachedDepartments])

  // Dirty detection
  const isDirty = useMemo(() => {
    if (!initialValues) return false
    if (workspaceName !== initialValues.workspaceName) return true
    if (firstName !== initialValues.firstName) return true
    if (lastName !== initialValues.lastName) return true
    if (departmentId !== initialValues.departmentId) return true
    if (location !== initialValues.location) return true
    if ((hireDate?.getTime() ?? undefined) !== (initialValues.hireDate?.getTime() ?? undefined)) return true
    if (logoFile !== null || (logoRemoved && initialValues.logoUrl !== null)) return true
    if (avatarFile !== null || (avatarRemoved && initialValues.avatarUrl !== null)) return true
    if (deletedDepartmentIds.length > 0) return true
    if (departments.some((d) => d.isNew)) return true
    for (const dept of departments) {
      if (dept.isNew) continue
      const original = initialValues.departments.find((od) => od.id === dept.id)
      if (original && original.name !== dept.name) return true
    }
    return false
  }, [workspaceName, firstName, lastName, departmentId, location, hireDate, logoFile, avatarFile, logoRemoved, avatarRemoved, departments, deletedDepartmentIds, initialValues])

  // Navigation guard
  useEffect(() => {
    registerGuard(() => {
      if (!isDirty) return true
      return window.confirm("You have unsaved changes. Are you sure you want to leave?")
    })
    return () => unregisterGuard()
  }, [isDirty, registerGuard, unregisterGuard])

  // beforeunload guard
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  // Keep refs in sync for unmount cleanup
  useEffect(() => { logoPreviewRef.current = logoPreview }, [logoPreview])
  useEffect(() => { avatarPreviewRef.current = avatarPreview }, [avatarPreview])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (logoPreviewRef.current) URL.revokeObjectURL(logoPreviewRef.current)
      if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current)
    }
  }, [])

  function handleLogoFileSelect(file: File) {
    setLogoFile(file)
    setLogoRemoved(false)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  function handleLogoRemove() {
    setLogoFile(null)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setLogoRemoved(true)
  }

  function handleAvatarFileSelect(file: File) {
    setAvatarFile(file)
    setAvatarRemoved(false)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
  }

  function handleAvatarRemove() {
    setAvatarFile(null)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarRemoved(true)
  }

  function handleAddDepartment() {
    setDepartments((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: "", isNew: true },
    ])
  }

  function handleDepartmentNameChange(id: string, name: string) {
    setDepartments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, name } : d))
    )
  }

  function handleDeleteDepartment(id: string, isNew: boolean) {
    setDepartments((prev) => prev.filter((d) => d.id !== id))
    if (!isNew) {
      setDeletedDepartmentIds((prev) => [...prev, id])
    }
  }

  function handleCancel() {
    if (!initialValues) return
    setWorkspaceName(initialValues.workspaceName)
    setFirstName(initialValues.firstName)
    setLastName(initialValues.lastName)
    setDepartmentId(initialValues.departmentId)
    setLocation(initialValues.location)
    setHireDate(initialValues.hireDate)
    setLogoUrl(initialValues.logoUrl)
    setAvatarUrl(initialValues.avatarUrl)
    setLogoFile(null)
    setAvatarFile(null)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setLogoRemoved(false)
    setAvatarRemoved(false)
    setDepartments(initialValues.departments)
    setDeletedDepartmentIds([])
  }

  async function handleDeleteWorkspace() {
    if (!workspace || deleteConfirmation !== workspace.name) return
    setDeleting(true)
    try {
      await deleteWorkspace(workspace.id, deleteConfirmation)
      addToast({
        title: "Workspace deleted",
        description: "All workspace data has been permanently deleted.",
        variant: "success",
      })
      queryClient.clear()
      unregisterGuard()
      await signOut()
      navigate("/login", { replace: true })
    } catch (err) {
      console.error("Failed to delete workspace:", err)
      addToast({
        title: "Couldn't delete workspace",
        description: err instanceof Error ? err.message : "Try again.",
      })
      setDeleting(false)
    }
  }

  async function handleSave() {
    if (!workspace || !profile || !user) return
    setSaving(true)

    try {
      // 1. Handle workspace logo
      let newLogoUrl = logoUrl
      if (logoFile) {
        if (logoUrl) {
          try { await removeImage("logos", logoUrl) } catch { /* ignore */ }
        }
        newLogoUrl = await uploadImage("logos", workspace.id, logoFile)
      } else if (logoRemoved && logoUrl) {
        try { await removeImage("logos", logoUrl) } catch { /* ignore */ }
        newLogoUrl = null
      }

      // 2. Update workspace
      await updateWorkspace(workspace.id, {
        name: workspaceName,
        logo_url: newLogoUrl,
      })

      // 3. Handle avatar
      let newAvatarUrl = avatarUrl
      if (avatarFile) {
        if (avatarUrl) {
          try { await removeImage("avatars", avatarUrl) } catch { /* ignore */ }
        }
        newAvatarUrl = await uploadImage("avatars", user.id, avatarFile)
      } else if (avatarRemoved && avatarUrl) {
        try { await removeImage("avatars", avatarUrl) } catch { /* ignore */ }
        newAvatarUrl = null
      }

      // 4. Update profile
      await updateProfile(profile.id, {
        first_name: firstName,
        last_name: lastName,
        avatar_url: newAvatarUrl,
        department_id: departmentId || null,
        location: location || undefined,
        hire_date: hireDate ? hireDate.toISOString().split('T')[0] : undefined,
      })

      // 5. Handle departments
      for (const id of deletedDepartmentIds) {
        await deleteDepartment(id, workspace.id)
      }
      for (const dept of departments) {
        if (dept.isNew) {
          if (dept.name.trim()) {
            await createDepartment(workspace.id, dept.name.trim())
          }
        } else {
          const original = initialValues?.departments.find((od) => od.id === dept.id)
          if (original && original.name !== dept.name && dept.name.trim()) {
            await updateDepartment(dept.id, dept.name.trim(), workspace.id)
          }
        }
      }

      // 6. Refresh auth context (updates sidebar)
      await Promise.all([refreshWorkspace(), refreshProfile()])

      // 7. Invalidate query caches so other pages pick up changes
      await queryClient.invalidateQueries({ queryKey: departmentKeys.all(workspace.id) })
      queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })

      // 8. Re-fetch departments and reset state
      const freshDeps = await fetchDepartments(workspace.id)
      const rows = freshDeps.map((d: Department) => ({ id: d.id, name: d.name, isNew: false }))
      setDepartments(rows)
      setLogoUrl(newLogoUrl)
      setAvatarUrl(newAvatarUrl)
      setLogoFile(null)
      setAvatarFile(null)
      setLogoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setLogoRemoved(false)
      setAvatarRemoved(false)
      setDeletedDepartmentIds([])
      setInitialValues({
        workspaceName,
        firstName,
        lastName,
        logoUrl: newLogoUrl,
        avatarUrl: newAvatarUrl,
        departments: rows,
        departmentId,
        location,
        hireDate,
      })
      addToast({ title: "Settings saved" })
    } catch (err) {
      console.error("Failed to save settings:", err)
      addToast({ title: "Couldn't save settings", description: "Try again." })
    } finally {
      setSaving(false)
    }
  }

  // Resolve displayed images
  const displayedLogo = logoPreview ?? (logoRemoved ? null : logoUrl)
  const displayedAvatar = avatarPreview ?? (avatarRemoved ? null : avatarUrl)
  const initials = getInitials(firstName, lastName)
  const avatarFallback = useMemo(() => {
    if (initials) return initials
    return <User className="size-6 text-muted-foreground" />
  }, [initials])

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
        <button className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors">
          <Settings className="size-4" />
        </button>
        <div className="flex items-center h-6 pr-2 relative shrink-0">
          <Separator orientation="vertical" />
        </div>
        <BreadcrumbItem text="Settings" className="flex-1 text-foreground font-medium" />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[600px] py-8 px-4 flex flex-col gap-8">
          {/* Title */}
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold leading-8 text-foreground">Settings</h1>
            <p className="text-sm leading-5 text-muted-foreground">
              Personalize how Nova looks for your entire team
            </p>
          </div>

          <WorkspaceSection
            workspaceName={workspaceName}
            onWorkspaceNameChange={setWorkspaceName}
            displayedLogo={displayedLogo}
            onLogoFileSelect={handleLogoFileSelect}
            onLogoRemove={handleLogoRemove}
            isOwner={isOwner}
            deleteDialogOpen={deleteDialogOpen}
            onDeleteDialogOpenChange={setDeleteDialogOpen}
            deleteConfirmation={deleteConfirmation}
            onDeleteConfirmationChange={setDeleteConfirmation}
            onDeleteWorkspace={handleDeleteWorkspace}
            deleting={deleting}
            workspaceDisplayName={workspace?.name}
          />

          <Separator />

          <ProfileSection
            firstName={firstName}
            onFirstNameChange={setFirstName}
            lastName={lastName}
            onLastNameChange={setLastName}
            departmentId={departmentId}
            onDepartmentIdChange={setDepartmentId}
            location={location}
            onLocationChange={setLocation}
            hireDate={hireDate}
            onHireDateChange={setHireDate}
            displayedAvatar={displayedAvatar}
            avatarFallback={avatarFallback}
            onAvatarFileSelect={handleAvatarFileSelect}
            onAvatarRemove={handleAvatarRemove}
            departments={cachedDepartments}
          />

          <Separator />

          <DepartmentsSection
            departments={departments}
            onAdd={handleAddDepartment}
            onNameChange={handleDepartmentNameChange}
            onDelete={handleDeleteDepartment}
          />

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={handleCancel} disabled={!isDirty}>
              Cancel
            </Button>
            {!isDirty ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <Button disabled loadingText="Saving changes">
                      Save changes
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>No changes to save</TooltipContent>
              </Tooltip>
            ) : (
              <Button onClick={handleSave} loading={saving} loadingText="Saving changes">
                Save changes
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

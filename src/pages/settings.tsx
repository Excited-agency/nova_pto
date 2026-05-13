import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Settings, Plus, Trash2, CloudUpload, User } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/hooks/use-auth"
import { useNavigationGuard } from "@/contexts/navigation-guard-context"
import { validateImageFile } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Avatar } from "@/components/ui/avatar"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
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
import { useDepartments } from "@/hooks/use-departments"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { LocationCombobox } from "@/components/ui/location-combobox"
import { DatePicker } from "@/components/ui/date-picker"
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
import { getInitials } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import type { Department } from "@/types/department"

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

  const logoInputRef = useRef<HTMLInputElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
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
    // Image dirty: new file staged, OR removing an existing image
    if (logoFile !== null || (logoRemoved && initialValues.logoUrl !== null)) return true
    if (avatarFile !== null || (avatarRemoved && initialValues.avatarUrl !== null)) return true
    if (deletedDepartmentIds.length > 0) return true
    if (departments.some((d) => d.isNew)) return true
    // Check renamed departments
    for (const dept of departments) {
      if (dept.isNew) continue
      const original = initialValues.departments.find((od) => od.id === dept.id)
      if (original && original.name !== dept.name) return true
    }
    return false
  }, [workspaceName, firstName, lastName, departmentId, location, hireDate, logoFile, avatarFile, logoRemoved, avatarRemoved, departments, deletedDepartmentIds, initialValues])

  // Navigation guard (sidebar clicks)
  useEffect(() => {
    registerGuard(() => {
      if (!isDirty) return true
      return window.confirm("You have unsaved changes. Are you sure you want to leave?")
    })
    return () => unregisterGuard()
  }, [isDirty, registerGuard, unregisterGuard])

  // beforeunload (browser tab close / hard refresh)
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
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

  const handleLogoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateImageFile(file)
    if (validationError) {
      addToast({ title: "Invalid file", description: validationError })
      return
    }
    setLogoFile(file)
    setLogoRemoved(false)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    e.target.value = ""
  }, [])

  const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateImageFile(file)
    if (validationError) {
      addToast({ title: "Invalid file", description: validationError })
      return
    }
    setAvatarFile(file)
    setAvatarRemoved(false)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(file)
    })
    e.target.value = ""
  }, [])

  function handleRemoveLogo() {
    setLogoFile(null)
    setLogoPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setLogoRemoved(true)
  }

  function handleRemoveAvatar() {
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
  const hasLogo = !!displayedLogo
  const hasAvatar = !!displayedAvatar
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

          {/* General section */}
          <section className="flex flex-col gap-5">
            <h2 className="text-base font-semibold leading-6 text-foreground">General</h2>

            {/* Workspace name */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium leading-5 text-foreground">
                Workspace name
              </label>
              <Input
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
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
                      onClick={handleRemoveLogo}
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

          <Separator />

          {/* Personal details section */}
          <section className="flex flex-col gap-5">
            <h2 className="text-base font-semibold leading-6 text-foreground">Personal details</h2>

            {/* Your name */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name">
                <Input
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </Field>
              <Field label="Last name">
                <Input
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Field>
            </div>

            {/* Department */}
            <Field label="Department">
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {cachedDepartments?.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {/* Start date + Location */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <DatePicker value={hireDate} onChange={setHireDate} />
              </Field>
              <Field label="Location">
                <LocationCombobox value={location} onChange={setLocation} />
              </Field>
            </div>

            {/* Your photo */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium leading-5 text-foreground">
                Your photo
              </label>
              <div className="flex items-center gap-4">
                <Avatar
                  size="xl"
                  shape="square"
                  src={displayedAvatar ?? undefined}
                  fallback={avatarFallback}
                />
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      <CloudUpload className="size-4" />
                      {hasAvatar ? "Replace photo" : "Upload photo"}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!hasAvatar}
                      onClick={handleRemoveAvatar}
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
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleAvatarSelect}
              />
            </div>
          </section>

          <Separator />

          {/* Departments section */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold leading-6 text-foreground">Departments</h2>
              <Button variant="outline" size="sm" onClick={handleAddDepartment}>
                <Plus className="size-4" />
                Add department
              </Button>
            </div>

            {departments.length > 0 && (
              <div className="flex flex-col gap-2">
                {departments.map((dept) => (
                  <div key={dept.id} className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      value={dept.name}
                      onChange={(e) => handleDepartmentNameChange(dept.id, e.target.value)}
                      placeholder="Department name"
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDeleteDepartment(dept.id, dept.isNew)}
                    >
                      <Trash2 className="size-4 text-error" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Danger Zone — owner only */}
          {isOwner && (
            <>
              <Separator />

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
                      setDeleteDialogOpen(open)
                      if (!open) setDeleteConfirmation("")
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
                          This will permanently delete the workspace &ldquo;{workspace?.name}&rdquo;,
                          all employees, time-off requests, categories, and settings.
                          All team members will be signed out and removed.
                          This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <div className="flex flex-col gap-2">
                        <label className="text-sm font-medium leading-5 text-foreground">
                          Type <span className="font-semibold">{workspace?.name}</span> to confirm
                        </label>
                        <Input
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder={workspace?.name}
                          autoComplete="off"
                        />
                      </div>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button
                          variant="destructive"
                          onClick={handleDeleteWorkspace}
                          disabled={deleteConfirmation !== workspace?.name}
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
            </>
          )}

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

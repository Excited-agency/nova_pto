import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { Settings, CloudUpload, User } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { useAuth } from "@/hooks/use-auth"
import { useNavigationGuard } from "@/contexts/navigation-guard-context"
import { validateImageFile, getInitials  } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Avatar } from "@/components/ui/avatar"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import {
  updateProfile,
  uploadImage,
  removeImage,
} from "@/lib/settings-service"
import { employeeKeys } from "@/lib/query-keys"
import { addToast } from "@/lib/toast"

interface InitialValues {
  firstName: string
  lastName: string
  avatarUrl: string | null
}

export function UserSettingsPage() {
  const { workspace, profile, user, refreshProfile } = useAuth()
  const { registerGuard, unregisterGuard } = useNavigationGuard()
  const queryClient = useQueryClient()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarRemoved, setAvatarRemoved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [initialValues, setInitialValues] = useState<InitialValues | null>(null)

  const avatarInputRef = useRef<HTMLInputElement>(null)
  const avatarPreviewRef = useRef<string | null>(null)

  useEffect(() => {
    if (!profile) return
    const fName = profile.first_name || ""
    const lName = profile.last_name || ""
    const aUrl = profile.avatar_url || null
    setFirstName(fName)
    setLastName(lName)
    setAvatarUrl(aUrl)
    setInitialValues({ firstName: fName, lastName: lName, avatarUrl: aUrl })
  }, [profile?.id])

  const isDirty = useMemo(() => {
    if (!initialValues) return false
    if (firstName !== initialValues.firstName) return true
    if (lastName !== initialValues.lastName) return true
    if (avatarFile !== null || (avatarRemoved && initialValues.avatarUrl !== null)) return true
    return false
  }, [firstName, lastName, avatarFile, avatarRemoved, initialValues])

  useEffect(() => {
    registerGuard(() => {
      if (!isDirty) return true
      return window.confirm("You have unsaved changes. Are you sure you want to leave?")
    })
    return () => unregisterGuard()
  }, [isDirty, registerGuard, unregisterGuard])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  useEffect(() => { avatarPreviewRef.current = avatarPreview }, [avatarPreview])

  useEffect(() => {
    return () => {
      if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current)
    }
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

  function handleRemoveAvatar() {
    setAvatarFile(null)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarRemoved(true)
  }

  function handleCancel() {
    if (!initialValues) return
    setFirstName(initialValues.firstName)
    setLastName(initialValues.lastName)
    setAvatarUrl(initialValues.avatarUrl)
    setAvatarFile(null)
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setAvatarRemoved(false)
  }

  async function handleSave() {
    if (!workspace || !profile || !user) return
    setSaving(true)
    try {
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

      await updateProfile(profile.id, {
        first_name: firstName,
        last_name: lastName,
        avatar_url: newAvatarUrl,
      })

      await refreshProfile()
      queryClient.invalidateQueries({ queryKey: employeeKeys.all(workspace.id) })

      setAvatarUrl(newAvatarUrl)
      setAvatarFile(null)
      setAvatarPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setAvatarRemoved(false)
      setInitialValues({ firstName, lastName, avatarUrl: newAvatarUrl })
      addToast({ title: "Settings saved" })
    } catch (err) {
      console.error("Failed to save settings:", err)
      addToast({ title: "Couldn't save settings", description: "Try again." })
    } finally {
      setSaving(false)
    }
  }

  const displayedAvatar = avatarPreview ?? (avatarRemoved ? null : avatarUrl)
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
              Manage your personal details
            </p>
          </div>

          {/* Personal details section */}
          <section className="flex flex-col gap-5">
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

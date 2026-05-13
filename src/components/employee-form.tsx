import { useState, useMemo } from "react"
import { CloudUpload, User } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Avatar } from "@/components/ui/avatar"
import { RadioGroup } from "@/components/ui/radio-group"
import { RadioGroupOption } from "@/components/ui/radio-group-option"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { DatePicker } from "@/components/ui/date-picker"
import { LocationCombobox } from "@/components/ui/location-combobox"
import { useDepartments } from "@/hooks/use-departments"
import { useImageUpload } from "@/hooks/use-image-upload"
import { getInitials, getDisplayName } from "@/lib/utils"

export interface EmployeeFormData {
  email: string
  firstName: string
  lastName: string
  departmentId: string
  role: string
  location: string
  startDate: Date | undefined
  avatarFile: File | null
  avatarPreview: string | null
  avatarRemoved: boolean
}

interface EmployeeFormProps {
  mode: "add" | "edit"
  initialData?: {
    email: string
    firstName: string
    lastName: string
    departmentId: string
    role: string
    location: string
    startDate: Date | undefined
    avatarUrl: string | undefined
  }
  title: string
  subtitle: string
  submitLabel: string
  onSubmit: (data: EmployeeFormData) => Promise<void>
  onCancel: () => void
}

export function EmployeeForm({
  mode,
  initialData,
  title,
  subtitle,
  submitLabel,
  onSubmit,
  onCancel,
}: EmployeeFormProps) {
  // Form state
  const [email, setEmail] = useState(initialData?.email ?? "")
  const [firstName, setFirstName] = useState(initialData?.firstName ?? "")
  const [lastName, setLastName] = useState(initialData?.lastName ?? "")
  const [departmentId, setDepartmentId] = useState(initialData?.departmentId ?? "")
  const [role, setRole] = useState(initialData?.role ?? "user")
  const [location, setLocation] = useState(initialData?.location ?? "")
  const [startDate, setStartDate] = useState<Date | undefined>(initialData?.startDate)

  // Track whether user removed the existing avatar (edit mode)
  const [avatarRemoved, setAvatarRemoved] = useState(false)

  // File upload
  const {
    file: avatarFile,
    preview: avatarPreview,
    error: fileError,
    inputRef: fileInputRef,
    handleSelect: handleFileSelect,
    handleRemove: handleRemovePhotoRaw,
  } = useImageUpload({ initialPreview: initialData?.avatarUrl })

  function handleRemovePhoto() {
    handleRemovePhotoRaw()
    setAvatarRemoved(true)
  }

  // UI state
  const { data: departments = [] } = useDepartments()
  const [submitting, setSubmitting] = useState(false)
  const [emailError, setEmailError] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Snapshot initial values once on mount (edit mode only)
  const initialSnapshot = useMemo(() => {
    if (mode !== "edit" || !initialData) return null
    return {
      firstName: initialData.firstName,
      lastName: initialData.lastName,
      departmentId: initialData.departmentId,
      role: initialData.role,
      location: initialData.location,
      startDate: initialData.startDate?.getTime(),
      avatarUrl: initialData.avatarUrl ?? null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Intentional: snapshot initialData once on mount — re-running when props change
    // would reset the dirty-check baseline mid-edit.
  }, [])

  const isDirty = useMemo(() => {
    if (!initialSnapshot) return true // add mode — always "dirty" if valid
    if (firstName.trim() !== initialSnapshot.firstName) return true
    if (lastName.trim() !== initialSnapshot.lastName) return true
    if (departmentId !== initialSnapshot.departmentId) return true
    if (role !== initialSnapshot.role) return true
    if (location !== initialSnapshot.location) return true
    if ((startDate?.getTime() ?? undefined) !== initialSnapshot.startDate) return true
    if (avatarFile !== null) return true
    if (avatarRemoved && initialSnapshot.avatarUrl !== null) return true
    return false
  }, [firstName, lastName, departmentId, role, location, startDate, avatarFile, avatarRemoved, initialSnapshot])

  const displayName = getDisplayName(firstName, lastName)

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const isValid =
    isValidEmail &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    departmentId.length > 0 &&
    role.length > 0 &&
    location.trim().length > 0 &&
    startDate !== undefined

  const saveTooltip = useMemo(() => {
    const allFieldsFilled =
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      departmentId.length > 0 &&
      role.length > 0 &&
      location.trim().length > 0 &&
      startDate !== undefined &&
      email.trim().length > 0

    if (mode === "add") {
      if (allFieldsFilled && !isValidEmail) return "Please enter a valid work email address"
      if (!isValid || !!fileError) return "Please fill in all required fields to continue"
      return undefined
    }

    // edit mode
    if (!isValid || !!fileError) return "Please fill in all required fields correctly"
    if (!isDirty) return "No changes to save"
    return undefined
  }, [mode, isValid, isValidEmail, fileError, isDirty, firstName, lastName, departmentId, role, location, startDate, email])

  function handleEmailBlur() {
    const trimmed = email.trim()
    if (trimmed.length === 0) {
      setEmailError(false)
      return
    }
    setEmailError(!isValidEmail)
  }

  const initials = getInitials(firstName, lastName)

  const avatarFallback = useMemo(() => {
    if (initials) return initials
    return <User className="size-6 text-muted-foreground" />
  }, [initials])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isValid || submitting) return

    setSubmitting(true)
    setError(null)

    try {
      await onSubmit({
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        departmentId,
        role,
        location,
        startDate,
        avatarFile,
        avatarPreview,
        avatarRemoved,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 items-center pt-6 pb-8 px-4"
    >
      {/* Title section */}
      <div className="w-[600px] flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-8 tracking-[-0.4px]">
          {title}
        </h2>
        <p className="text-sm font-normal leading-5 tracking-[-0.28px] text-muted-foreground">
          {subtitle}
        </p>
      </div>

      {/* Form fields */}
      <div className="w-[600px] flex flex-col gap-4">
        {/* Work email */}
        <Field label="Work email" invalid={emailError}>
          {mode === "edit" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full">
                  <Input
                    type="email"
                    placeholder="example@company.com"
                    value={email}
                    disabled
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Email address cannot be changed</TooltipContent>
            </Tooltip>
          ) : (
            <Input
              type="email"
              placeholder="example@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={handleEmailBlur}
              aria-invalid={emailError}
            />
          )}
          {emailError && (
            <p className="text-sm text-destructive">
              Please enter a valid email (e.g., name@company.com)
            </p>
          )}
        </Field>

        {/* First name / Last name */}
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
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {/* Photo */}
        <Field label="Photo">
          <div className="flex items-center gap-4">
            <Avatar
              src={avatarPreview ?? undefined}
              alt={displayName}
              fallback={avatarFallback}
              size="xl"
              shape="square"
            />
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <CloudUpload className="size-4" />
                  {avatarPreview ? "Replace photo" : "Upload photo"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!avatarPreview}
                  onClick={handleRemovePhoto}
                >
                  Remove
                </Button>
              </div>
              {fileError ? (
                <p className="text-xs text-destructive">{fileError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  PNG or JPG, up to 5 MB
                </p>
              )}
            </div>
          </div>
        </Field>

        {/* Role */}
        <Field label="Role">
          {role === "owner" ? (
            <div className="flex items-center h-10 px-3 rounded-lg border border-border bg-muted/50">
              <span className="text-sm font-medium text-foreground">Owner</span>
            </div>
          ) : (
            <RadioGroup
              value={role}
              onValueChange={setRole}
              className="w-full grid grid-cols-2 gap-3"
            >
              <RadioGroupOption
                value="user"
                label="User"
                description="Request and track personal time off"
                variant="card"
              />
              <RadioGroupOption
                value="admin"
                label="Admin"
                description="Manage team and workspace settings"
                variant="card"
              />
            </RadioGroup>
          )}
        </Field>

        {/* Start date / Location */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <DatePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Pick a date"
            />
          </Field>
          <Field label="Location">
            <LocationCombobox
              value={location}
              onChange={setLocation}
              placeholder="Type location"
            />
          </Field>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="w-[600px] text-sm text-destructive">{error}</p>
      )}

      {/* Actions */}
      <div className="w-[600px] flex items-center justify-between pt-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
        >
          Cancel
        </Button>
        {saveTooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <Button
                  type="submit"
                  disabled
                  loading={submitting}
                >
                  {submitLabel}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{saveTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <Button
            type="submit"
            disabled={!isValid || !!fileError || !isDirty}
            loading={submitting}
          >
            {submitLabel}
          </Button>
        )}
      </div>
    </form>
  )
}

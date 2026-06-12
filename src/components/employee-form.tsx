import { useState, useMemo, useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
import { FormPageLayout } from "@/components/form-page-layout"

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

const employeeFormSchema = z.object({
  email: z.string().min(1, "Email is required").email("Please enter a valid email"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  departmentId: z.string().min(1, "Department is required"),
  role: z.string().min(1, "Role is required"),
  location: z.string().min(1, "Location is required"),
  startDate: z.date().optional(),
})

type EmployeeFormValues = z.infer<typeof employeeFormSchema>

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
  onDirtyChange?: (isDirty: boolean) => void
}

export function EmployeeForm({
  mode,
  initialData,
  title,
  subtitle,
  submitLabel,
  onSubmit,
  onCancel,
  onDirtyChange,
}: EmployeeFormProps) {
  // Track whether user removed the existing avatar (edit mode)
  const [avatarRemoved, setAvatarRemoved] = useState(false)

  // File upload — managed outside RHF (not a standard input)
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
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { isValid, isDirty: rhfIsDirty, isSubmitting, errors },
  } = useForm<EmployeeFormValues>({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: {
      email: initialData?.email ?? "",
      firstName: initialData?.firstName ?? "",
      lastName: initialData?.lastName ?? "",
      departmentId: initialData?.departmentId ?? "",
      role: initialData?.role ?? "user",
      location: initialData?.location ?? "",
      startDate: initialData?.startDate,
    },
    mode: "onChange",
  })

  const { firstName, lastName, role, email, departmentId, location, startDate } = watch()

  // Snapshot initial values once on mount (edit mode only)
  const initialSnapshot = useMemo(() => {
    if (mode !== "edit" || !initialData) return null
    return {
      avatarUrl: initialData.avatarUrl ?? null,
    }

    // Intentional: snapshot initialData once on mount — re-running when props change
    // would reset the dirty-check baseline mid-edit.
  }, [])

  // Combine RHF dirty state with image dirty state
  const isDirty = useMemo(() => {
    if (mode === "add") return true // add mode — always "dirty" if valid
    if (rhfIsDirty) return true
    if (avatarFile !== null) return true
    if (avatarRemoved && (initialSnapshot?.avatarUrl ?? null) !== null) return true
    return false
  }, [mode, rhfIsDirty, avatarFile, avatarRemoved, initialSnapshot])

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const displayName = getDisplayName(firstName, lastName)

  const emailError = errors.email != null

  const saveTooltip = useMemo(() => {
    const allFieldsFilled =
      firstName.trim().length > 0 &&
      lastName.trim().length > 0 &&
      departmentId.length > 0 &&
      role.length > 0 &&
      location.trim().length > 0 &&
      email.trim().length > 0

    if (mode === "add") {
      if (allFieldsFilled && emailError) return "Please enter a valid work email address"
      if (!isValid || !!fileError) return "Please fill in all required fields to continue"
      return undefined
    }

    // edit mode
    if (!isValid || !!fileError) return "Please fill in all required fields correctly"
    if (!isDirty) return "No changes to save"
    return undefined
  }, [mode, isValid, emailError, fileError, isDirty, firstName, lastName, departmentId, role, location, email])

  const initials = getInitials(firstName, lastName)

  const avatarFallback = useMemo(() => {
    if (initials) return initials
    return <User className="size-6 text-muted-foreground" />
  }, [initials])

  const onFormSubmit = handleSubmit(async (data) => {
    setError(null)
    try {
      await onSubmit({
        email: data.email.trim(),
        firstName: data.firstName.trim(),
        lastName: data.lastName.trim(),
        departmentId: data.departmentId,
        role: data.role,
        location: data.location,
        startDate: data.startDate,
        avatarFile,
        avatarPreview,
        avatarRemoved,
      })
    } catch (err) {
      setError((err as Error).message)
    }
  })

  return (
    <form onSubmit={onFormSubmit}>
      <FormPageLayout>
      {/* Title section */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold leading-8 tracking-[-0.4px]">
          {title}
        </h2>
        <p className="text-sm font-normal leading-5 tracking-[-0.28px] text-muted-foreground">
          {subtitle}
        </p>
      </div>

      {/* Form fields */}
      <div className="flex flex-col gap-4">
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
              aria-invalid={emailError}
              {...register("email")}
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
              {...register("firstName")}
            />
          </Field>
          <Field label="Last name">
            <Input
              placeholder="Last name"
              {...register("lastName")}
            />
          </Field>
        </div>

        {/* Department */}
        <Field label="Department">
          <Controller
            name="departmentId"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
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
            )}
          />
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
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
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
            />
          )}
        </Field>

        {/* Start date / Location */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Controller
              name="startDate"
              control={control}
              render={({ field }) => (
                <DatePicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Pick a date"
                />
              )}
            />
          </Field>
          <Field label="Location">
            <Controller
              name="location"
              control={control}
              render={({ field }) => (
                <LocationCombobox
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Type location"
                />
              )}
            />
          </Field>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-3">
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
                  loading={isSubmitting}
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
            loading={isSubmitting}
          >
            {submitLabel}
          </Button>
        )}
      </div>
      </FormPageLayout>
    </form>
  )
}

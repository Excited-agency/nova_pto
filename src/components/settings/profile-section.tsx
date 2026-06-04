import { useRef, useCallback } from "react"
import { CloudUpload, User } from "lucide-react"

import { validateImageFile } from "@/lib/utils"
import { addToast } from "@/lib/toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { Avatar } from "@/components/ui/avatar"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { LocationCombobox } from "@/components/ui/location-combobox"
import { DatePicker } from "@/components/ui/date-picker"
import type { Department } from "@/types/department"

interface ProfileSectionProps {
  firstName: string
  onFirstNameChange: (value: string) => void
  lastName: string
  onLastNameChange: (value: string) => void
  departmentId: string
  onDepartmentIdChange: (value: string) => void
  location: string
  onLocationChange: (value: string) => void
  hireDate: Date | undefined
  onHireDateChange: (value: Date | undefined) => void
  displayedAvatar: string | null
  avatarFallback: React.ReactNode
  onAvatarFileSelect: (file: File) => void
  onAvatarRemove: () => void
  departments: Department[] | undefined
}

export function ProfileSection({
  firstName,
  onFirstNameChange,
  lastName,
  onLastNameChange,
  departmentId,
  onDepartmentIdChange,
  location,
  onLocationChange,
  hireDate,
  onHireDateChange,
  displayedAvatar,
  avatarFallback,
  onAvatarFileSelect,
  onAvatarRemove,
  departments,
}: ProfileSectionProps) {
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const hasAvatar = !!displayedAvatar

  const handleAvatarSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const validationError = validateImageFile(file)
    if (validationError) {
      addToast({ title: "Invalid file", description: validationError })
      return
    }
    onAvatarFileSelect(file)
    e.target.value = ""
  }, [onAvatarFileSelect])

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-base font-semibold leading-6 text-foreground">Personal details</h2>

      {/* Name fields */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <Input
            placeholder="First name"
            value={firstName}
            onChange={(e) => onFirstNameChange(e.target.value)}
          />
        </Field>
        <Field label="Last name">
          <Input
            placeholder="Last name"
            value={lastName}
            onChange={(e) => onLastNameChange(e.target.value)}
          />
        </Field>
      </div>

      {/* Department */}
      <Field label="Department">
        <Select value={departmentId} onValueChange={onDepartmentIdChange}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select department" />
          </SelectTrigger>
          <SelectContent>
            {departments?.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Start date + Location */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date">
          <DatePicker value={hireDate} onChange={onHireDateChange} />
        </Field>
        <Field label="Location">
          <LocationCombobox value={location} onChange={onLocationChange} />
        </Field>
      </div>

      {/* Avatar */}
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
                onClick={onAvatarRemove}
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
  )
}

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { IMAGE_ALLOWED_TYPES, IMAGE_MAX_SIZE } from "@/lib/constants"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Accept null as well as undefined: these read straight from nullable DB columns.
export function getInitials(firstName?: string | null, lastName?: string | null): string | undefined {
  const f = firstName?.trim().charAt(0).toUpperCase() ?? ""
  const l = lastName?.trim().charAt(0).toUpperCase() ?? ""
  return (f + l) || undefined
}

export function getDisplayName(firstName?: string | null, lastName?: string | null): string {
  return [firstName?.trim(), lastName?.trim()].filter(Boolean).join(" ")
}

export function pluralize(count: number | null, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

export function validateImageFile(file: File): string | null {
  if (!IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return "Only PNG and JPG files are allowed."
  }
  if (file.size > IMAGE_MAX_SIZE) {
    return "File is too large. Max size is 5 MB."
  }
  return null
}

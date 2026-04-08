import type { SchemaField, HeaderMapping } from "@/types/csv-import"

/**
 * Alias table: each schema field maps to a list of known CSV header variations.
 * All aliases are lowercase.
 */
const FIELD_ALIASES: Record<SchemaField, string[]> = {
  email: [
    "email",
    "e-mail",
    "mail",
    "email address",
    "work email",
    "employee email",
  ],
  first_name: ["first name", "first", "given name", "fname", "firstname"],
  last_name: [
    "last name",
    "last",
    "surname",
    "family name",
    "lname",
    "lastname",
  ],
  full_name: ["full name", "name", "employee name", "employee"],
  department: ["department", "dept", "team", "group", "division"],
  role: ["role", "permission", "access level", "type"],
  location: [
    "location",
    "office",
    "city",
    "office location",
    "work location",
  ],
  hire_date: [
    "hire date",
    "start date",
    "date hired",
    "join date",
    "joining date",
    "start",
    "hiredate",
    "startdate",
  ],
}

/** Keywords for substring fallback matching (Phase 2). Order matters — first match wins. */
const SUBSTRING_KEYWORDS: { keyword: string; field: SchemaField }[] = [
  { keyword: "mail", field: "email" },
  { keyword: "first", field: "first_name" },
  { keyword: "surname", field: "last_name" },
  { keyword: "last", field: "last_name" },
  { keyword: "dept", field: "department" },
  { keyword: "team", field: "department" },
  { keyword: "hire", field: "hire_date" },
  { keyword: "join", field: "hire_date" },
  { keyword: "start", field: "hire_date" },
  { keyword: "date", field: "hire_date" },
  { keyword: "location", field: "location" },
  { keyword: "office", field: "location" },
  { keyword: "city", field: "location" },
  { keyword: "role", field: "role" },
  { keyword: "permission", field: "role" },
  { keyword: "name", field: "full_name" },
]

function normalize(header: string): string {
  return header.toLowerCase().trim().replace(/[^a-z0-9 ]/g, "")
}

/**
 * Maps CSV headers to schema fields using exact alias matching + substring fallback.
 */
export function mapHeaders(csvHeaders: string[]): HeaderMapping {
  const columnToField = new Map<string, SchemaField>()
  const assignedFields = new Set<SchemaField>()
  const unmappedHeaders: string[] = []

  // Build reverse lookup: alias → field
  const aliasToField = new Map<string, SchemaField>()
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      aliasToField.set(alias, field as SchemaField)
    }
  }

  // Phase 1: Exact match
  const remainingHeaders: string[] = []
  for (const header of csvHeaders) {
    const normalized = normalize(header)
    const field = aliasToField.get(normalized)
    if (field && !assignedFields.has(field)) {
      columnToField.set(header, field)
      assignedFields.add(field)
    } else {
      remainingHeaders.push(header)
    }
  }

  // Phase 2: Substring containment for unmatched headers
  for (const header of remainingHeaders) {
    const normalized = normalize(header)
    let matched = false
    for (const { keyword, field } of SUBSTRING_KEYWORDS) {
      if (!assignedFields.has(field) && normalized.includes(keyword)) {
        columnToField.set(header, field)
        assignedFields.add(field)
        matched = true
        break
      }
    }
    if (!matched) {
      unmappedHeaders.push(header)
    }
  }

  return { columnToField, unmappedHeaders }
}

/**
 * Splits a full name string into first and last name.
 * First token → first_name, remainder → last_name.
 */
export function splitFullName(fullName: string): {
  first_name: string
  last_name: string
} {
  const trimmed = fullName.trim()
  const spaceIndex = trimmed.indexOf(" ")
  if (spaceIndex === -1) {
    return { first_name: trimmed, last_name: "" }
  }
  return {
    first_name: trimmed.slice(0, spaceIndex),
    last_name: trimmed.slice(spaceIndex + 1).trim(),
  }
}

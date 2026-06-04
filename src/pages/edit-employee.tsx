import { useState, useEffect, useCallback } from "react"
import { useNavigate, useParams, useLocation } from "react-router-dom"
import { Users, ChevronRight } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { EmployeeForm, type EmployeeFormData } from "@/components/employee-form"
import { uploadImage } from "@/lib/settings-service"
import { useEmployee, useUpdateEmployeeMutation } from "@/hooks/use-employees"
import { addToast } from "@/lib/toast"
import { useNavigationGuard } from "@/contexts/navigation-guard-context"

export function EditEmployeePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const cameFromList = (location.state as { from?: string } | null)?.from === "list"
  const backPath = cameFromList ? "/employees" : `/employees/${id}`
  const { data: employee, isLoading: loading, isError } = useEmployee(id)
  const updateMutation = useUpdateEmployeeMutation()
  const { registerGuard, unregisterGuard } = useNavigationGuard()
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (isError) {
      addToast({ title: "Employee not found", description: "Couldn't load this employee." })
      navigate("/employees")
    }
  }, [isError, navigate])

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

  const handleDirtyChange = useCallback((dirty: boolean) => setIsDirty(dirty), [])

  async function handleSubmit(data: EmployeeFormData) {
    if (!id) return

    let avatarUrl: string | null | undefined = undefined

    if (data.avatarFile) {
      avatarUrl = await uploadImage("avatars", "employees", data.avatarFile)
    } else if (data.avatarRemoved) {
      avatarUrl = null
    }

    await updateMutation.mutateAsync({
      employeeId: id,
      data: {
        first_name: data.firstName || undefined,
        last_name: data.lastName || undefined,
        role: data.role,
        department_id: data.departmentId || null,
        location: data.location || undefined,
        hire_date: data.startDate
          ? data.startDate.toISOString().split("T")[0]
          : undefined,
        ...(avatarUrl !== undefined && { avatar_url: avatarUrl }),
      },
    })

    addToast({ title: "Changes saved" })
    navigate(backPath)
  }

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 h-[60px] shrink-0">
      <button
        className="flex items-center justify-center size-7 rounded-[10px] shrink-0 text-foreground hover:bg-accent transition-colors"
        onClick={() => navigate("/employees")}
      >
        <Users className="size-4" />
      </button>
      <div className="flex items-center h-6 pr-2 relative shrink-0">
        <Separator orientation="vertical" />
      </div>
      <BreadcrumbItem
        text="Employees"
        onClick={() => navigate("/employees")}
      />
      {!cameFromList && (
        <>
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
          <BreadcrumbItem
            text="Employee details"
            onClick={() => navigate(`/employees/${id}`)}
          />
        </>
      )}
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
      <BreadcrumbItem
        text="Edit details"
        className="text-foreground font-medium"
      />
    </div>
  )

  if (loading) {
    return (
      <div className="flex flex-col size-full">
        {header}
        <div className="flex-1 flex items-center justify-center">
          <div className="size-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
        </div>
      </div>
    )
  }

  if (!employee) return null

  const initialData = {
    email: employee.email,
    firstName: employee.first_name ?? "",
    lastName: employee.last_name ?? "",
    departmentId: employee.department_id ?? "",
    role: employee.role,
    location: employee.location ?? "",
    startDate: employee.hire_date
      ? new Date(employee.hire_date + "T00:00:00")
      : undefined,
    avatarUrl: employee.avatar_url,
  }

  return (
    <div className="flex flex-col size-full">
      {header}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <EmployeeForm
          mode="edit"
          initialData={initialData}
          title="Edit employee details"
          subtitle="Update the personal information and role of your employee"
          submitLabel="Save changes"
          onSubmit={handleSubmit}
          onCancel={() => navigate(backPath)}
          onDirtyChange={handleDirtyChange}
        />
      </div>
    </div>
  )
}

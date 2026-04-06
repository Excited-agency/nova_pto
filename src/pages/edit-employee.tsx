import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { Users, ChevronRight } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { EmployeeForm, type EmployeeFormData } from "@/components/employee-form"
import { uploadImage } from "@/lib/settings-service"
import { useEmployee, useUpdateEmployeeMutation } from "@/hooks/use-employees"
import { addToast } from "@/lib/toast"
import type { Profile } from "@/contexts/auth-context"

export function EditEmployeePage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: employee, isLoading: loading, isError } = useEmployee(id)
  const updateMutation = useUpdateEmployeeMutation()

  useEffect(() => {
    if (isError) {
      addToast({ title: "Employee not found", description: "Could not load employee details" })
      navigate("/employees")
    }
  }, [isError, navigate])

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

    addToast({
      title: "Changes saved successfully",
      description: "Employee details have been updated",
    })
    navigate(`/employees/${id}`)
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
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
      <BreadcrumbItem
        text="Employee details"
        onClick={() => navigate(`/employees/${id}`)}
      />
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

  const emp = employee as Profile

  const initialData = {
    email: emp.email,
    firstName: emp.first_name ?? "",
    lastName: emp.last_name ?? "",
    departmentId: emp.department_id ?? "",
    role: emp.role,
    location: emp.location ?? "",
    startDate: emp.hire_date
      ? new Date(emp.hire_date + "T00:00:00")
      : undefined,
    avatarUrl: emp.avatar_url,
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
          onCancel={() => navigate(`/employees/${id}`)}
        />
      </div>
    </div>
  )
}

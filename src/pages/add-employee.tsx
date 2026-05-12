import { useNavigate } from "react-router-dom"
import { Users, ChevronRight } from "lucide-react"

import { Separator } from "@/components/ui/separator"
import { BreadcrumbItem } from "@/components/ui/breadcrumb-item"
import { EmployeeForm, type EmployeeFormData } from "@/components/employee-form"
import { uploadImage, removeImage } from "@/lib/settings-service"
import { useInviteEmployeeMutation } from "@/hooks/use-employees"
import { addToast } from "@/lib/toast"

export function AddEmployeePage() {
  const navigate = useNavigate()
  const inviteMutation = useInviteEmployeeMutation()

  async function handleSubmit(data: EmployeeFormData) {
    let avatarUrl: string | null = null

    if (data.avatarFile) {
      avatarUrl = await uploadImage("avatars", "employees", data.avatarFile)
    }

    try {
      await inviteMutation.mutateAsync({
        email: data.email,
        first_name: data.firstName || undefined,
        last_name: data.lastName || undefined,
        role: data.role,
        department_id: data.departmentId || null,
        location: data.location || undefined,
        hire_date: data.startDate
          ? data.startDate.toISOString().split("T")[0]
          : undefined,
        avatar_url: avatarUrl,
      })
    } catch (err) {
      if (avatarUrl) removeImage("avatars", avatarUrl).catch(() => {})
      throw err
    }

    addToast({
      title: "Invitation sent",
      description: `${data.email} will receive a sign-in link.`,
    })
    navigate("/employees")
  }

  return (
    <div className="flex flex-col size-full">
      {/* Header */}
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
          text="Add new employee"
          className="text-foreground font-medium"
        />
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <EmployeeForm
          mode="add"
          title="Add new employee"
          subtitle="Add a team member so you can manage their time off and balances"
          submitLabel="Add employee"
          onSubmit={handleSubmit}
          onCancel={() => navigate("/employees")}
        />
      </div>
    </div>
  )
}

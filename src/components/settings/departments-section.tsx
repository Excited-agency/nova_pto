import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface DepartmentRow {
  id: string
  name: string
  isNew: boolean
}

interface DepartmentsSectionProps {
  departments: DepartmentRow[]
  onAdd: () => void
  onNameChange: (id: string, name: string) => void
  onDelete: (id: string, isNew: boolean) => void
}

export function DepartmentsSection({
  departments,
  onAdd,
  onNameChange,
  onDelete,
}: DepartmentsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold leading-6 text-foreground">Departments</h2>
        <Button variant="outline" size="sm" onClick={onAdd}>
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
                onChange={(e) => onNameChange(dept.id, e.target.value)}
                placeholder="Department name"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(dept.id, dept.isNew)}
              >
                <Trash2 className="size-4 text-error" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

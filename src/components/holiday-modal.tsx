import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { DatePicker } from "@/components/ui/date-picker"
import { useAuth } from "@/hooks/use-auth"
import { useCreateHolidayMutation, useUpdateHolidayMutation } from "@/hooks/use-holidays"
import { addToast } from "@/lib/toast"
import { formatLocalDate } from "@/lib/date-utils"
import type { Holiday } from "@/types/holiday"

interface HolidayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  holiday?: Holiday | null
}

function parseDateString(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number)
  return new Date(year, month - 1, day)
}

export function HolidayModal({ open, onOpenChange, holiday }: HolidayModalProps) {
  const { workspace } = useAuth()
  const createMutation = useCreateHolidayMutation()
  const updateMutation = useUpdateHolidayMutation()

  const isEdit = !!holiday

  const [name, setName] = useState("")
  const [date, setDate] = useState<Date | undefined>(undefined)

  // Pre-fill on edit, reset on close
  useEffect(() => {
    if (open && holiday) {
      setName(holiday.name)
      setDate(parseDateString(holiday.date))
    } else if (!open) {
      setName("")
      setDate(undefined)
    }
  }, [open, holiday])

  const isValid = name.trim().length > 0 && date != null
  const isDirty = isEdit
    ? name.trim() !== holiday!.name || (date != null && formatLocalDate(date) !== holiday!.date)
    : true
  const isPending = createMutation.isPending || updateMutation.isPending

  function handleSubmit() {
    if (!isValid || !workspace) return

    const dateStr = formatLocalDate(date!)

    if (isEdit) {
      updateMutation.mutate(
        { holidayId: holiday!.id, data: { name: name.trim(), date: dateStr } },
        {
          onSuccess: () => {
            addToast({ title: "Holiday updated" })
            onOpenChange(false)
          },
          onError: () => {
            addToast({ variant: "error", title: "Couldn't update holiday", description: "Something went wrong. Try again." })
          },
        }
      )
    } else {
      createMutation.mutate(
        {
          workspace_id: workspace.id,
          name: name.trim(),
          date: dateStr,
          is_custom: true,
        },
        {
          onSuccess: () => {
            addToast({ title: "Holiday created" })
            onOpenChange(false)
          },
          onError: () => {
            addToast({ variant: "error", title: "Couldn't create holiday", description: "Something went wrong. Try again." })
          },
        }
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] gap-5">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit holiday" : "Create holiday"}</DialogTitle>
          <DialogDescription>
            Set a specific date as a holiday for your organization
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field label="Holiday Name">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='e.g., "Company day"'
            />
          </Field>

          <Field label="Date">
            <DatePicker
              value={date}
              onChange={setDate}
              placeholder="Pick a date"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || !isDirty}
            loading={isPending}
          >
            {isEdit ? "Save changes" : "Create holiday"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

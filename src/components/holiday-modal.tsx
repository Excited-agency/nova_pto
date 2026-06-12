import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
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
import { formatLocalDate, parseDateLocal } from "@/lib/date-utils"
import type { Holiday } from "@/types/holiday"

interface HolidayModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  holiday?: Holiday | null
}


const holidaySchema = z.object({
  name: z.string().min(1, "Holiday name is required"),
  date: z.date({ required_error: "Date is required" }),
})

type HolidayFormData = z.infer<typeof holidaySchema>

export function HolidayModal({ open, onOpenChange, holiday }: HolidayModalProps) {
  const { workspace } = useAuth()
  const createMutation = useCreateHolidayMutation()
  const updateMutation = useUpdateHolidayMutation()

  const isEdit = !!holiday

  const { register, handleSubmit, control, reset, formState: { isValid, isDirty } } = useForm<HolidayFormData>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { name: "", date: undefined },
    mode: "onChange",
  })

  // Pre-fill on edit, reset on close
  useEffect(() => {
    if (open && holiday) {
      reset({ name: holiday.name, date: parseDateLocal(holiday.date) })
    } else if (!open) {
      reset({ name: "", date: undefined })
    }
  }, [open, holiday, reset])

  const isPending = createMutation.isPending || updateMutation.isPending

  const onSubmit = handleSubmit((data) => {
    if (!workspace) return

    const dateStr = formatLocalDate(data.date)

    if (isEdit) {
      if (!holiday) return
      updateMutation.mutate(
        { holidayId: holiday.id, data: { name: data.name.trim(), date: dateStr } },
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
          name: data.name.trim(),
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
  })

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
              {...register("name")}
              placeholder='e.g., "Company day"'
            />
          </Field>

          <Field label="Date">
            <Controller
              name="date"
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
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!isValid || (isEdit && !isDirty)}
            loading={isPending}
          >
            {isEdit ? "Save changes" : "Create holiday"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

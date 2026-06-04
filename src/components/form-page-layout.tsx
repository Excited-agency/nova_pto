import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface FormPageLayoutProps {
  children: ReactNode
  className?: string
}

export function FormPageLayout({ children, className }: FormPageLayoutProps) {
  return (
    <div className={cn("flex flex-col items-center pt-6 pb-8 px-4 w-full", className)}>
      <div className="w-full max-w-[600px] flex flex-col gap-6">
        {children}
      </div>
    </div>
  )
}

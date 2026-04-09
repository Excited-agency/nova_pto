import type { ReactNode } from "react"

interface InfoRowProps {
  label: string
  children: ReactNode
}

export function InfoRow({ label, children }: InfoRowProps) {
  return (
    <div className="flex items-start gap-2">
      <span className="flex-1 min-w-0 text-sm font-medium leading-5 tracking-[-0.28px] text-muted-foreground truncate">
        {label}
      </span>
      <div className="flex items-center gap-1.5 text-sm font-medium leading-5 tracking-[-0.28px] text-foreground shrink-0">
        {children}
      </div>
    </div>
  )
}

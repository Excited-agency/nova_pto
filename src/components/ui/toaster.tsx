import { useSyncExternalStore, useState, useEffect } from "react"
import { CheckCircle2, AlertCircle, X } from "lucide-react"
import { subscribe, getSnapshot, removeToast, type Toast  } from "@/lib/toast"

const TOAST_HEIGHT = 88 // px — safe overestimate covering title + description
const GAP = 8 // px gap between toasts when expanded
const MAX_STACKED = 3 // max toasts visible in collapsed stack

interface ToastItemProps {
  toast: Toast
  index: number
  expanded: boolean
}

function ToastItem({ toast, index, expanded }: ToastItemProps) {
  const [leaving, setLeaving] = useState(false)
  const duration = toast.duration ?? 5000

  useEffect(() => {
    const leaveTimer = setTimeout(() => setLeaving(true), duration - 300)
    return () => clearTimeout(leaveTimer)
  }, [duration])

  function dismiss() {
    setLeaving(true)
    setTimeout(() => removeToast(toast.id), 300)
  }

  const style: React.CSSProperties = {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 360,
    zIndex: 50 - index,
    transition: "transform 400ms cubic-bezier(0.32,0.72,0,1), opacity 300ms ease",
    transform: expanded
      ? `translateY(${index * -(TOAST_HEIGHT + GAP)}px) scale(1)`
      : `translateY(${index * -GAP}px) scale(${Math.max(1 - index * 0.04, 0.88)})`,
    opacity: index >= MAX_STACKED ? 0 : 1,
    pointerEvents: index >= MAX_STACKED ? "none" : "auto",
  }

  return (
    <div
      style={style}
      className={
        "rounded-xl border border-border bg-background shadow-md p-4 pr-9 flex gap-3 relative " +
        (leaving
          ? "animate-out fade-out slide-out-to-right-4 duration-200"
          : "animate-in fade-in slide-in-from-right-4 duration-300")
      }
    >
      {toast.variant === "error" ? (
        <AlertCircle className="size-5 shrink-0 mt-0.5 text-error" />
      ) : (
        <CheckCircle2 className="size-5 shrink-0 mt-0.5 text-success" />
      )}
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-foreground">{toast.title}</p>
        {toast.description && (
          <p className="text-sm text-muted-foreground">{toast.description}</p>
        )}
      </div>
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot)
  const [expanded, setExpanded] = useState(false)

  const reversedToasts = [...toasts].reverse() // index 0 = newest (front)

  const collapsedH =
    toasts.length === 0
      ? 0
      : TOAST_HEIGHT + Math.min(toasts.length - 1, MAX_STACKED - 1) * GAP
  const expandedH = toasts.length * (TOAST_HEIGHT + GAP) - GAP

  return (
    <div
      className="fixed bottom-4 right-4 z-50"
      style={{
        height: expanded ? expandedH : collapsedH,
        width: 360,
        transition: "height 400ms cubic-bezier(0.32,0.72,0,1)",
      }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {reversedToasts.map((t, index) => (
        <ToastItem key={t.id} toast={t} index={index} expanded={expanded} />
      ))}
    </div>
  )
}

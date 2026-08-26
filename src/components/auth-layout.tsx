import type { ReactNode } from "react"

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid md:grid-cols-2 h-screen w-screen overflow-hidden bg-background">

      {/* Left column */}
      <div className="flex flex-col h-full items-start justify-center p-8">
        <div className="flex flex-1 w-full items-start justify-center pt-40">
          <div className="flex w-[320px] flex-col items-center gap-10">
            {children}
          </div>
        </div>
      </div>

      {/* Right column — hidden on mobile */}
      <div className="relative hidden md:flex h-full overflow-hidden">

        {/* Background: solid + gradient/noise overlay */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[#f4f4f5]" />
          {/* JPEG, not PNG: the source was a 4096x2731 PNG whose alpha
              channel was entirely opaque, so 3.9 MB bought nothing. */}
          <img
            alt=""
            width={1600}
            height={1067}
            className="absolute inset-0 size-full object-cover"
            src="/assets/auth-right-bg.jpg"
          />
        </div>

        {/* Dashboard mockup — natural size, vertically centered, left-anchored, bleeds right */}
        <img
          alt="Nova PTO app preview"
          src="/assets/app-preview.png"
          className="absolute top-1/2 -translate-y-1/2 left-24 max-h-none w-auto"
        />

      </div>

    </div>
  )
}

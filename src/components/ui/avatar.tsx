import * as React from "react"
import { Avatar as AvatarPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden",
  {
    variants: {
      size: {
        "2xs": "size-5",
        xs: "size-6",
        sm: "size-8",
        md: "size-10",
        lg: "size-12",
        xl: "size-14",
        "2xl": "size-16",
        "3xl": "size-20",
        "4xl": "size-24",
        "5xl": "size-28",
        "6xl": "size-32",
      },
      shape: {
        circle: "rounded-full",
        square: "",
      },
    },
    compoundVariants: [
      { shape: "square", size: "2xs", className: "rounded-sm" },
      { shape: "square", size: ["xs", "sm"], className: "rounded-md" },
      {
        shape: "square",
        size: ["md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl"],
        className: "rounded-lg",
      },
    ],
    defaultVariants: {
      size: "md",
      shape: "circle",
    },
  }
)

interface AvatarProps
  extends Omit<
      React.ComponentProps<typeof AvatarPrimitive.Root>,
      "children"
    >,
    VariantProps<typeof avatarVariants> {
  src?: string
  alt?: string
  fallback?: React.ReactNode
}

const fallbackTextClasses: Record<NonNullable<AvatarProps["size"]>, string> = {
  "2xs": "text-xs leading-4 tracking-[-0.24px]",
  xs: "text-sm leading-5 tracking-[-0.28px]",
  sm: "text-sm leading-5 tracking-[-0.28px]",
  md: "text-sm leading-5 tracking-[-0.28px]",
  lg: "text-sm leading-5 tracking-[-0.28px]",
  xl: "text-sm leading-5 tracking-[-0.28px]",
  "2xl": "text-sm leading-5 tracking-[-0.28px]",
  "3xl": "text-base leading-6 tracking-[-0.32px]",
  "4xl": "text-lg leading-8 tracking-[-0.36px]",
  "5xl": "text-xl leading-8 tracking-[-0.4px]",
  "6xl": "text-xl leading-8 tracking-[-0.4px]",
}

function Avatar({
  className,
  src,
  alt,
  fallback,
  size = "md",
  shape = "circle",
  ...props
}: AvatarProps) {
  const [imgError, setImgError] = React.useState(false)
  const showImage = !!src && !imgError

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      data-shape={shape}
      className={cn(avatarVariants({ size, shape }), className)}
      {...props}
    >
      {showImage && (
        <AvatarPrimitive.Image
          src={src}
          alt={alt ?? ""}
          className="size-full object-cover"
          loading="lazy"
          onLoadingStatusChange={(status) => {
            if (status === "error") setImgError(true)
          }}
        />
      )}
      {!showImage && (
        <span
          className={cn(
            "flex size-full items-center justify-center bg-(--input) font-normal text-foreground",
            fallbackTextClasses[size ?? "md"]
          )}
        >
          {fallback}
        </span>
      )}
    </AvatarPrimitive.Root>
  )
}

export { Avatar, avatarVariants }
export type { AvatarProps }

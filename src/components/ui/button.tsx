import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// One set of buttons for the whole owner app (Obsidian & Ivory):
// default = the main action of a section (ink; ivory when the phone is dark), gold = the main action on a dark card,
// outline = a second action, secondary = a quiet filled action, ghost = a low-key action,
// destructive = stops or removes something, link = an inline text action.
// Colours are the --owner-* variables in src/app/globals.css, which carry both appearances.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#b8893b] aria-invalid:border-(--owner-danger)",
  {
    variants: {
      variant: {
        default:
          "bg-(--owner-btn) text-(--owner-btn-text) shadow-[0_10px_24px_-14px_rgba(10,10,10,0.7)] hover:bg-(--owner-btn-hover) hover:shadow-[0_12px_28px_-14px_rgba(184,137,59,0.55)]",
        gold:
          "bg-[#f7e9c8] text-[#0a0a0a] shadow-[0_8px_24px_-10px_rgba(227,192,122,0.6)] hover:bg-[#fbf1da]",
        destructive:
          "bg-(--owner-btn-danger) text-white shadow-[0_10px_24px_-14px_rgba(161,35,27,0.7)] hover:bg-(--owner-btn-danger-hover)",
        outline:
          "border border-(--owner-btn-line) bg-(--owner-white) text-(--owner-ink) hover:border-(--owner-line-hover) hover:bg-(--owner-hover)",
        secondary:
          "bg-(--owner-btn-quiet) text-(--owner-ink) hover:bg-(--owner-btn-quiet-hover)",
        ghost:
          "text-(--owner-text) hover:bg-(--owner-btn-quiet) hover:text-(--owner-ink)",
        link: "text-(--owner-gold-deep) underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-10 px-4",
        xs: "h-8 gap-1.5 rounded-lg px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-9 gap-1.5 px-3",
        lg: "h-12 px-5 text-base [&_svg:not([class*='size-'])]:size-5",
        icon: "size-10",
        "icon-xs": "size-8 rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-9",
        "icon-lg": "size-12",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0 py-0" }],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

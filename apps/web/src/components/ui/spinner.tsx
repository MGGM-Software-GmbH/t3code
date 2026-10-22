import { LoaderCircleIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { observeVisibleAnimation } from "~/lib/visibleAnimation";
import { cn } from "~/lib/utils";

// No default size: inside a Button the parent's svg rule sizes the glyph.
const spinnerVariants = cva("", {
  variants: {
    motion: {
      auto: "motion-safe:visible-animate-spin",
      progress: "visible-animate-spin [animation-timing-function:steps(8)]",
    },
    size: {
      xs: "size-3",
      sm: "size-3.5",
      md: "size-4",
      lg: "size-5",
    },
    tone: {
      current: "",
      muted: "text-muted-foreground",
    },
  },
  defaultVariants: { tone: "current", motion: "auto" },
});

/** Keep explicit progress legible with reduced motion at a limited frame rate. */
function observeProgressAnimation(element: HTMLElement | SVGElement | null) {
  return observeVisibleAnimation(element, { allowReducedMotion: true });
}

function Spinner({
  className,
  size,
  tone,
  motion,
  ...props
}: React.ComponentPropsWithoutRef<typeof LoaderCircleIcon> & VariantProps<typeof spinnerVariants>) {
  return (
    <LoaderCircleIcon
      aria-label="Loading"
      ref={motion === "progress" ? observeProgressAnimation : observeVisibleAnimation}
      className={cn(spinnerVariants({ size, tone, motion }), className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };

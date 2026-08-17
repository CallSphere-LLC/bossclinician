import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

interface ContainerProps extends Omit<ComponentPropsWithoutRef<"div">, "className" | "children"> {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

/**
 * Page gutter.
 *
 * Forwards the remaining props to the rendered element. It used to accept only
 * `as`/`className`/`children` and drop everything else, which silently swallowed
 * the `aria-label` on `<Container as="nav" aria-label="Mobile">` — the mobile
 * navigation shipped as an unnamed landmark, and querying for it by name found
 * nothing.
 */
export function Container({ as: Tag = "div", className, children, ...rest }: ContainerProps) {
  return (
    <Tag className={cn("mx-auto w-full max-w-8xl px-5 sm:px-8 lg:px-12", className)} {...rest}>
      {children}
    </Tag>
  );
}

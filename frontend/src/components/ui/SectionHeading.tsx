import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useEntranceMotion } from "@/hooks/useEntranceMotion";
import { cn } from "@/lib/cn";

interface SectionHeadingProps {
  eyebrow?: string;
  title: ReactNode;
  body?: ReactNode;
  align?: "left" | "center";
  className?: string;
  titleClassName?: string;
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  align = "center",
  className,
  titleClassName,
}: SectionHeadingProps) {
  const reduce = useEntranceMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "max-w-3xl",
        align === "center" ? "mx-auto text-center" : "text-left",
        className,
      )}
    >
      {eyebrow && <span className="eyebrow-luxe block">{eyebrow}</span>}
      <h2
        className={cn(
          "text-balance font-display text-[2rem] font-medium leading-[1.14] text-white sm:text-[2.6rem] lg:text-[3.1rem]",
          titleClassName,
        )}
      >
        {title}
      </h2>
      {body && <p className="copy-luxe mt-6 text-balance">{body}</p>}
    </motion.div>
  );
}

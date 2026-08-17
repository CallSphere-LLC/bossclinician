import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";

interface SubscribeFormProps {
  source: string;
  dark?: boolean;
  placeholder?: string;
  /** Fired once the address is stored — the funnel page counts it as a conversion. */
  onSuccess?: () => void;
}

export function SubscribeForm({
  source,
  dark,
  placeholder = "Your email address",
  onSuccess,
}: SubscribeFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");
    try {
      await api.subscribe(email.trim(), source);
      setStatus("success");
      setEmail("");
      onSuccess?.();
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <motion.p
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
        className={cn("text-sm font-medium", dark ? "text-gold" : "text-plum-deep")}
      >
        You're in! Check your inbox for the masterclass link.
      </motion.p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-2 sm:flex-row">
      <label htmlFor={`subscribe-${source}`} className="sr-only">
        Email address
      </label>
      <input
        id={`subscribe-${source}`}
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "min-h-[44px] w-full rounded-full border px-5 py-3 text-sm outline-none transition-colors duration-300",
          dark
            ? "border-white/12 bg-white/[0.05] text-white placeholder:text-white/30 focus-visible:border-gold/60 focus-visible:bg-white/[0.08]"
            : "border-lilac bg-white text-ink placeholder:text-ink-soft/60 focus-visible:border-plum",
        )}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        className={cn(
          // min-h-[44px]: the button measured 41px, just under the comfortable
          // touch minimum.
          "min-h-[44px] shrink-0 rounded-full px-6 py-3 text-[0.72rem] font-bold uppercase tracking-[0.16em] transition-all duration-300 disabled:opacity-60",
          dark
            ? "sheen-host bg-gold-foil text-night-deep hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-14px_rgba(201,164,106,0.8)]"
            : "bg-brand-gradient text-sm font-semibold normal-case tracking-normal text-white hover:opacity-90",
        )}
      >
        {status === "loading" ? "Sending…" : "Get Access"}
      </button>
      {status === "error" && (
        <p role="alert" className="w-full text-xs text-red-400 sm:absolute sm:mt-9">
          Something went wrong. Please try again.
        </p>
      )}
    </form>
  );
}

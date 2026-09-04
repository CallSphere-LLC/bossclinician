import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollText } from "lucide-react";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { communityApi } from "@/lib/communityApi";
import { MemberApiError } from "@/lib/memberApi";

/**
 * The guidelines a member has to accept before they can write.
 *
 * A panel over the page rather than a redirect, and reading is left working
 * underneath: somebody deciding whether to accept the rules of a room needs to
 * see the room. A blank screen behind a consent modal is how people bounce off
 * a community they have paid for.
 *
 * Markdown, because Yvette's real guidelines use headings, emoji and an email
 * address — the same renderer the rest of the member app uses for lesson bodies.
 */
export function GuidelinesGate({
  slug,
  text,
  onAccepted,
}: {
  slug: string;
  text: string;
  onAccepted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const accept = async () => {
    setSaving(true);
    setError("");
    try {
      await communityApi.acceptGuidelines(slug);
      onAccepted();
    } catch (err) {
      setError(
        err instanceof MemberApiError
          ? err.message
          : "We couldn't record that just now. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="guidelines-title"
      className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-night-deep">
        <div className="flex items-start gap-3 border-b border-white/10 px-6 py-5">
          <ScrollText aria-hidden className="mt-0.5 size-5 shrink-0 text-gold" />
          <div>
            <h2 id="guidelines-title" className="font-display text-xl text-white">
              Before you join in
            </h2>
            <p className="copy-luxe mt-1 text-sm">
              Please read the house rules. You can keep browsing without
              accepting — this is only needed before you post or comment.
            </p>
          </div>
        </div>

        <div className="prose-boss min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>

        <div className="border-t border-white/10 px-6 py-4">
          {error && <p className="mb-3 text-sm text-red-300">{error}</p>}
          <LuxeButton
            variant="foil"
            size="md"
            className="min-h-[44px] w-full sm:w-auto"
            disabled={saving}
            onClick={() => void accept()}
          >
            {saving ? "Saving…" : "I accept"}
          </LuxeButton>
        </div>
      </div>
    </div>
  );
}

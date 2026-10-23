import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";
import { adminContractsApi } from "@/lib/contractsApi";
import { Button, Card, CardHeader, EmptyState, ErrorNotice, Skeleton } from "@/pages/admin/ui/primitives";

/**
 * The offer's Contract tab (QA row 164): pick the participant contracts a buyer
 * is asked to sign. When someone buys the offer — by card, PayPal, a free
 * enrolment or a 100%-off coupon — each ticked contract is assigned to them
 * automatically (the gift recipient on a gift), they get an in-app notice and
 * an email, and it appears on their Contracts page ready to sign. Their access
 * to what they bought is not held back while it waits for a signature.
 *
 * Saved by its own button, like the Notifications tab: it is its own endpoint
 * (/admin/contracts/offers/:id), not part of the offer's Save.
 */
export default function OfferContractsTab({ offerId }: { offerId: number }) {
  const [contracts, setContracts] = useState<Array<{ id: number; title: string }> | null>(null);
  const [saved, setSaved] = useState<number[]>([]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    adminContractsApi
      .forOffer(offerId)
      .then((data) => {
        if (!live) return;
        const ids = data.linked.map((contract) => contract.id);
        setContracts(data.contracts);
        setSaved(ids);
        setChosen(ids);
        setError("");
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load contracts.");
      });
    return () => {
      live = false;
    };
  }, [offerId]);

  const dirty = chosen.length !== saved.length || chosen.some((id) => !saved.includes(id));

  function toggle(id: number, on: boolean) {
    setChosen((current) => (on ? [...current.filter((x) => x !== id), id] : current.filter((x) => x !== id)));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await adminContractsApi.setForOffer(offerId, chosen);
      const ids = result.linked.map((contract) => contract.id);
      setSaved(ids);
      setChosen(ids);
      toast.success(ids.length ? "Buyers will be asked to sign the contracts you ticked" : "No contract is attached to this offer now");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<FileSignature className="size-4" />}
        title="Contract to sign"
        subtitle="Assigned automatically to everyone who buys this offer"
        action={
          contracts && contracts.length > 0 ? (
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
              {saving ? "Saving…" : dirty ? "Save contracts" : "Saved"}
            </Button>
          ) : undefined
        }
      />
      <div className="space-y-4 p-5">
        {error && <ErrorNotice message={error} />}
        {!error && contracts === null && <Skeleton className="h-24 w-full" />}
        {contracts && contracts.length === 0 && (
          <EmptyState
            icon={<FileSignature />}
            title="No contracts yet"
            description="Upload your contract PDF in Products → Contracts first, then come back and tick it here."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/admin/contracts">Open Contracts</Link>
              </Button>
            }
          />
        )}
        {contracts && contracts.length > 0 && (
          <>
            <div className="space-y-2.5">
              {contracts.map((contract) => (
                <label
                  key={contract.id}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/20"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(contract.id)}
                    onChange={(e) => toggle(contract.id, e.target.checked)}
                    className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink">{contract.title}</span>
                    <a
                      className="mt-0.5 inline-block text-xs text-plum underline"
                      href={adminContractsApi.fileUrl(contract.id)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      View PDF
                    </a>
                  </span>
                </label>
              ))}
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
              <li>Works for card, PayPal, free and 100%-off coupon purchases. On a gift, the recipient signs.</li>
              <li>The buyer gets a notice in their account and an email, and the contract waits on their Contracts page.</li>
              <li>Someone who already has this contract (signed or not) is not asked again.</li>
              <li>Their access to what they bought starts straight away; it is not held until they sign.</li>
              <li>Ticking a contract here does not reach people who bought before — assign those from Products → Contracts.</li>
            </ul>
            <p className="text-sm text-ink-soft">
              Track who has signed in{" "}
              <Link className="text-plum underline" to="/admin/contracts">
                Products → Contracts
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ExternalLink, Link2, Package, Plus, Tag, Unlink } from "lucide-react";
import { toast } from "sonner";
import { adminCommerceApi, commerceMessage, type Offer } from "@/lib/adminCommerceApi";
import type { Course } from "@/types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  Skeleton,
  selectStyles,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { pluralize, slugify, uniqueKey } from "@/pages/admin/ui/friendly";
import { courseHubApi, type CourseOffer, type CourseProduct } from "./courseHubApi";
import { newCourseOfferInput, offerPriceLabel, priceCentsFromInput } from "./courseHub";

/**
 * Kajabi's course "Offers" tab: every offer that hands this course over, and
 * the two ways to add one — connect an offer she already has, or start a new
 * one for this course. Offers are still edited in the offer editor; this is the
 * view of them from the course's side, which nothing showed before.
 */
export function CourseOffersTab({ courseId, course }: { courseId: number; course: Course | null }) {
  const navigate = useNavigate();
  const [data, setData] = useState<{ products: CourseProduct[]; offers: CourseOffer[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allOffers, setAllOffers] = useState<Offer[] | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectId, setConnectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    courseHubApi
      .offers(courseId)
      .then((next) => {
        setData(next);
        setError(null);
      })
      .catch(() => setError("We couldn't load the offers for this course. Try refreshing the page."));
  }, [courseId]);

  useEffect(load, [load]);

  const linkedIds = useMemo(() => new Set((data?.offers ?? []).map((offer) => offer.id)), [data]);
  const connectable = (allOffers ?? []).filter(
    (offer) => offer.status !== "archived" && !linkedIds.has(offer.id),
  );

  function startConnect() {
    setConnectId("");
    setConnecting(true);
    adminCommerceApi
      .offerList()
      .then(setAllOffers)
      .catch(() => setAllOffers([]));
  }

  function startCreate() {
    setNewTitle(course?.title ?? "");
    setNewPrice(course?.priceCents ? (course.priceCents / 100).toFixed(2).replace(/\.00$/, "") : "");
    setPriceError(null);
    setCreating(true);
  }

  /** Attaching needs a product to attach; a course made before row 160 may have none yet. */
  async function productId(): Promise<number> {
    const own = data?.products.find((product) => product.kind === "course") ?? data?.products[0];
    if (own) return own.id;
    const ensured = await courseHubApi.ensureProduct(courseId);
    return ensured.id;
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    const offer = connectable.find((candidate) => String(candidate.id) === connectId);
    if (!offer || busy) return;
    setBusy(true);
    try {
      const product = await productId();
      await adminCommerceApi.offerProductAdd(offer.id, product, offer.products.length);
      toast.success(`“${offer.title}” now includes this course`);
      setConnecting(false);
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setBusy(false);
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || busy) return;
    const cents = priceCentsFromInput(newPrice);
    if (cents === undefined) {
      setPriceError("Type a number, like 497 — or leave it blank for a free offer.");
      return;
    }
    setBusy(true);
    try {
      const product = await productId();
      // Generated from the name, unique against every offer's address, the same
      // way the offer editor names a new offer.
      const taken = (await adminCommerceApi.offerList()).map((offer) => offer.slug);
      const slug = uniqueKey(slugify(title) || "offer", taken, "-");
      const created = await adminCommerceApi.offerCreate(
        newCourseOfferInput(title, slug, cents, course?.currency || "usd"),
      );
      try {
        await adminCommerceApi.offerProductAdd(created.id, product, 0);
      } catch (err) {
        // The offer is saved by now; sending her back to this form would make a
        // second one. Say what went wrong and take her to the offer to finish.
        toast.error(commerceMessage(err, "offer"));
      }
      toast.success("Offer saved as a draft. Set the checkout details, then put it live.");
      setCreating(false);
      navigate(`/admin/offers/${created.id}`);
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(offer: CourseOffer) {
    const ok = await confirm({
      title: `Take this course out of “${offer.title}”?`,
      description:
        "New buyers of that offer won't get this course. Anyone who already has it keeps it.",
      confirmLabel: "Yes, take it out",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.offerProductRemove(offer.id, offer.productId);
      toast.success("Course taken out of the offer");
      load();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    }
  }

  const offers = data?.offers ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">
          An offer is how people get this course — what they pay, and the checkout they see. Anyone who
          buys one of these is given the course straight away.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={startConnect}>
            <Link2 />
            Connect an existing offer
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus />
            Create an offer
          </Button>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {data === null && !error ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : offers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tag />}
            title="Nothing sells this course yet"
            description="Connect an offer you already have, or create one for this course. Until then nobody can buy it or be given it."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" size="sm" onClick={startConnect}>
                  <Link2 />
                  Connect an existing offer
                </Button>
                <Button size="sm" onClick={startCreate}>
                  <Plus />
                  Create an offer
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-hairline/60">
            {offers.map((offer) => (
              <li key={offer.id} className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-lilac-tint text-plum-deep">
                  {offer.viaBundle ? <Package className="size-4" /> : <Tag className="size-4" />}
                </span>
                <div className="min-w-0 flex-1 basis-[calc(100%-3rem)] sm:basis-auto">
                  <Link
                    to={`/admin/offers/${offer.id}`}
                    className="block truncate text-sm font-semibold text-ink hover:text-plum hover:underline"
                  >
                    {offer.internalTitle || offer.title}
                  </Link>
                  <p className="text-xs text-ink-soft">
                    <span className="font-bold tabular-nums text-ink">{offerPriceLabel(offer)}</span>
                    {" · "}
                    <span className="font-bold tabular-nums">{offer.purchaseCount}</span>{" "}
                    {offer.purchaseCount === 1 ? "sale" : "sales"}
                    {offer.viaBundle ? ` · inside the bundle “${offer.viaBundle}”` : ""}
                  </p>
                </div>
                <Badge tone={offer.status === "published" ? "green" : offer.status === "archived" ? "neutral" : "slate"}>
                  {offer.status === "published" ? "Live" : offer.status === "archived" ? "Archived" : "Draft"}
                </Badge>
                <Button asChild variant="secondary" size="sm">
                  <Link to={`/admin/offers/${offer.id}`}>
                    <ExternalLink />
                    <span className="hidden sm:inline">Edit offer</span>
                  </Link>
                </Button>
                {!offer.viaBundle && (
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label={`Take this course out of ${offer.title}`}
                    title="Take this course out of the offer"
                    onClick={() => void disconnect(offer)}
                  >
                    <Unlink />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data && data.products.length > 1 && (
        <p className="text-xs text-ink-soft">
          This course is granted by {pluralize(data.products.length, "product")}:{" "}
          {data.products.map((product) => product.title).join(", ")}.
        </p>
      )}

      <Modal
        open={connecting}
        onOpenChange={setConnecting}
        title="Connect an existing offer"
        description="The offer keeps its price and checkout; this course is added to what buyers get."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConnecting(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="connect-offer" disabled={!connectId || busy}>
              {busy ? "Connecting…" : "Connect offer"}
            </Button>
          </>
        }
      >
        <form id="connect-offer" onSubmit={connect}>
          <Field label="Offer">
            {allOffers === null ? (
              <Skeleton className="h-11 w-full" />
            ) : connectable.length === 0 ? (
              <p className="rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-soft">
                Every offer you have already includes this course. Create a new one instead.
              </p>
            ) : (
              <select
                className={selectStyles}
                value={connectId}
                onChange={(e) => setConnectId(e.target.value)}
                aria-label="Offer to connect"
                autoFocus
              >
                <option value="">Choose an offer…</option>
                {connectable.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.internalTitle || offer.title} — {offerPriceLabel(offer)}
                    {offer.status === "draft" ? " (draft)" : ""}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </form>
      </Modal>

      <Modal
        open={creating}
        onOpenChange={setCreating}
        title="Create an offer for this course"
        description="It's saved as a draft with this course in it. You'll set up the checkout next, then put it live."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="create-offer" disabled={busy}>
              {busy ? "Creating…" : "Create offer"}
            </Button>
          </>
        }
      >
        <form id="create-offer" onSubmit={create} className="space-y-4">
          <Field label="Offer name" hint="what buyers see at checkout">
            <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required autoFocus />
          </Field>
          <Field label="Price" hint="leave blank for a free offer" error={priceError ?? undefined}>
            <Input
              inputMode="decimal"
              className="tabular-nums"
              value={newPrice}
              onChange={(e) => {
                setNewPrice(e.target.value);
                if (priceError) setPriceError(null);
              }}
              placeholder="497"
            />
          </Field>
          <p className="text-xs text-ink-soft">
            Payment plans, subscriptions and more payment options are set in the offer editor.
          </p>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  );
}


import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BadgeDollarSign,
  ClipboardList,
  Eye,
  EyeOff,
  Flag,
  Gift,
  Image as ImageIcon,
  Link2,
  Mail,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  adminCommerceApi,
  centsToDollars,
  commerceMessage,
  dollarsToCents,
  everyPhrase,
  fieldErrorsOf,
  money,
  OFFER_STATUS_LABEL,
  PRICING_CHOICES,
  PRODUCT_KIND,
  pricePreview,
  priceSummary,
  type BillingInterval,
  type CustomFieldType,
  type Offer,
  type OfferBump,
  type OfferCustomField,
  type OfferDetail,
  type OfferInput,
  type OfferPricingOption,
  type OfferUpsell,
  type PricingType,
  type Product,
} from "@/lib/adminCommerceApi";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  selectStyles,
  Skeleton,
  Textarea,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { PicturePickerModal } from "@/pages/admin/CrudManager";
import {
  fieldKey,
  pluralize,
  shareLink,
  slugify,
  uniqueKey,
  webAddress,
} from "@/pages/admin/ui/friendly";

/**
 * The offer editor — one screen, six questions, in the order she'd ask them:
 * what am I selling, what does it cost, what do I need from the buyer, what
 * else can I put in front of them, and where do they land afterwards.
 *
 * The offer's own details are saved by the Save button. Everything attached to
 * it — the products it grants, its bumps, its upsells — is saved the moment she
 * changes it, because each is its own record with its own rules, and holding a
 * dozen of them hostage to one button is how half of them get lost.
 */

/* ── Shape of the working copy ──────────────────────────────────────────── */

/**
 * The web address and the live/draft state are deliberately not editable here:
 * the address is generated once so shared checkout links keep working, and
 * going live is a decision with its own button and its own safety checks.
 */
type OfferDraft = Omit<OfferInput, "slug" | "status">;

function blankDraft(): OfferDraft {
  return {
    title: "",
    description: "",
    checkoutHeadline: "",
    thumbnailUrl: "",
    pricingType: "one_time",
    amountCents: 0,
    minAmountCents: 0,
    interval: null,
    intervalCount: 1,
    installmentCount: null,
    trialDays: 0,
    collectTax: false,
    collectAddress: false,
    collectPhone: false,
    customFields: [],
    termsUrl: "",
    requireTerms: false,
    redirectUrl: "",
    thankYouPageId: null,
    accessExpiresAfterDays: null,
    sendWelcomeEmail: true,
    allowGifting: true,
    welcomeNextSteps: "",
  };
}

function draftFrom(offer: OfferDetail): OfferDraft {
  return {
    title: offer.title,
    description: offer.description,
    checkoutHeadline: offer.checkoutHeadline,
    thumbnailUrl: offer.thumbnailUrl,
    pricingType: offer.pricingType,
    amountCents: offer.amountCents,
    minAmountCents: offer.minAmountCents,
    interval: offer.interval,
    intervalCount: offer.intervalCount,
    installmentCount: offer.installmentCount,
    trialDays: offer.trialDays,
    collectTax: offer.collectTax,
    collectAddress: offer.collectAddress,
    collectPhone: offer.collectPhone,
    customFields: offer.customFields,
    termsUrl: offer.termsUrl,
    requireTerms: offer.requireTerms,
    redirectUrl: offer.redirectUrl,
    thankYouPageId: offer.thankYouPageId,
    accessExpiresAfterDays: offer.accessExpiresAfterDays,
    sendWelcomeEmail: offer.sendWelcomeEmail,
    allowGifting: offer.allowGifting !== false,
    welcomeNextSteps: offer.welcomeNextSteps,
  };
}

/** Client-side refusal for price mistakes the API will reject as well. */
export function offerPricingErrors(
  draft: Pick<OfferDraft, "pricingType" | "amountCents" | "minAmountCents" | "installmentCount">,
): Record<string, string> {
  if (["one_time", "subscription", "payment_plan"].includes(draft.pricingType)) {
    if (!Number.isFinite(draft.amountCents) || draft.amountCents <= 0) {
      return { amountCents: "Enter a price greater than $0 before saving this offer." };
    }
  }
  if (draft.pricingType === "payment_plan" && (draft.installmentCount ?? 0) < 2) {
    return { installmentCount: "Choose at least two payments." };
  }
  if (draft.pricingType === "pwyw" && draft.minAmountCents < 0) {
    return { minAmountCents: "The minimum price cannot be below $0." };
  }
  return {};
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

type TabKey = "selling" | "price" | "form" | "bumps" | "upsells" | "gifting" | "after";

const TABS: { value: TabKey; label: string; icon: LucideIcon }[] = [
  { value: "selling", label: "What you're selling", icon: Package },
  { value: "price", label: "Price", icon: BadgeDollarSign },
  { value: "form", label: "Order form", icon: ClipboardList },
  { value: "bumps", label: "Order bumps", icon: ShoppingBag },
  { value: "upsells", label: "Upsells", icon: Sparkles },
  { value: "gifting", label: "Send as a gift", icon: Gift },
  { value: "after", label: "After purchase", icon: Flag },
];

/**
 * Which tab a rejected field lives on, so a refused save can put her in front
 * of the box she has to fix instead of leaving her to hunt for it.
 */
const FIELD_TAB: Record<string, TabKey> = {
  allowGifting: "gifting",
  title: "selling",
  slug: "selling",
  description: "selling",
  checkoutHeadline: "selling",
  thumbnailUrl: "selling",
  pricingType: "price",
  amountCents: "price",
  minAmountCents: "price",
  interval: "price",
  intervalCount: "price",
  installmentCount: "price",
  trialDays: "price",
  collectTax: "form",
  collectAddress: "form",
  collectPhone: "form",
  customFields: "form",
  termsUrl: "form",
  requireTerms: "form",
  redirectUrl: "after",
  thankYouPageId: "after",
  accessExpiresAfterDays: "after",
  welcomeNextSteps: "after",
  sendWelcomeEmail: "after",
};

/* ── Small shared controls ──────────────────────────────────────────────── */

/** Matches the Input primitive so a row of controls reads as one set. */
/** A price box that shows a "$" and takes dollars. The caller owns the text. */
function MoneyInput({
  value,
  onChange,
  placeholder = "497",
  autoFocus,
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-ink-soft"
      >
        $
      </span>
      <Input
        className="pl-8"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/20">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      </span>
    </label>
  );
}

/** The amber note used wherever something is set up in a way that loses money. */
function Caution({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gold/40 bg-gold/[0.09] px-4 py-3 text-sm text-ink">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** Shown on the tabs that need a saved offer before they can hold anything. */
function SaveFirst({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState
        icon={<Sparkles />}
        title="Save this offer first"
        description={`Give it a name and a price, press Save, and you can add ${what} here.`}
      />
    </Card>
  );
}

/* ── Billing cadence ────────────────────────────────────────────────────── */

const CADENCES: { value: string; label: string; interval: BillingInterval; count: number }[] = [
  { value: "week:1", label: "Every week", interval: "week", count: 1 },
  { value: "week:2", label: "Every 2 weeks", interval: "week", count: 2 },
  { value: "month:1", label: "Every month", interval: "month", count: 1 },
  { value: "month:2", label: "Every 2 months", interval: "month", count: 2 },
  { value: "month:3", label: "Every 3 months", interval: "month", count: 3 },
  { value: "month:6", label: "Every 6 months", interval: "month", count: 6 },
  { value: "year:1", label: "Every year", interval: "year", count: 1 },
];

function CadenceSelect({
  interval,
  count,
  onChange,
  label,
  hint,
}: {
  interval: BillingInterval | null;
  count: number;
  onChange: (interval: BillingInterval, count: number) => void;
  label: string;
  hint?: string;
}) {
  const current = interval ? `${interval}:${count}` : "month:1";
  // An offer set up before this list existed keeps its own wording rather than
  // silently snapping to the nearest option in the dropdown.
  const options = CADENCES.some((c) => c.value === current)
    ? CADENCES
    : [
        ...CADENCES,
        {
          value: current,
          label: interval ? `Every ${everyPhrase(interval, count).replace(/^a /, "")}` : "Every month",
          interval: interval ?? "month",
          count,
        },
      ];

  return (
    <Field label={label} hint={hint}>
      <select
        value={current}
        onChange={(e) => {
          const chosen = options.find((option) => option.value === e.target.value);
          if (chosen) onChange(chosen.interval, chosen.count);
        }}
        aria-label={label}
        className={selectStyles}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/* ── Screen ─────────────────────────────────────────────────────────────── */

export default function OfferEditor() {
  const params = useParams();
  const navigate = useNavigate();
  const offerId = params.id && params.id !== "new" ? Number(params.id) : null;

  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [draft, setDraft] = useState<OfferDraft | null>(null);
  const [amountInput, setAmountInput] = useState("");
  const [minInput, setMinInput] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabKey>("selling");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const [catalogue, setCatalogue] = useState<Product[]>([]);
  const [allOffers, setAllOffers] = useState<Offer[]>([]);
  const [pages, setPages] = useState<{ slug: string; title: string }[]>([]);

  /* What this offer grants. Held locally until the offer exists, because a
     product can only be attached to something that has been saved. */
  const [pendingProducts, setPendingProducts] = useState<number[]>([]);

  const [confirm, confirmDialog] = useConfirm();

  // The working copy is filled from the server once. A refresh after attaching
  // a product must not throw away a title she is halfway through typing.
  const filled = useRef(false);

  const refresh = useCallback(async () => {
    if (offerId === null) return;
    try {
      const detail = await adminCommerceApi.offerGet(offerId);
      setOffer(detail);
      if (!filled.current) {
        filled.current = true;
        setDraft(draftFrom(detail));
        setAmountInput(centsToDollars(detail.amountCents));
        setMinInput(centsToDollars(detail.minAmountCents));
      }
      setLoadError(null);
    } catch {
      setLoadError("We couldn't open that offer. It may have been deleted.");
    }
  }, [offerId]);

  useEffect(() => {
    if (offerId === null) {
      filled.current = true;
      setDraft(blankDraft());
    } else {
      void refresh();
    }
  }, [offerId, refresh]);

  useEffect(() => {
    adminCommerceApi
      .productList()
      .then((list) => setCatalogue(list.filter((product) => product.status !== "archived")))
      .catch(() => setCatalogue([]));
    adminCommerceApi
      .offerList()
      .then(setAllOffers)
      .catch(() => setAllOffers([]));
    adminApi
      .pagesList()
      .then((list) => setPages(list.map((page) => ({ slug: page.slug, title: page.title }))))
      .catch(() => setPages([]));
  }, []);

  const update = useCallback((patch: Partial<OfferDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    // A correction stops applying the moment she acts on it; leaving it under a
    // box she has already fixed reads as a second, different complaint.
    setErrors((current) => {
      const next = { ...current };
      for (const field of Object.keys(patch)) delete next[field];
      return next;
    });
  }, []);

  /**
   * Switching how she charges clears the fields the new choice doesn't use.
   * A stale interval left on a one-time offer is what turns a $3,500 course
   * into a $3,500 monthly subscription the first time somebody buys it.
   */
  function choosePricing(pricingType: PricingType) {
    if (!draft || pricingType === draft.pricingType) return;
    const base: Partial<OfferDraft> = {
      pricingType,
      interval: null,
      intervalCount: 1,
      installmentCount: null,
      trialDays: 0,
    };

    if (pricingType === "free") {
      setAmountInput("");
      setMinInput("");
      update({ ...base, amountCents: 0, minAmountCents: 0 });
      return;
    }
    if (pricingType === "pwyw") {
      setAmountInput("");
      update({ ...base, amountCents: 0 });
      return;
    }

    setMinInput("");
    if (pricingType === "subscription") {
      update({ ...base, interval: "month", minAmountCents: 0 });
      return;
    }
    if (pricingType === "payment_plan") {
      update({ ...base, interval: "month", installmentCount: 3, minAmountCents: 0 });
      return;
    }
    update({ ...base, minAmountCents: 0 });
  }

  /** Puts her in front of the box the server refused, with its own wording. */
  function showRefusal(err: unknown, context: string) {
    const fieldErrors = fieldErrorsOf(err);
    setErrors(fieldErrors);
    const firstField = Object.keys(fieldErrors)[0];
    const goTo = firstField ? FIELD_TAB[firstField] : undefined;
    if (goTo) setTab(goTo);
    toast.error(commerceMessage(err, context));
  }

  /** True when the offer is now stored as she typed it. */
  async function save(e?: FormEvent): Promise<boolean> {
    e?.preventDefault();
    if (!draft) return false;
    if (!draft.title.trim()) {
      setErrors({ title: "Give this offer a name — customers see it at checkout." });
      setTab("selling");
      toast.error("Give this offer a name before saving.");
      return false;
    }
    const pricingErrors = offerPricingErrors(draft);
    if (Object.keys(pricingErrors).length > 0) {
      setErrors(pricingErrors);
      setTab("price");
      toast.error(Object.values(pricingErrors)[0]);
      return false;
    }

    setSaving(true);
    try {
      if (offerId === null) {
        // Only a brand-new offer is given an address, and it is generated from
        // the name: changing it later would break every checkout link already
        // shared. Existing ones are collected so two offers can't collide.
        const taken = allOffers.map((existing) => existing.slug);
        const base = slugify(draft.title) || "offer";
        const created = await adminCommerceApi.offerCreate({
          ...draft,
          slug: uniqueKey(base, taken, "-"),
          status: "draft",
        });
        // Attaching is reported but never rolled back: the offer itself is
        // saved by this point, and treating a rejected product as a failed save
        // would send her back to a form that creates a second offer.
        try {
          for (const [index, productId] of pendingProducts.entries()) {
            await adminCommerceApi.offerProductAdd(created.id, productId, index);
          }
        } catch (err) {
          toast.error(commerceMessage(err, "offer"));
        }
        setErrors({});
        setDirty(false);
        setPendingProducts([]);
        toast.success("Saved as a draft. Put it live when you're ready.");
        navigate(`/admin/offers/${created.id}`, { replace: true });
      } else {
        await adminCommerceApi.offerUpdate(offerId, draft);
        setErrors({});
        setDirty(false);
        toast.success("Saved.");
        await refresh();
      }
      return true;
    } catch (err) {
      showRefusal(err, "offer");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (offerId === null) return;
    // Going live checks the offer as stored, so anything she has typed since
    // has to be stored first — otherwise the price she just set isn't the one
    // being checked, or the one customers would pay.
    if (dirty && !(await save())) return;
    try {
      await adminCommerceApi.offerPublish(offerId);
      toast.success("It's live — anyone with the link can buy it now.");
      await refresh();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    }
  }

  async function stopSelling() {
    if (offerId === null) return;
    const ok = await confirm({
      title: "Stop selling this?",
      description:
        "The checkout page stops taking orders. Everyone who already bought it keeps what they paid for.",
      confirmLabel: "Yes, stop selling it",
    });
    if (!ok) return;
    try {
      await adminCommerceApi.offerUpdate(offerId, { status: "draft" });
      toast.success("It's back to a draft. Nobody can buy it now.");
      await refresh();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    }
  }

  async function copyLink() {
    if (!offer) return;
    try {
      await navigator.clipboard.writeText(shareLink("checkout", offer.slug));
      toast.success("Checkout link copied.");
    } catch {
      toast.error("Your browser wouldn't let us copy that. Please try again.");
    }
  }

  const attachedIds = useMemo(
    () => (offer ? offer.products.map((product) => product.id) : pendingProducts),
    [offer, pendingProducts],
  );

  async function addProduct(productId: number) {
    if (offerId === null) {
      setPendingProducts((current) => [...current, productId]);
      setDirty(true);
      return;
    }
    try {
      await adminCommerceApi.offerProductAdd(offerId, productId, attachedIds.length);
      await refresh();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    }
  }

  async function removeProduct(productId: number) {
    if (offerId === null) {
      setPendingProducts((current) => current.filter((id) => id !== productId));
      return;
    }
    try {
      await adminCommerceApi.offerProductRemove(offerId, productId);
      await refresh();
    } catch (err) {
      toast.error(commerceMessage(err, "offer"));
    }
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin/offers">
            <ArrowLeft />
            All offers
          </Link>
        </Button>
        <ErrorNotice message={loadError} />
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  const live = offer?.status === "published";
  // Before the first save the list is whatever she has picked, in the order she
  // picked it; afterwards the server owns both the list and its order.
  const attachedProducts: AttachedProduct[] = offer
    ? offer.products
    : pendingProducts.flatMap((id) => catalogue.filter((product) => product.id === id));

  return (
    <div className="space-y-6">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        onClick={async () => {
          // Six tabs of typing used to disappear on this one click.
          if (dirty) {
            const leave = await confirm({
              title: "Leave without saving?",
              description: "The changes you've made to this offer will be lost.",
              confirmLabel: "Yes, leave it",
              destructive: true,
            });
            if (!leave) return;
          }
          navigate("/admin/offers");
        }}
      >
        <ArrowLeft />
        All offers
      </Button>

      <PageHeader
        eyebrow={offerId === null ? "New offer" : "Offer"}
        title={draft.title.trim() || "Your new offer"}
        description={
          offer
            ? `${priceSummary({ ...draft, currency: offer.currency })} · ${webAddress("checkout", offer.slug)}`
            : "A price and a checkout page for something you've already made."
        }
        actions={
          <>
            {offer && (
              <Badge tone={live ? "green" : offer.status === "archived" ? "neutral" : "slate"}>
                {OFFER_STATUS_LABEL[offer.status]}
              </Badge>
            )}
            {offer && (
              <Button variant="secondary" size="sm" onClick={() => void copyLink()}>
                <Link2 />
                Copy link
              </Button>
            )}
            {offer &&
              (live ? (
                <Button variant="secondary" size="sm" onClick={() => void stopSelling()}>
                  <EyeOff />
                  Stop selling
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void publish()}>
                  <Eye />
                  Put it live
                </Button>
              ))}
            <Button size="sm" onClick={() => void save()} disabled={saving || (!dirty && !!offer)}>
              {saving ? "Saving…" : dirty || !offer ? "Save" : "Saved"}
            </Button>
          </>
        }
      />

      {offer && offer.products.length === 0 && (
        <Caution>
          This offer doesn't include anything yet, so a customer would pay and receive nothing. Add
          what they get on the first tab before you put it live.
        </Caution>
      )}

      <Tabs.Root value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <Tabs.List className="flex gap-1 overflow-x-auto rounded-xl border border-hairline/70 bg-surface p-1.5">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            return (
              <Tabs.Trigger
                key={entry.value}
                value={entry.value}
                className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-plum data-[state=active]:bg-brand-gradient data-[state=active]:text-white"
              >
                <Icon className="size-4" />
                {entry.label}
              </Tabs.Trigger>
            );
          })}
        </Tabs.List>

        <div className="mt-5">
          <Tabs.Content value="selling">
            <SellingTab
              draft={draft}
              errors={errors}
              update={update}
              onPickPicture={() => setPicking(true)}
              catalogue={catalogue}
              attached={attachedProducts}
              onAdd={(id) => void addProduct(id)}
              onRemove={(id) => void removeProduct(id)}
            />
          </Tabs.Content>

          <Tabs.Content value="price">
            <PriceTab
              draft={draft}
              errors={errors}
              update={update}
              onChoosePricing={choosePricing}
              amountInput={amountInput}
              minInput={minInput}
              onAmountInput={(raw) => {
                setAmountInput(raw);
                update({ amountCents: dollarsToCents(raw) ?? 0 });
              }}
              onMinInput={(raw) => {
                setMinInput(raw);
                update({ minAmountCents: dollarsToCents(raw) ?? 0 });
              }}
              currency={offer?.currency ?? "usd"}
              offer={offer}
              onChanged={() => void refresh()}
              confirm={confirm}
            />
          </Tabs.Content>

          <Tabs.Content value="form">
            <OrderFormTab draft={draft} errors={errors} update={update} />
          </Tabs.Content>

          <Tabs.Content value="bumps">
            {offer ? (
              <BumpsTab
                offer={offer}
                catalogue={catalogue}
                onChanged={() => void refresh()}
                confirm={confirm}
              />
            ) : (
              <SaveFirst what="order bumps" />
            )}
          </Tabs.Content>

          <Tabs.Content value="upsells">
            {offer ? (
              <UpsellsTab
                offer={offer}
                offers={allOffers}
                onChanged={() => void refresh()}
                confirm={confirm}
              />
            ) : (
              <SaveFirst what="upsells" />
            )}
          </Tabs.Content>

          <Tabs.Content value="gifting">
            <Card>
              <CardHeader icon={<Gift className="size-4" />} title="Send as a gift"
                subtitle="Let a buyer purchase access for someone else" />
              <div className="space-y-4 p-5">
                <Check checked={draft.allowGifting !== false}
                  onChange={(allowGifting) => update({ allowGifting })}
                  label="Let buyers send this as a gift"
                  hint="At checkout, buyers can enter the recipient’s name, email address and a personal message." />
                <p className="text-sm text-ink-soft">The recipient gets access to the products. The buyer keeps the order and receipt. Gift recipients can sign in with an existing account or set up a new one.</p>
                <p className="text-sm text-ink-soft">Gifting is available for one-time purchases. Subscriptions and payment plans cannot be gifted. For a multi-item cart, every offer must allow gifting.</p>
                {(draft.pricingType === "subscription" || draft.pricingType === "payment_plan") && <Caution>This offer uses recurring payments, so the gift option will not appear at checkout. Choose a one-time price to offer gifting.</Caution>}
              </div>
            </Card>
          </Tabs.Content>

          <Tabs.Content value="after">
            <AfterTab draft={draft} errors={errors} update={update} pages={pages} />
          </Tabs.Content>
        </div>
      </Tabs.Root>

      <PicturePickerModal
        open={picking}
        onOpenChange={setPicking}
        onSelect={(asset) => {
          update({ thumbnailUrl: asset.url });
          setPicking(false);
        }}
      />

      {confirmDialog}
    </div>
  );
}

/* ── Tab 1 · What you're selling ────────────────────────────────────────── */

interface AttachedProduct {
  id: number;
  title: string;
  kind: Product["kind"];
  thumbnailUrl: string;
}

function SellingTab({
  draft,
  errors,
  update,
  onPickPicture,
  catalogue,
  attached,
  onAdd,
  onRemove,
}: {
  draft: OfferDraft;
  errors: Record<string, string>;
  update: (patch: Partial<OfferDraft>) => void;
  onPickPicture: () => void;
  catalogue: Product[];
  attached: AttachedProduct[];
  onAdd: (productId: number) => void;
  onRemove: (productId: number) => void;
}) {
  const attachedIds = new Set(attached.map((product) => product.id));
  const available = catalogue.filter((product) => !attachedIds.has(product.id));

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-5">
        <div className="grid gap-4">
          <Field
            label="What are you calling this offer?"
            hint="customers see this at checkout"
            // The web address is generated from the name, so a clash with an
            // offer that already has it belongs under the name she typed.
            error={errors.title ?? errors.slug}
          >
            <Input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="The Full Practice Reset — pay in full"
              required
            />
          </Field>

          <Field
            label="Checkout headline"
            hint="the big line on the checkout page — leave blank to use the name above"
            error={errors.checkoutHeadline}
          >
            <Input
              value={draft.checkoutHeadline}
              onChange={(e) => update({ checkoutHeadline: e.target.value })}
              placeholder="You're one step from a fully booked practice"
            />
          </Field>

          <Field
            label="Description"
            hint="what they're getting, in a few lines"
            error={errors.description}
          >
            <Textarea
              rows={4}
              value={draft.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="Six weeks of teaching, the full workbook, and the templates you can use on Monday morning."
            />
          </Field>

          <Field label="Picture" hint="shown beside the price at checkout">
            {draft.thumbnailUrl ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] p-2.5">
                <img
                  src={draft.thumbnailUrl}
                  alt=""
                  className="h-16 w-24 shrink-0 rounded-lg object-cover"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={onPickPicture}>
                    Choose a different one
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => update({ thumbnailUrl: "" })}
                  >
                    Remove it
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={onPickPicture}>
                <ImageIcon />
                Choose a picture
              </Button>
            )}
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Package className="size-4" />}
          title="What do they get?"
          subtitle="Everything you tick is unlocked the moment they pay"
        />
        <div className="space-y-3 p-5">
          {attached.length === 0 ? (
            <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-center text-sm text-ink-soft">
              Nothing yet. Pick something from your catalogue below.
            </p>
          ) : (
            <ul className="space-y-2">
              {attached.map((product) => (
                <li
                  key={product.id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-white/[0.03] px-3 py-2.5"
                >
                  {product.thumbnailUrl ? (
                    <img
                      src={product.thumbnailUrl}
                      alt=""
                      className="size-9 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gold/[0.12] text-gold">
                      <Package className="size-4" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{product.title}</p>
                    <p className="text-xs text-ink-soft">{PRODUCT_KIND[product.kind].one}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Take ${product.title} out of this offer`}
                    onClick={() => onRemove(product.id)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {available.length > 0 ? (
            <select
              value=""
              onChange={(e) => {
                const id = Number(e.target.value);
                if (id) onAdd(id);
              }}
              aria-label="Add something they get"
              className={selectStyles}
            >
              <option value="">Add something they get…</option>
              {available.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title} · {PRODUCT_KIND[product.kind].one}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-ink-soft">
              {catalogue.length === 0 ? (
                <>
                  Your catalogue is empty.{" "}
                  <Link to="/admin/catalogue" className="font-semibold text-gold hover:underline">
                    Add something to sell
                  </Link>{" "}
                  first.
                </>
              ) : (
                "Everything in your catalogue is already in this offer."
              )}
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ── Tab 2 · Price ──────────────────────────────────────────────────────── */

function PriceTab({
  draft,
  errors,
  update,
  onChoosePricing,
  amountInput,
  minInput,
  onAmountInput,
  onMinInput,
  currency,
  offer,
  onChanged,
  confirm,
}: {
  draft: OfferDraft;
  errors: Record<string, string>;
  update: (patch: Partial<OfferDraft>) => void;
  onChoosePricing: (pricingType: PricingType) => void;
  amountInput: string;
  minInput: string;
  onAmountInput: (raw: string) => void;
  onMinInput: (raw: string) => void;
  currency: string;
  offer: OfferDetail | null;
  onChanged: () => void;
  confirm: Confirm;
}) {
  const preview = pricePreview({ ...draft, currency });

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader
          icon={<BadgeDollarSign className="size-4" />}
          title="How do they pay?"
          subtitle="Pick one — you can change it until somebody buys"
        />
        <div className="space-y-2.5 p-5">
          {PRICING_CHOICES.map((choice) => {
            const selected = draft.pricingType === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                onClick={() => onChoosePricing(choice.value)}
                aria-pressed={selected}
                className={cn(
                  "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                  selected
                    ? "border-gold/60 bg-gold/[0.10] shadow-[0_0_0_4px_rgba(201,164,106,0.10)]"
                    : "border-hairline bg-white/[0.02] hover:border-white/25",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
                    selected ? "border-gold bg-gold" : "border-hairline",
                  )}
                >
                  {selected && <span className="size-1.5 rounded-full bg-night-deep" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{choice.label}</span>
                  <span className="mt-0.5 block text-xs text-ink-soft">{choice.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="space-y-5">
        <Card>
          <CardHeader title="The numbers" subtitle="Type dollars — we'll do the rest" />
          <div className="grid gap-4 p-5">
            {draft.pricingType === "one_time" && (
              <Field label="Price" error={errors.amountCents}>
                <MoneyInput value={amountInput} onChange={onAmountInput} placeholder="3500" />
              </Field>
            )}

            {draft.pricingType === "payment_plan" && (
              <>
                <Field
                  label="Each payment"
                  hint="not the total — for 3 payments of $1,250, type 1250"
                  error={errors.amountCents}
                >
                  <MoneyInput value={amountInput} onChange={onAmountInput} placeholder="1250" />
                </Field>
                <Field
                  label="How many payments in total?"
                  hint="including the one they make today"
                  error={errors.installmentCount}
                >
                  <Input
                    type="number"
                    min={2}
                    max={60}
                    value={draft.installmentCount ?? 3}
                    onChange={(e) =>
                      // Capped at both ends: over 60 the server answers with the
                      // parser's own words ("Number must be less than or equal
                      // to 60") right under the box.
                      update({
                        installmentCount: Math.min(60, Math.max(2, Number(e.target.value) || 2)),
                      })
                    }
                  />
                </Field>
                <CadenceSelect
                  label="How far apart?"
                  interval={draft.interval}
                  count={draft.intervalCount}
                  onChange={(interval, count) => update({ interval, intervalCount: count })}
                />
              </>
            )}

            {draft.pricingType === "subscription" && (
              <>
                <Field label="Price each time" error={errors.amountCents}>
                  <MoneyInput value={amountInput} onChange={onAmountInput} placeholder="97" />
                </Field>
                <CadenceSelect
                  label="How often are they charged?"
                  interval={draft.interval}
                  count={draft.intervalCount}
                  onChange={(interval, count) => update({ interval, intervalCount: count })}
                />
                <Field
                  label="Free trial"
                  hint="days before the first charge — 0 for none"
                  error={errors.trialDays}
                >
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={draft.trialDays}
                    onChange={(e) =>
                      update({ trialDays: Math.min(365, Math.max(0, Number(e.target.value) || 0)) })
                    }
                  />
                </Field>
              </>
            )}

            {draft.pricingType === "pwyw" && (
              <Field
                label="The least they can pay"
                hint="without this, someone can check out for nothing"
                error={errors.minAmountCents}
              >
                <MoneyInput value={minInput} onChange={onMinInput} placeholder="27" />
              </Field>
            )}

            {draft.pricingType === "free" && (
              <p className="text-sm text-ink-soft">
                Nothing to set. They fill in the order form, get access straight away, and no card is
                asked for.
              </p>
            )}
          </div>
        </Card>

        <div
          aria-live="polite"
          className="rounded-2xl border border-plum-bright/40 bg-plum-bright/[0.10] px-5 py-4"
        >
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-lilac">
            What the customer sees
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink">
            {preview ?? "Fill in the numbers above and this will say exactly what they'll pay."}
          </p>
        </div>

        {offer ? (
          <AdditionalPricingOptions offer={offer} onChanged={onChanged} confirm={confirm} />
        ) : (
          <Card>
            <div className="p-5 text-sm text-ink-soft">Save this offer once to add another way to pay.</div>
          </Card>
        )}
      </div>
    </div>
  );
}

interface PricingOptionDraft {
  label: string;
  pricingType: PricingType;
  amount: string;
  minAmount: string;
  interval: BillingInterval | null;
  intervalCount: number;
  installmentCount: number | null;
  trialDays: number;
  recommended: boolean;
  active: boolean;
}

function pricingOptionDraft(option?: OfferPricingOption): PricingOptionDraft {
  return option
    ? {
        label: option.label,
        pricingType: option.pricingType,
        amount: centsToDollars(option.amountCents),
        minAmount: centsToDollars(option.minAmountCents),
        interval: option.interval,
        intervalCount: option.intervalCount,
        installmentCount: option.installmentCount,
        trialDays: option.trialDays,
        recommended: option.recommended,
        active: option.active,
      }
    : {
        label: "",
        pricingType: "payment_plan",
        amount: "",
        minAmount: "",
        interval: "month",
        intervalCount: 1,
        installmentCount: 3,
        trialDays: 0,
        recommended: false,
        active: true,
      };
}

function AdditionalPricingOptions({ offer, onChanged, confirm }: {
  offer: OfferDetail;
  onChanged: () => void;
  confirm: Confirm;
}) {
  const [editing, setEditing] = useState<OfferPricingOption | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PricingOptionDraft>(() => pricingOptionDraft());
  const [saving, setSaving] = useState(false);

  function begin(option?: OfferPricingOption) {
    setEditing(option ?? null);
    setDraft(pricingOptionDraft(option));
    setOpen(true);
  }

  function choose(kind: PricingType) {
    setDraft((current) => ({
      ...current,
      pricingType: kind,
      interval: kind === "subscription" || kind === "payment_plan" ? "month" : null,
      intervalCount: 1,
      installmentCount: kind === "payment_plan" ? 3 : null,
      trialDays: kind === "subscription" ? current.trialDays : 0,
      amount: kind === "free" || kind === "pwyw" ? "" : current.amount,
      minAmount: kind === "pwyw" ? current.minAmount : "",
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const amountCents = dollarsToCents(draft.amount) ?? 0;
    const minAmountCents = dollarsToCents(draft.minAmount) ?? 0;
    const errors = offerPricingErrors({
      pricingType: draft.pricingType,
      amountCents,
      minAmountCents,
      installmentCount: draft.installmentCount,
    });
    if (!draft.label.trim()) {
      toast.error("Give this payment option a short label.");
      return;
    }
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0]);
      return;
    }
    const input = {
      label: draft.label.trim(),
      pricingType: draft.pricingType,
      amountCents,
      minAmountCents,
      interval: draft.interval,
      intervalCount: draft.intervalCount,
      installmentCount: draft.installmentCount,
      trialDays: draft.trialDays,
      recommended: draft.recommended,
      active: draft.active,
      sort: editing?.sort ?? offer.pricingOptions.length,
    };
    setSaving(true);
    try {
      if (editing) await adminCommerceApi.pricingOptionUpdate(offer.id, editing.id, input);
      else await adminCommerceApi.pricingOptionAdd(offer.id, input);
      toast.success(editing ? "Payment option updated" : "Payment option added");
      setOpen(false);
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "payment option"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(option: OfferPricingOption) {
    const ok = await confirm({
      title: `Remove “${option.label}”?`,
      description: "Existing orders keep their recorded totals. New customers will no longer see this way to pay.",
      confirmLabel: "Remove option",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.pricingOptionDelete(offer.id, option.id);
      toast.success("Payment option removed");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "payment option"));
    }
  }

  async function makeMainDefault() {
    const recommended = offer.pricingOptions.find((option) => option.recommended);
    if (!recommended) return;
    try {
      await adminCommerceApi.pricingOptionUpdate(offer.id, recommended.id, { recommended: false });
      toast.success("The main price is recommended again");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "payment option"));
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<BadgeDollarSign className="size-4" />}
        title="Other ways to pay"
        subtitle="Put a pay-in-full and payment-plan choice on one checkout"
        action={<Button type="button" size="sm" variant="secondary" onClick={() => begin()}><Plus /> Add option</Button>}
      />
      <div className="space-y-2 p-5 pt-0">
        <div className="flex min-h-12 items-center gap-3 rounded-xl border border-gold/30 bg-gold/[0.06] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Main price</p>
            <p className="text-xs text-ink-soft">{priceSummary(offer)}</p>
          </div>
          {!offer.pricingOptions.some((option) => option.recommended) ? (
            <Badge tone="gold">Recommended</Badge>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={() => void makeMainDefault()}>Recommend</Button>
          )}
        </div>
        {offer.pricingOptions.map((option) => (
          <div key={option.id} className="flex min-h-12 items-center gap-3 rounded-xl border border-hairline px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{option.label}</p>
              <p className="text-xs text-ink-soft">{priceSummary(option)}</p>
            </div>
            {option.recommended && <Badge tone="gold">Recommended</Badge>}
            {!option.active && <Badge tone="slate">Hidden</Badge>}
            <Button type="button" size="iconSm" variant="ghost" aria-label={`Edit ${option.label}`} onClick={() => begin(option)}><Pencil /></Button>
            <Button type="button" size="iconSm" variant="dangerGhost" aria-label={`Remove ${option.label}`} onClick={() => void remove(option)}><Trash2 /></Button>
          </div>
        ))}
      </div>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={editing ? "Edit payment option" : "Add another way to pay"}
        description="Customers choose between these options before entering their card."
        footer={
          <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" form="pricing-option-form" disabled={saving}>{saving ? "Saving…" : "Save option"}</Button>
          </>
        }
      >
        <form id="pricing-option-form" className="space-y-4" onSubmit={submit}>
          <Field label="Label" hint="shown beside the price">
            <Input value={draft.label} onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))} placeholder="6 monthly payments" autoFocus />
          </Field>
          <Field label="Payment style">
            <select className={selectStyles} value={draft.pricingType} onChange={(e) => choose(e.target.value as PricingType)}>
              {PRICING_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
            </select>
          </Field>
          {draft.pricingType !== "free" && draft.pricingType !== "pwyw" && (
            <Field label={draft.pricingType === "payment_plan" ? "Each payment" : "Price"}>
              <MoneyInput value={draft.amount} onChange={(amount) => setDraft((current) => ({ ...current, amount }))} />
            </Field>
          )}
          {draft.pricingType === "pwyw" && (
            <Field label="Minimum amount"><MoneyInput value={draft.minAmount} onChange={(minAmount) => setDraft((current) => ({ ...current, minAmount }))} /></Field>
          )}
          {(draft.pricingType === "subscription" || draft.pricingType === "payment_plan") && (
            <CadenceSelect
              label="How far apart?"
              interval={draft.interval}
              count={draft.intervalCount}
              onChange={(interval, intervalCount) => setDraft((current) => ({ ...current, interval, intervalCount }))}
            />
          )}
          {draft.pricingType === "payment_plan" && (
            <Field label="Number of payments">
              <Input type="number" min={2} max={60} value={draft.installmentCount ?? 3} onChange={(e) => setDraft((current) => ({ ...current, installmentCount: Math.min(60, Math.max(2, Number(e.target.value) || 2)) }))} />
            </Field>
          )}
          {draft.pricingType === "subscription" && (
            <Field label="Free trial days"><Input type="number" min={0} max={365} value={draft.trialDays} onChange={(e) => setDraft((current) => ({ ...current, trialDays: Math.min(365, Math.max(0, Number(e.target.value) || 0)) }))} /></Field>
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-hairline px-3 text-sm font-medium text-ink">
            <input type="checkbox" className="size-4 rounded border-hairline text-plum" checked={draft.recommended} onChange={(e) => setDraft((current) => ({ ...current, recommended: e.target.checked }))} />
            Recommend and preselect this option
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-hairline px-3 text-sm font-medium text-ink">
            <input type="checkbox" className="size-4 rounded border-hairline text-plum" checked={draft.active} onChange={(e) => setDraft((current) => ({ ...current, active: e.target.checked }))} />
            Show this option at checkout
          </label>
        </form>
      </Modal>
    </Card>
  );
}

/* ── Tab 3 · Order form ─────────────────────────────────────────────────── */

const QUESTION_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Short answer" },
  { value: "textarea", label: "Long answer" },
  { value: "select", label: "Choose from a list" },
  { value: "checkbox", label: "A yes/no tick box" },
  { value: "number", label: "A number" },
  { value: "date", label: "A date" },
];

function questionTypeLabel(type: CustomFieldType): string {
  return QUESTION_TYPES.find((entry) => entry.value === type)?.label ?? "Short answer";
}

function OrderFormTab({
  draft,
  errors,
  update,
}: {
  draft: OfferDraft;
  errors: Record<string, string>;
  update: (patch: Partial<OfferDraft>) => void;
}) {
  const [editing, setEditing] = useState<{ index: number | null; value: OfferCustomField } | null>(
    null,
  );
  const [optionsText, setOptionsText] = useState("");

  function startNew() {
    setEditing({
      index: null,
      value: { key: "", label: "", type: "text", required: false, options: [] },
    });
    setOptionsText("");
  }

  function startEdit(index: number) {
    const question = draft.customFields[index];
    setEditing({ index, value: question });
    setOptionsText(question.options.join("\n"));
  }

  function saveQuestion(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const label = editing.value.label.trim();
    if (!label) return;

    const options = optionsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // The key is derived once, when the question is first created, and never
    // again: every answer already collected is filed under it, so renaming
    // "Your email" to "Best email" must not orphan them.
    const taken = draft.customFields
      .filter((_, index) => index !== editing.index)
      .map((question) => question.key);
    const key = editing.value.key || uniqueKey(fieldKey(label), taken);

    const question: OfferCustomField = { ...editing.value, key, label, options };
    const next =
      editing.index === null
        ? [...draft.customFields, question]
        : draft.customFields.map((existing, index) => (index === editing.index ? question : existing));

    update({ customFields: next });
    setEditing(null);
  }

  function removeQuestion(index: number) {
    update({ customFields: draft.customFields.filter((_, i) => i !== index) });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          icon={<ClipboardList className="size-4" />}
          title="What do you need from them?"
          subtitle="Their name and email are always asked for"
        />
        <div className="space-y-2.5 p-5">
          <Check
            checked={draft.collectAddress}
            onChange={(collectAddress) => update({ collectAddress })}
            label="Ask for their address"
            hint="Needed if you post anything to them, or if sales tax depends on where they live."
          />
          <Check
            checked={draft.collectPhone}
            onChange={(collectPhone) => update({ collectPhone })}
            label="Ask for a phone number"
          />
          <Check
            checked={draft.collectTax}
            onChange={(collectTax) => update({ collectTax })}
            label="Add sales tax where it applies"
            hint="Worked out from their address at checkout and shown before they pay."
          />

          <div className="pt-2">
            <Check
              checked={draft.requireTerms}
              onChange={(requireTerms) => update({ requireTerms })}
              label="They must tick to agree to your terms"
              hint="They can't pay until the box is ticked."
            />
            {draft.requireTerms && (
              <div className="mt-3">
                <Field
                  label="Link to your terms"
                  hint="the page the tick box points at"
                  error={errors.termsUrl}
                >
                  <Input
                    value={draft.termsUrl}
                    onChange={(e) => update({ termsUrl: e.target.value })}
                    placeholder="https://yoursite.com/terms"
                  />
                </Field>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Anything else you'd like to ask?"
          subtitle="Extra questions on the order form"
          action={
            <Button variant="secondary" size="sm" onClick={startNew}>
              <Plus />
              Add a question
            </Button>
          }
        />
        {errors.customFields && (
          <div className="px-5 pt-4">
            <ErrorNotice message={errors.customFields} />
          </div>
        )}
        {draft.customFields.length === 0 ? (
          <EmptyState
            icon={<ClipboardList />}
            title="No extra questions"
            description="Ask what you'd want to know before your first session — their licence state, what they're stuck on, how they heard about you."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {draft.customFields.map((question, index) => (
              <li key={question.key || index} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{question.label}</p>
                  <p className="text-xs text-ink-soft">
                    {questionTypeLabel(question.type)}
                    {question.required ? " · they must answer" : ""}
                    {question.type === "select" && question.options.length > 0
                      ? ` · ${pluralize(question.options.length, "choice")}`
                      : ""}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Edit “${question.label}”`}
                  onClick={() => startEdit(index)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Remove “${question.label}”`}
                  onClick={() => removeQuestion(index)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.index === null ? "Add a question" : "Edit this question"}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="question-form">
              Save the question
            </Button>
          </>
        }
      >
        {editing && (
          <form id="question-form" onSubmit={saveQuestion} className="grid gap-4">
            <Field label="What are you asking?">
              <Input
                value={editing.value.label}
                onChange={(e) =>
                  setEditing((current) =>
                    current ? { ...current, value: { ...current.value, label: e.target.value } } : current,
                  )
                }
                placeholder="Which state are you licensed in?"
                required
                autoFocus
              />
            </Field>
            <Field label="How should they answer?">
              <select
                value={editing.value.type}
                onChange={(e) =>
                  setEditing((current) =>
                    current
                      ? { ...current, value: { ...current.value, type: e.target.value as CustomFieldType } }
                      : current,
                  )
                }
                aria-label="How should they answer?"
                className={selectStyles}
              >
                {QUESTION_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </Field>
            {editing.value.type === "select" && (
              <Field label="The choices" hint="one per line">
                <Textarea
                  rows={4}
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={"California\nNew York\nSomewhere else"}
                />
              </Field>
            )}
            <Check
              checked={editing.value.required}
              onChange={(required) =>
                setEditing((current) =>
                  current ? { ...current, value: { ...current.value, required } } : current,
                )
              }
              label="They have to answer this"
            />
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ── Tab 4 · Order bumps ───────────────────────────────────────────────── */

type Confirm = (options: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}) => Promise<boolean>;

function BumpsTab({
  offer,
  catalogue,
  onChanged,
  confirm,
}: {
  offer: OfferDetail;
  catalogue: Product[];
  onChanged: () => void;
  confirm: Confirm;
}) {
  const [editing, setEditing] = useState<{ bump: OfferBump | null } | null>(null);
  const [productId, setProductId] = useState("");
  const [title, setTitle] = useState("");
  const [pitch, setPitch] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [priceError, setPriceError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const includedIds = new Set(offer.products.map((product) => product.id));
  const bumpedIds = new Set(offer.bumps.map((bump) => bump.productId));

  function startNew() {
    setEditing({ bump: null });
    setProductId("");
    setTitle("");
    setPitch("");
    setPriceInput("");
    setPriceError(null);
  }

  function startEdit(bump: OfferBump) {
    setEditing({ bump });
    setProductId(String(bump.productId));
    setTitle(bump.title);
    setPitch(bump.description);
    setPriceInput(centsToDollars(bump.amountCents));
    setPriceError(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const chosen = Number(productId);
    if (!chosen) return;

    const cents = dollarsToCents(priceInput);
    // A bump at nothing isn't a bump — it's something she just gave away.
    if (cents === null || cents === 0) {
      setPriceError("Give it a price. At nothing it's simply included in the offer.");
      return;
    }

    setBusy(true);
    try {
      const payload = {
        productId: chosen,
        title: title.trim(),
        description: pitch.trim(),
        amountCents: cents,
        sort: editing.bump?.sort ?? offer.bumps.length,
      };
      if (editing.bump) {
        await adminCommerceApi.bumpUpdate(offer.id, editing.bump.id, payload);
      } else {
        await adminCommerceApi.bumpAdd(offer.id, payload);
      }
      toast.success(editing.bump ? "Order bump saved." : "Order bump added.");
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "order bump"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(bump: OfferBump) {
    const name = bump.title || bump.productTitle || "this bump";
    const ok = await confirm({
      title: `Remove “${name}” from the checkout?`,
      description: "The tick box disappears from the order form. Nobody loses anything they bought.",
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.bumpRemove(offer.id, bump.id);
      toast.success("Removed.");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "order bump"));
    }
  }

  /** Swaps a bump with its neighbour by trading their positions. */
  async function move(index: number, delta: number) {
    const target = index + delta;
    const a = offer.bumps[index];
    const b = offer.bumps[target];
    if (!a || !b) return;
    try {
      await adminCommerceApi.bumpUpdate(offer.id, a.id, { sort: target });
      await adminCommerceApi.bumpUpdate(offer.id, b.id, { sort: index });
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "order bump"));
    }
  }

  const available = catalogue.filter(
    (product) =>
      !includedIds.has(product.id) &&
      (!bumpedIds.has(product.id) || String(product.id) === productId),
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<ShoppingBag className="size-4" />}
          title="Order bumps"
          subtitle="A tick box on the checkout page that adds one more thing to the same payment"
          action={
            <Button variant="secondary" size="sm" onClick={startNew}>
              <Plus />
              Add a bump
            </Button>
          }
        />

        {offer.bumps.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag />}
            title="No bumps on this checkout"
            description="A bump is the easiest money in the business: one tick box, one small extra, added to the payment they're already making. A $27 template pack next to a $3,500 course sells surprisingly well."
            action={
              <Button size="sm" onClick={startNew}>
                Add your first bump
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {offer.bumps.map((bump, index) => (
              <li key={bump.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="iconSm"
                    disabled={index === 0}
                    aria-label="Show this bump earlier"
                    onClick={() => void move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    disabled={index === offer.bumps.length - 1}
                    aria-label="Show this bump later"
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">
                    {bump.title || bump.productTitle || "Untitled bump"}
                  </p>
                  <p className="text-xs text-ink-soft">
                    Adds {bump.productTitle ?? "a product"}
                    {bump.description ? ` · “${bump.description}”` : ""}
                  </p>
                </div>
                <span className="shrink-0 font-display text-lg text-plum">
                  + {money(bump.amountCents, offer.currency)}
                </span>
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Edit ${bump.title || bump.productTitle || "this bump"}`}
                  onClick={() => startEdit(bump)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  aria-label={`Remove ${bump.title || bump.productTitle || "this bump"}`}
                  onClick={() => void remove(bump)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.bump ? "Edit this bump" : "Add an order bump"}
        description="Something small and obviously useful next to what they're already buying."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="bump-form" disabled={busy}>
              {busy ? "Saving…" : "Save the bump"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="bump-form" onSubmit={save} className="grid gap-4">
            <Field label="What are you adding?" hint="anything from your catalogue">
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                aria-label="What are you adding?"
                className={selectStyles}
                required
              >
                <option value="">Choose something…</option>
                {available.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title} · {PRODUCT_KIND[product.kind].one}
                  </option>
                ))}
              </select>
            </Field>
            {available.length === 0 && (
              <p className="text-xs text-ink-soft">
                Everything in your catalogue is either already in this offer or already a bump on it.
              </p>
            )}
            <Field label="Price" hint="what it costs on top" error={priceError ?? undefined}>
              <MoneyInput
                value={priceInput}
                onChange={(raw) => {
                  setPriceInput(raw);
                  if (priceError) setPriceError(null);
                }}
                placeholder="27"
              />
            </Field>
            <Field label="Name it on the checkout page" hint="leave blank to use its own name">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Add the Practice Protection Pack"
              />
            </Field>
            <Field label="Your one-line pitch">
              <Textarea
                rows={3}
                value={pitch}
                onChange={(e) => setPitch(e.target.value)}
                placeholder="The contracts and consent forms I use in my own practice — normally $97."
              />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ── Tab 5 · Upsells ───────────────────────────────────────────────────── */

/** Steps are unique per offer and capped, so a swap needs a free number to
 *  park one row in while the other moves. */
const MAX_STEP = 20;

function firstFreeStep(used: Set<number>): number | null {
  for (let step = 1; step <= MAX_STEP; step += 1) {
    if (!used.has(step)) return step;
  }
  return null;
}

function UpsellsTab({
  offer,
  offers,
  onChanged,
  confirm,
}: {
  offer: OfferDetail;
  offers: Offer[];
  onChanged: () => void;
  confirm: Confirm;
}) {
  const [editing, setEditing] = useState<{ upsell: OfferUpsell | null } | null>(null);
  const [upsellOfferId, setUpsellOfferId] = useState("");
  const [downsellOfferId, setDownsellOfferId] = useState("");
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  // Archived offers are not on the menu, but one already chosen stays visible
  // so opening the editor doesn't quietly blank what is set up today.
  const choices = offers.filter(
    (candidate) =>
      candidate.id !== offer.id &&
      (candidate.status !== "archived" ||
        String(candidate.id) === upsellOfferId ||
        String(candidate.id) === downsellOfferId),
  );
  const byId = new Map(offers.map((candidate) => [candidate.id, candidate]));

  function startNew() {
    setEditing({ upsell: null });
    setUpsellOfferId("");
    setDownsellOfferId("");
    setHeadline("");
    setBody("");
  }

  function startEdit(upsell: OfferUpsell) {
    setEditing({ upsell });
    setUpsellOfferId(String(upsell.upsellOfferId));
    setDownsellOfferId(upsell.downsellOfferId ? String(upsell.downsellOfferId) : "");
    setHeadline(upsell.headline);
    setBody(upsell.body);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const chosen = Number(upsellOfferId);
    if (!chosen) return;

    const used = new Set(offer.upsells.map((upsell) => upsell.step));
    const step = editing.upsell?.step ?? firstFreeStep(used) ?? MAX_STEP;

    setBusy(true);
    try {
      const payload = {
        step,
        upsellOfferId: chosen,
        downsellOfferId: downsellOfferId ? Number(downsellOfferId) : null,
        headline: headline.trim(),
        body: body.trim(),
      };
      if (editing.upsell) {
        await adminCommerceApi.upsellUpdate(offer.id, editing.upsell.id, payload);
      } else {
        await adminCommerceApi.upsellAdd(offer.id, payload);
      }
      toast.success(editing.upsell ? "Upsell saved." : "Upsell added.");
      setEditing(null);
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "upsell"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(upsell: OfferUpsell) {
    const name = byId.get(upsell.upsellOfferId)?.title ?? upsell.upsellOfferTitle ?? "this upsell";
    const ok = await confirm({
      title: `Stop showing “${name}” after checkout?`,
      description: "The offer itself stays exactly as it is — it just isn't shown here any more.",
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await adminCommerceApi.upsellRemove(offer.id, upsell.id);
      toast.success("Removed.");
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "upsell"));
    }
  }

  /**
   * Trades two steps through a free number: the pair is unique per offer, so
   * writing the first one straight onto its neighbour's step would be refused.
   */
  async function move(index: number, delta: number) {
    const a = offer.upsells[index];
    const b = offer.upsells[index + delta];
    if (!a || !b) return;
    const park = firstFreeStep(new Set(offer.upsells.map((upsell) => upsell.step)));
    if (park === null) {
      toast.error("There are too many steps to reorder. Remove one first.");
      return;
    }
    try {
      await adminCommerceApi.upsellUpdate(offer.id, a.id, { step: park });
      await adminCommerceApi.upsellUpdate(offer.id, b.id, { step: a.step });
      await adminCommerceApi.upsellUpdate(offer.id, a.id, { step: b.step });
      onChanged();
    } catch (err) {
      toast.error(commerceMessage(err, "upsell"));
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={<Sparkles className="size-4" />}
          title="After they've paid"
          subtitle="One-click offers shown in order, before they reach the thank-you page"
          action={
            <Button variant="secondary" size="sm" onClick={startNew}>
              <Plus />
              Add an upsell
            </Button>
          }
        />

        {offer.upsells.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="Nothing shown after checkout"
            description="They've just paid and their card is already on file, so this is the warmest moment you'll ever get. Show them the next thing — and if they say no, you can show a smaller version of it instead."
            action={
              <Button size="sm" onClick={startNew}>
                Add your first upsell
              </Button>
            }
          />
        ) : (
          <ol className="divide-y divide-hairline/60">
            {offer.upsells.map((upsell, index) => {
              const target = byId.get(upsell.upsellOfferId);
              const downsell = upsell.downsellOfferId ? byId.get(upsell.downsellOfferId) : null;
              return (
                <li key={upsell.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
                  <div className="flex shrink-0 flex-col">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      disabled={index === 0}
                      aria-label="Show this one earlier"
                      onClick={() => void move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      disabled={index === offer.upsells.length - 1}
                      aria-label="Show this one later"
                      onClick={() => void move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                  <Badge tone="plum" className="mt-1 shrink-0">
                    {index === 0 ? "First" : index === 1 ? "Second" : `Number ${index + 1}`}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">
                      {target?.title ?? upsell.upsellOfferTitle ?? "An offer you've since removed"}
                    </p>
                    <p className="text-xs text-ink-soft">
                      {target ? priceSummary(target) : "Price unknown"}
                      {downsell ? ` · if they say no, show “${downsell.title}”` : ""}
                    </p>
                    {upsell.headline && (
                      <p className="mt-1.5 text-sm text-ink-soft">“{upsell.headline}”</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label="Edit this upsell"
                    onClick={() => startEdit(upsell)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="dangerGhost"
                    size="iconSm"
                    aria-label="Remove this upsell"
                    onClick={() => void remove(upsell)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </Card>

      <Modal
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing?.upsell ? "Edit this upsell" : "Add an upsell"}
        description="Shown straight after they pay, with their card already on file."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="upsell-form" disabled={busy}>
              {busy ? "Saving…" : "Save the upsell"}
            </Button>
          </>
        }
      >
        {editing && (
          <form id="upsell-form" onSubmit={save} className="grid gap-4">
            <Field label="What are you offering them?">
              <select
                value={upsellOfferId}
                onChange={(e) => setUpsellOfferId(e.target.value)}
                aria-label="What are you offering them?"
                className={selectStyles}
                required
              >
                <option value="">Choose one of your offers…</option>
                {choices.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.title} · {priceSummary(candidate)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="And if they say no?"
              hint="optional — a smaller version they see instead"
            >
              <select
                value={downsellOfferId}
                onChange={(e) => setDownsellOfferId(e.target.value)}
                aria-label="And if they say no?"
                className={selectStyles}
              >
                <option value="">Nothing — move on</option>
                {choices
                  .filter((candidate) => String(candidate.id) !== upsellOfferId)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title} · {priceSummary(candidate)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Headline">
              <Input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Wait — add the coaching call for $200 off?"
              />
            </Field>
            <Field label="The pitch">
              <Textarea
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="One hour with me to map your first 90 days. This price is only on this page."
              />
            </Field>
          </form>
        )}
      </Modal>
    </div>
  );
}

/* ── Tab 6 · After purchase ────────────────────────────────────────────── */

type Landing = "standard" | "page" | "link";

const EXPIRY_CHOICES: { value: string; label: string }[] = [
  { value: "", label: "Never — it's theirs for good" },
  { value: "30", label: "After 30 days" },
  { value: "60", label: "After 60 days" },
  { value: "90", label: "After 3 months" },
  { value: "180", label: "After 6 months" },
  { value: "365", label: "After a year" },
];

function AfterTab({
  draft,
  errors,
  update,
  pages,
}: {
  draft: OfferDraft;
  errors: Record<string, string>;
  update: (patch: Partial<OfferDraft>) => void;
  pages: { slug: string; title: string }[];
}) {
  // Held rather than derived: picking "one of your own pages" before a page has
  // been chosen leaves nothing stored, and a derived choice would snap straight
  // back to the standard page while she was still looking for the dropdown.
  const [landing, setLanding] = useState<Landing>(
    draft.thankYouPageId ? "page" : draft.redirectUrl ? "link" : "standard",
  );

  // Only one destination can be in force, so choosing clears the other. Both
  // set at once is a coin toss over where a paying customer lands.
  function chooseLanding(next: Landing) {
    setLanding(next);
    if (next === "standard") update({ thankYouPageId: null, redirectUrl: "" });
    if (next === "page") update({ redirectUrl: "", thankYouPageId: pages[0]?.slug ?? null });
    if (next === "link") update({ thankYouPageId: null, redirectUrl: "" });
  }

  const expiryValue = draft.accessExpiresAfterDays ? String(draft.accessExpiresAfterDays) : "";
  const expiryOptions = EXPIRY_CHOICES.some((choice) => choice.value === expiryValue)
    ? EXPIRY_CHOICES
    : [...EXPIRY_CHOICES, { value: expiryValue, label: `After ${expiryValue} days` }];

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader
          icon={<Flag className="size-4" />}
          title="Where do they land?"
          subtitle="The first thing they see once the payment goes through"
        />
        <div className="space-y-2.5 p-5">
          <Radio
            checked={landing === "standard"}
            onSelect={() => chooseLanding("standard")}
            label="Your standard thank-you page"
            hint="Shows what they bought and how to get to it. Nothing to set up."
          />
          <Radio
            checked={landing === "page"}
            onSelect={() => chooseLanding("page")}
            label="One of your own pages"
            hint="Use this when the welcome needs to say more than a receipt."
          />
          {landing === "page" && (
            <div className="pl-7">
              <Field label="Which page?" error={errors.thankYouPageId}>
                {pages.length === 0 ? (
                  <p className="text-xs text-ink-soft">
                    You don't have any pages yet — make one first and it'll show up here.
                  </p>
                ) : (
                  <select
                    value={draft.thankYouPageId ?? ""}
                    onChange={(e) => update({ thankYouPageId: e.target.value || null })}
                    aria-label="Which page?"
                    className={selectStyles}
                  >
                    {/* Without this, a draft holding nothing (or a page since
                        deleted) matches no option and the browser paints the
                        first page as chosen — she reads a page she never picked
                        and buyers land somewhere else. */}
                    <option value="">Choose a page…</option>
                    {pages.map((page) => (
                      <option key={page.slug} value={page.slug}>
                        {page.title}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
          )}
          <Radio
            checked={landing === "link"}
            onSelect={() => chooseLanding("link")}
            label="A link you paste in"
            hint="A booking calendar, a private group, anywhere at all."
          />
          {landing === "link" && (
            <div className="pl-7">
              <Field label="The link" error={errors.redirectUrl}>
                <Input
                  value={draft.redirectUrl}
                  onChange={(e) => update({ redirectUrl: e.target.value })}
                  placeholder="https://calendly.com/yvette/welcome"
                />
              </Field>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="How long do they keep it?"
          subtitle="Most things people buy are theirs for good"
        />
        <div className="space-y-4 p-5">
          <Field
            label="Their access ends…"
            hint="counted from the day they buy"
            error={errors.accessExpiresAfterDays}
          >
            <select
              value={expiryValue}
              onChange={(e) =>
                update({ accessExpiresAfterDays: e.target.value ? Number(e.target.value) : null })
              }
              aria-label="Their access ends…"
              className={selectStyles}
            >
              {expiryOptions.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Field>

          {draft.accessExpiresAfterDays !== null && (
            <Caution>
              After {draft.accessExpiresAfterDays} days this closes on its own and they lose what they
              bought. Only use it for things that are genuinely time-limited, like a live round.
            </Caution>
          )}

          {draft.pricingType === "subscription" && (
            <p className="text-sm text-ink-soft">
              This is a subscription, so their access already stops when they cancel. You almost never
              need an end date as well.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          icon={<Mail className="size-4" />}
          title="Their welcome email"
          subtitle="Sent the moment they buy, alongside their receipt"
        />
        <div className="space-y-4 p-5">
          <Check
            checked={draft.sendWelcomeEmail}
            onChange={(sendWelcomeEmail) => update({ sendWelcomeEmail })}
            label="Send a welcome email when someone buys this"
            hint="Turn this off for small add-ons, where a second email on top of the receipt feels like a mistake."
          />

          {draft.sendWelcomeEmail && (
            <Field
              label="What should they do first?"
              hint="optional"
              error={errors.welcomeNextSteps}
            >
              <Textarea
                rows={5}
                value={draft.welcomeNextSteps}
                onChange={(e) => update({ welcomeNextSteps: e.target.value })}
                placeholder={
                  "Start with the Welcome module — there's a short survey in it that tells me how to help you.\n\nThen come and say hello in the community."
                }
              />
            </Field>
          )}

          {draft.sendWelcomeEmail && (
            <p className="text-sm text-ink-soft">
              They always get a link to sign in and open what they bought. Anything you write here is
              added underneath that, in your words.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all",
        checked
          ? "border-gold/60 bg-gold/[0.10]"
          : "border-hairline bg-white/[0.02] hover:border-white/25",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border",
          checked ? "border-gold bg-gold" : "border-hairline",
        )}
      >
        {checked && <span className="size-1.5 rounded-full bg-night-deep" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-soft">{hint}</span>}
      </span>
    </button>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plug,
  RefreshCw,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  integrationsApi,
  timeAgo,
  type ApiKeySummary,
  type ApiScope,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEvent,
} from "@/lib/settingsApi";
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
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { Modal, useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError, pluralize } from "@/pages/admin/ui/friendly";

/**
 * Connections: sending what happens here into another tool, and letting another
 * tool read from here.
 *
 * Written as two questions rather than two protocols — "tell another tool when
 * something happens" and "let a tool read your information" — because the
 * person setting up a Zap knows what she wants to happen and does not need to
 * know which half of it is a webhook.
 *
 * Both the signing secret and the API key are shown once, in a dialog that says
 * so. Neither can be recovered afterwards; the screen only ever gets a hint.
 */

const DELIVERY_TONE: Record<string, "green" | "gold" | "red" | "slate"> = {
  delivered: "green",
  pending: "gold",
  failed: "red",
  dead: "red",
};

const DELIVERY_LABEL: Record<string, string> = {
  delivered: "Arrived",
  pending: "Trying again",
  failed: "Didn't arrive",
  dead: "Gave up",
};

async function copy(value: string, what: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${what} copied`);
  } catch {
    toast.error("Your browser wouldn't let us copy it — select it and copy by hand.");
  }
}

export default function Integrations() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[] | null>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", url: "", eventTypes: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<{ title: string; body: string; value: string } | null>(
    null,
  );

  const [addingKey, setAddingKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState({ name: "", scopes: ["contacts.read"] as string[] });

  const [confirm, confirmDialog] = useConfirm();

  const load = useCallback(() => {
    Promise.all([
      integrationsApi.endpoints(),
      integrationsApi.deliveries(),
      integrationsApi.apiKeys(),
    ])
      .then(([e, d, k]) => {
        setEndpoints(e.endpoints);
        setDeliveries(d.deliveries);
        setKeys(k.keys);
        setError(null);
      })
      .catch(() => setError("We couldn't load your connections. Try refreshing the page."));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    integrationsApi
      .events()
      .then((res) => setEvents(res.events))
      .catch(() => undefined);
    integrationsApi
      .apiScopes()
      .then((res) => setScopes(res.scopes))
      .catch(() => undefined);
  }, []);

  async function createEndpoint(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await integrationsApi.createEndpoint(draft);
      setAdding(false);
      setDraft({ name: "", url: "", eventTypes: [] });
      setRevealed({
        title: "Copy this signing key now",
        body: "Paste it into the other tool so it can check that messages really came from you. We can't show it to you again.",
        value: created.signingSecret,
      });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "connection"));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEndpoint(endpoint: WebhookEndpoint) {
    try {
      await integrationsApi.updateEndpoint(endpoint.id, { enabled: !endpoint.enabled });
      toast.success(endpoint.enabled ? "Paused" : "Switched back on");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "connection"));
    }
  }

  async function removeEndpoint(endpoint: WebhookEndpoint) {
    const ok = await confirm({
      title: `Remove this connection?`,
      description: `${endpoint.name || endpoint.url} will stop receiving anything from you.`,
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    try {
      await integrationsApi.deleteEndpoint(endpoint.id);
      toast.success("Removed");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "connection"));
    }
  }

  async function testEndpoint(endpoint: WebhookEndpoint) {
    try {
      await integrationsApi.testEndpoint(endpoint.id);
      toast.success("Test sent — check the recent messages below in a moment.");
      setTimeout(load, 3000);
    } catch (err) {
      toast.error(friendlyError(err, "connection"));
    }
  }

  async function replay(delivery: WebhookDelivery) {
    try {
      await integrationsApi.replay(delivery.id);
      toast.success("Sending it again");
      setTimeout(load, 3000);
    } catch (err) {
      toast.error(friendlyError(err, "message"));
    }
  }

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await integrationsApi.createApiKey(keyDraft);
      setAddingKey(false);
      setKeyDraft({ name: "", scopes: ["contacts.read"] });
      setRevealed({
        title: "Copy this key now",
        body: "Paste it into the other tool. This is the only time we can show it to you — if you lose it, turn it off and make a new one.",
        value: created.key,
      });
      load();
    } catch (err) {
      toast.error(friendlyError(err, "key"));
    } finally {
      setSaving(false);
    }
  }

  async function revokeKey(key: ApiKeySummary) {
    const ok = await confirm({
      title: `Turn off "${key.name}"?`,
      description: "Anything using this key stops working straight away.",
      confirmLabel: "Yes, turn it off",
      destructive: true,
    });
    if (!ok) return;
    try {
      await integrationsApi.revokeApiKey(key.id);
      toast.success("Turned off");
      load();
    } catch (err) {
      toast.error(friendlyError(err, "key"));
    }
  }

  function toggleEvent(type: string) {
    setDraft((d) => ({
      ...d,
      eventTypes: d.eventTypes.includes(type)
        ? d.eventTypes.filter((t) => t !== type)
        : [...d.eventTypes, type],
    }));
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-soft transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" />
          All settings
        </Link>
        <PageHeader
          eyebrow="Settings"
          title="Connections"
          description="Plug your other tools into this one — Zapier, your CRM, anything that can talk to a web address."
        />
      </div>

      {error && <ErrorNotice message={error} />}

      {/* ── Outgoing ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<Zap />}
          title="Tell another tool when something happens"
          subtitle="We'll send a message the moment somebody buys, signs up or fills in a form."
          action={
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plug />
              Add a connection
            </Button>
          }
        />

        {endpoints === null ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : endpoints.length === 0 ? (
          <EmptyState
            icon={<Zap />}
            title="Nothing connected yet"
            description="Add the web address your other tool gave you, and pick what it should hear about."
            action={
              <Button size="sm" onClick={() => setAdding(true)}>
                Add a connection
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {endpoints.map((endpoint) => (
              <li key={endpoint.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{endpoint.name || "Unnamed connection"}</p>
                      <Badge tone={endpoint.enabled ? "green" : "slate"}>
                        {endpoint.enabled ? "On" : "Paused"}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-ink-soft">{endpoint.url}</p>
                    <p className="mt-1.5 text-xs text-ink-soft">
                      {endpoint.eventTypes.length === 0
                        ? "Hears about everything"
                        : pluralize(endpoint.eventTypes.length, "thing", "things") +
                          " it hears about"}
                      {" · "}
                      {endpoint.lastEventAt
                        ? `last message ${timeAgo(endpoint.lastEventAt).toLowerCase()}`
                        : "nothing sent yet"}
                    </p>
                    {!endpoint.enabled && endpoint.disabledReason && (
                      <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        We paused this one because the other tool kept refusing our messages. Check
                        the address, then switch it back on.
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => testEndpoint(endpoint)}
                      disabled={!endpoint.enabled}
                    >
                      <Send />
                      Send a test
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleEndpoint(endpoint)}>
                      {endpoint.enabled ? "Pause" : "Switch on"}
                    </Button>
                    <Button
                      variant="dangerGhost"
                      size="iconSm"
                      aria-label="Remove this connection"
                      onClick={() => removeEndpoint(endpoint)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Delivery log ───────────────────────────────────────────────── */}
      {deliveries.length > 0 && (
        <Card>
          <CardHeader
            title="Recent messages"
            subtitle="What we've sent lately, and whether it arrived."
          />
          <ul className="divide-y divide-hairline/60">
            {deliveries.slice(0, 25).map((delivery) => (
              <li
                key={delivery.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={DELIVERY_TONE[delivery.status] ?? "slate"}>
                      {DELIVERY_LABEL[delivery.status] ?? delivery.status}
                    </Badge>
                    <span className="text-sm text-ink">
                      {events.find((e) => e.type === delivery.eventType)?.label ??
                        delivery.eventType}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-soft">
                    {delivery.endpointName || delivery.endpointUrl} ·{" "}
                    {timeAgo(delivery.createdAt).toLowerCase()}
                    {delivery.attempts > 1 && ` · tried ${delivery.attempts} times`}
                  </p>
                </div>
                {delivery.status !== "delivered" && (
                  <Button variant="ghost" size="sm" onClick={() => replay(delivery)}>
                    <RefreshCw />
                    Send it again
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Incoming ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          icon={<KeyRound />}
          title="Let a tool read your information"
          subtitle="Give another tool a key so it can look up your contacts, orders and offers."
          action={
            <Button size="sm" onClick={() => setAddingKey(true)}>
              <KeyRound />
              Make a key
            </Button>
          }
        />

        {keys === null ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-14 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title="No keys yet"
            description="You'll only need one if another tool asks you for it."
          />
        ) : (
          <ul className="divide-y divide-hairline/60">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-ink">{key.name}</p>
                    {key.revokedAt && <Badge tone="slate">Turned off</Badge>}
                  </div>
                  <p className="mt-0.5 font-mono text-xs text-ink-soft">{key.hint}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {scopes.length > 0
                      ? key.scopes
                          .map((s) => scopes.find((sc) => sc.value === s)?.label ?? s)
                          .join(" · ")
                      : key.scopes.join(" · ")}
                    {" · last used "}
                    {timeAgo(key.lastUsedAt).toLowerCase()}
                  </p>
                </div>
                {!key.revokedAt && (
                  <Button variant="ghost" size="sm" onClick={() => revokeKey(key)}>
                    Turn it off
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ── Dialogs ────────────────────────────────────────────────────── */}
      <Modal
        open={adding}
        onOpenChange={setAdding}
        title="Add a connection"
        description="Your other tool will have given you a web address to paste in here."
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="endpoint-form" disabled={saving}>
              {saving ? "Saving…" : "Add it"}
            </Button>
          </>
        }
      >
        <form id="endpoint-form" onSubmit={createEndpoint} className="space-y-4">
          <Field label="What is it?" hint="just so you recognise it later" htmlFor="endpoint-name">
            <Input
              id="endpoint-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="My Zapier automation"
              autoFocus
            />
          </Field>
          <Field label="Web address it gave you" htmlFor="endpoint-url">
            <Input
              id="endpoint-url"
              type="url"
              required
              value={draft.url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder="https://hooks.zapier.com/…"
            />
          </Field>

          <div>
            <p className="mb-2 text-[0.8rem] font-semibold text-ink">
              What should it hear about?{" "}
              <span className="font-normal text-ink-soft/80">
                pick none to send it everything
              </span>
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {events
                .filter((event) => event.type !== "test.ping")
                .map((event) => (
                  <label
                    key={event.type}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/[0.04]"
                  >
                    <input
                      type="checkbox"
                      checked={draft.eventTypes.includes(event.type)}
                      onChange={() => toggleEvent(event.type)}
                      className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                    />
                    {event.label}
                  </label>
                ))}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={addingKey}
        onOpenChange={setAddingKey}
        title="Make a key"
        description="Give it only what the other tool actually needs."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddingKey(false)}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="key-form" disabled={saving}>
              {saving ? "Making it…" : "Make the key"}
            </Button>
          </>
        }
      >
        <form id="key-form" onSubmit={createKey} className="space-y-4">
          <Field label="What's it for?" htmlFor="key-name">
            <Input
              id="key-name"
              required
              value={keyDraft.name}
              onChange={(e) => setKeyDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Zapier"
              autoFocus
            />
          </Field>
          <div>
            <p className="mb-2 text-[0.8rem] font-semibold text-ink">What may it do?</p>
            <div className="space-y-1.5">
              {scopes.map((scope) => (
                <label
                  key={scope.value}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-white/[0.04]"
                >
                  <input
                    type="checkbox"
                    checked={keyDraft.scopes.includes(scope.value)}
                    onChange={() =>
                      setKeyDraft((d) => ({
                        ...d,
                        scopes: d.scopes.includes(scope.value)
                          ? d.scopes.filter((s) => s !== scope.value)
                          : [...d.scopes, scope.value],
                      }))
                    }
                    className="size-4 rounded border-hairline text-plum focus-visible:ring-plum/30"
                  />
                  {scope.label}
                </label>
              ))}
            </div>
          </div>
        </form>
      </Modal>

      <Modal
        open={revealed !== null}
        onOpenChange={(open) => !open && setRevealed(null)}
        title={revealed?.title ?? ""}
        description={revealed?.body}
        footer={
          <Button size="sm" onClick={() => setRevealed(null)}>
            I've copied it
          </Button>
        }
      >
        <div className="flex items-center gap-2.5">
          <code className="min-w-0 flex-1 select-all break-all rounded-xl border border-hairline bg-white/[0.04] px-4 py-3 font-mono text-sm text-ink">
            {revealed?.value}
          </code>
          <Button
            variant="secondary"
            size="iconSm"
            aria-label="Copy it"
            onClick={() => revealed && copy(revealed.value, "Key")}
          >
            <Copy />
          </Button>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Plus, Share2, Trash2 } from "lucide-react";
import { ApiError, getToken } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@/pages/admin/ui/primitives";
import { useConfirm } from "@/pages/admin/ui/Dialog";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * Social Media — Final Sidebar & Page UX Requirements §6.
 *
 * One page for the social platforms the business actually uses, rather than a
 * sidebar entry per network. §6 is explicit that platforms must not be
 * hard-coded, so nothing here enumerates Instagram or TikTok: the owner types
 * the platform name and the page renders what she entered.
 *
 * What it does today is what §6 asks for at minimum — platform, handle,
 * status, and an Open Account button that takes her to the real profile.
 * Publishing and analytics are named in §6 as future work and are deliberately
 * absent rather than stubbed.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

interface SocialAccount {
  id: string;
  platform: string;
  handle: string;
  url: string;
  status: "connected" | "not_connected" | "needs_attention";
  notes: string;
}

const STATUS_LABEL: Record<SocialAccount["status"], string> = {
  connected: "Connected",
  not_connected: "Not connected",
  needs_attention: "Needs attention",
};

const STATUS_TONE: Record<SocialAccount["status"], "green" | "slate" | "gold"> = {
  connected: "green",
  not_connected: "slate",
  needs_attention: "gold",
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

/** Ids are generated here so a new row is addressable before it is saved. */
function newId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function SocialMedia() {
  const [accounts, setAccounts] = useState<SocialAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  useEffect(() => {
    request<{ accounts: SocialAccount[] }>("/admin/social")
      .then((r) => setAccounts(r.accounts))
      .catch(() => setError("We couldn't load your social accounts. Try refreshing the page."));
  }, []);

  const update = (id: string, patch: Partial<SocialAccount>) => {
    setAccounts((current) =>
      (current ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
    setDirty(true);
  };

  const add = () => {
    setAccounts((current) => [
      ...(current ?? []),
      { id: newId(), platform: "", handle: "", url: "", status: "not_connected", notes: "" },
    ]);
    setDirty(true);
  };

  const remove = async (account: SocialAccount) => {
    const ok = await confirm({
      title: `Remove ${account.platform || "this account"}?`,
      description:
        "It will no longer appear on this page. Nothing on the platform itself is changed or disconnected.",
      confirmLabel: "Yes, remove it",
      destructive: true,
    });
    if (!ok) return;
    setAccounts((current) => (current ?? []).filter((a) => a.id !== account.id));
    setDirty(true);
  };

  const save = async () => {
    if (!accounts) return;
    // An account with no platform name is a blank row she started and left;
    // saving it would put an unlabelled card on the page.
    const cleaned = accounts.filter((a) => a.platform.trim().length > 0);
    setSaving(true);
    try {
      const result = await request<{ accounts: SocialAccount[] }>("/admin/social", {
        method: "PUT",
        body: JSON.stringify({ accounts: cleaned }),
      });
      setAccounts(result.accounts);
      setDirty(false);
      toast.success("Saved.");
    } catch (err) {
      toast.error(friendlyError(err, "save your social accounts"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Social Media"
        description="Access and manage the social platforms Boss Clinician uses for marketing from one place."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={add}>
              <Plus />
              Add account
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      {error && <ErrorNotice message={error} />}

      {accounts === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          {/* §8: every empty state explains what the feature is for and offers
              an obvious next action. */}
          <EmptyState
            icon={<Share2 />}
            title="No social accounts yet"
            description="Add the platforms you use for marketing — Instagram, LinkedIn, YouTube, or anything else — so you can reach them from one place instead of hunting for logins."
            action={
              <Button size="sm" onClick={add}>
                <Plus />
                Add your first account
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id} className="flex flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <Share2 aria-hidden className="size-[1.1rem]" />
                </span>
                <Badge tone={STATUS_TONE[account.status]}>{STATUS_LABEL[account.status]}</Badge>
              </div>

              <div className="mt-4 space-y-3">
                <Field label="Platform" htmlFor={`platform-${account.id}`}>
                  <Input
                    id={`platform-${account.id}`}
                    value={account.platform}
                    onChange={(e) => update(account.id, { platform: e.target.value })}
                    placeholder="Instagram"
                  />
                </Field>

                <Field label="Account or handle" htmlFor={`handle-${account.id}`}>
                  <Input
                    id={`handle-${account.id}`}
                    value={account.handle}
                    onChange={(e) => update(account.id, { handle: e.target.value })}
                    placeholder="@bossclinician"
                  />
                </Field>

                <Field
                  label="Link"
                  hint="where Open Account goes"
                  htmlFor={`url-${account.id}`}
                >
                  <Input
                    id={`url-${account.id}`}
                    value={account.url}
                    onChange={(e) => update(account.id, { url: e.target.value })}
                    placeholder="https://instagram.com/bossclinician"
                  />
                </Field>

                <Field label="Status" htmlFor={`status-${account.id}`}>
                  <Select
                    id={`status-${account.id}`}
                    value={account.status}
                    onChange={(e) =>
                      update(account.id, { status: e.target.value as SocialAccount["status"] })
                    }
                  >
                    <option value="connected">Connected</option>
                    <option value="not_connected">Not connected</option>
                    <option value="needs_attention">Needs attention</option>
                  </Select>
                </Field>
              </div>

              <div className="mt-5 flex items-center gap-2 border-t border-hairline/60 pt-4">
                <Button
                  variant="primary"
                  size="sm"
                  className={cn("flex-1", !account.url && "pointer-events-none opacity-50")}
                  asChild={Boolean(account.url)}
                  // Without a link there is nowhere to open, so the control
                  // says so rather than looking clickable and doing nothing.
                  disabled={!account.url}
                >
                  {account.url ? (
                    <a href={account.url} target="_blank" rel="noreferrer">
                      Open Account
                      <ExternalLink />
                    </a>
                  ) : (
                    <span>Add a link first</span>
                  )}
                </Button>
                <Button
                  variant="dangerGhost"
                  size="iconSm"
                  onClick={() => remove(account)}
                  aria-label={`Remove ${account.platform || "this account"}`}
                >
                  <Trash2 />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Button, Card, ErrorNotice, Field, Input, Skeleton } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";
import { acceptInviteApi, type InvitePreview } from "@/lib/settingsApi";

/**
 * Where the invitation email lands.
 *
 * Unauthenticated by design — the person opening it has no account yet. All it
 * does is take a name and a password; they then sign in through the ordinary
 * screen, so second-factor enrolment and everything else follows the same path
 * as it does for everybody else.
 */
export default function AcceptInvite() {
  const { token = "" } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [invite, setInvite] = useState<InvitePreview | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    acceptInviteApi
      .preview(token)
      .then(setInvite)
      .catch(() => setInvite(null));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await acceptInviteApi.accept(token, { name, password });
      toast.success("You're all set — sign in with your new password.");
      navigate("/admin/login", { replace: true });
    } catch (err) {
      toast.error(friendlyError(err, "invitation"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-night-deep px-4 py-12">
      <Card className="w-full max-w-md p-7">
        {invite === undefined ? (
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : invite === null ? (
          <ErrorNotice message="That invitation has expired or has already been used. Ask for a new one." />
        ) : (
          <>
            <h1 className="font-display text-2xl text-white">Set your password</h1>
            <p className="mt-2 text-sm text-ink-soft">
              You've been given access to Boss Clinician as{" "}
              <span className="break-all text-ink">{invite.email}</span>.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <Field label="Your name" htmlFor="invite-name">
                <Input
                  id="invite-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </Field>
              <Field
                label="Pick a password"
                hint="at least 10 characters"
                htmlFor="invite-password"
              >
                <Input
                  id="invite-password"
                  type="password"
                  required
                  /* The server refuses anything shorter, and its reason is
                     turned into a generic "check the highlighted fields" on the
                     way back — so the box has to say so itself. */
                  minLength={10}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Button type="submit" className="w-full" disabled={saving}>
                {saving ? "Saving…" : "Save it and sign in"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

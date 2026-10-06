import { useState, type FormEvent } from "react";
import { Navigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { marketingApi, type Sequence } from "@/lib/marketingApi";
import { Field, Input, Textarea } from "@/pages/admin/ui/primitives";
import { friendlyError } from "@/pages/admin/ui/friendly";

/**
 * Email sequences no longer have a page of their own (sheet row 67).
 *
 * A sequence is a set of emails that go out one after another once somebody
 * joins it — the thing Kajabi calls an email sequence. Kajabi lists them on its
 * Email Campaigns page next to broadcasts, and "New Email Campaign" asks which
 * of the two you want; this app now does the same. What is left here is:
 *
 *  - the default export, which sends any old link or bookmark to the combined
 *    list already narrowed to sequences, keeping `?status=` / `?folder=` and
 *    turning `?new=1` into the new-sequence step of the chooser; and
 *  - the create-a-sequence form, which the chooser on Email Campaigns reuses.
 *
 * Opening one sequence is still `/admin/marketing/sequences/:id`.
 */
export default function Sequences() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams();
  next.set("type", "sequence");
  for (const key of ["status", "folder"] as const) {
    const value = searchParams.get(key);
    if (value) next.set(key, value);
  }
  if (searchParams.get("new")) next.set("new", "sequence");
  return <Navigate to={`/admin/marketing/campaigns?${next.toString()}`} replace />;
}

/**
 * The name-and-description form that starts a sequence.
 *
 * It renders only the form; the dialog around it owns the buttons, so the
 * submit button there points at `id` with `form=`. `noValidate` and no
 * `required` anywhere, for the reason the campaign form gives: a browser
 * bubble never shows from a button in a dialog footer, so a constraint here
 * would be a Create button that silently does nothing.
 */
export function NewSequenceForm({
  id,
  onCreated,
  onSavingChange,
}: {
  id: string;
  onCreated: (sequence: Sequence) => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setBusy(next: boolean) {
    setSaving(next);
    onSavingChange?.(next);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!name.trim()) {
      setNameError("Give the sequence a name — only you see it.");
      toast.error("Not created yet: give the sequence a name.");
      document.getElementById(`${id}-name`)?.focus();
      return;
    }
    setNameError(null);

    setBusy(true);
    try {
      const created = await marketingApi.createSequence({
        name: name.trim(),
        description: description.trim(),
      });
      toast.success("Sequence created — now add its emails.");
      setName("");
      setDescription("");
      onCreated(created);
    } catch (err) {
      toast.error(friendlyError(err, "sequence"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form id={id} onSubmit={create} noValidate className="grid gap-4">
      <Field
        label="What is this sequence called?"
        hint="Only you see this"
        error={nameError ?? undefined}
      >
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (event.target.value.trim()) setNameError(null);
          }}
          placeholder="Welcome emails"
          autoFocus
        />
      </Field>
      <Field label="What is it for?" hint="Optional">
        <Textarea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="The five emails everyone gets after they download the guide."
        />
      </Field>
    </form>
  );
}

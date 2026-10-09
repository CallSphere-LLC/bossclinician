import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { adminApi } from "@/lib/api";
import type { CommunityDetail } from "@/types/admin";
import { Button, Card, Field, Input, Textarea } from "./ui/primitives";
import { friendlyError } from "./ui/friendly";

export function CommunitySettings({ community, onSaved }: { community: CommunityDetail; onSaved: () => void }) {
  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description ?? "");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await adminApi.communityUpdate(Number(community.id), { name: name.trim(), description });
      toast.success("Community details saved");
      onSaved();
    } catch (error) {
      toast.error(friendlyError(error, "community"));
    } finally { setSaving(false); }
  }

  return <Card className="p-5 sm:p-6">
    <form onSubmit={save} className="space-y-5">
      <h2 className="font-display text-xl text-ink">Community details</h2>
      <Field label="Community name" htmlFor="community-settings-name">
        <Input id="community-settings-name" required value={name} onChange={event => setName(event.target.value)} />
      </Field>
      <Field label="Description" htmlFor="community-settings-description" hint="Shown at the top of the participant view. Line breaks are preserved.">
        <Textarea id="community-settings-description" rows={12} value={description} onChange={event => setDescription(event.target.value)} placeholder="Welcome members and explain what this community includes." />
      </Field>
      <Button type="submit" disabled={saving || !name.trim()}>{saving ? "Saving…" : "Save details"}</Button>
    </form>
  </Card>;
}

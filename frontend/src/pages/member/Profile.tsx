import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Camera, Loader2 } from "lucide-react";
import { Seo } from "@/components/Seo";
import { MemberShell, MemberAvatar } from "@/components/member/MemberShell";
import { GlassCard } from "@/components/luxe/GlassCard";
import { LuxeButton } from "@/components/luxe/LuxeButton";
import { LuxeInput, LuxeSelect } from "@/components/luxe/LuxeField";
import { useMember } from "@/hooks/useMember";
import { memberApi, MemberApiError } from "@/lib/memberApi";
import { cn } from "@/lib/cn";

/**
 * Time zones offered to members.
 *
 * A flat list rather than `<optgroup>`s, because the dark `[&>option]` styling
 * in LuxeSelect only reaches direct children and grouped options would render
 * in the OS light palette. Roughly thirty zones covers this audience — the full
 * IANA database is four hundred entries and turns a two-second decision into
 * scrolling.
 */
const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Arizona — Phoenix" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
  { value: "America/Puerto_Rico", label: "Atlantic — San Juan" },
  { value: "America/Toronto", label: "Canada — Toronto" },
  { value: "America/Winnipeg", label: "Canada — Winnipeg" },
  { value: "America/Vancouver", label: "Canada — Vancouver" },
  { value: "America/Mexico_City", label: "Mexico — Mexico City" },
  { value: "America/Bogota", label: "Colombia — Bogotá" },
  { value: "America/Sao_Paulo", label: "Brazil — São Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina — Buenos Aires" },
  { value: "Europe/London", label: "United Kingdom — London" },
  { value: "Europe/Dublin", label: "Ireland — Dublin" },
  { value: "Europe/Lisbon", label: "Portugal — Lisbon" },
  { value: "Europe/Madrid", label: "Spain — Madrid" },
  { value: "Europe/Paris", label: "France — Paris" },
  { value: "Europe/Berlin", label: "Germany — Berlin" },
  { value: "Europe/Rome", label: "Italy — Rome" },
  { value: "Europe/Amsterdam", label: "Netherlands — Amsterdam" },
  { value: "Europe/Stockholm", label: "Sweden — Stockholm" },
  { value: "Europe/Warsaw", label: "Poland — Warsaw" },
  { value: "Europe/Athens", label: "Greece — Athens" },
  { value: "Africa/Lagos", label: "Nigeria — Lagos" },
  { value: "Africa/Nairobi", label: "Kenya — Nairobi" },
  { value: "Africa/Johannesburg", label: "South Africa — Johannesburg" },
  { value: "Asia/Dubai", label: "UAE — Dubai" },
  { value: "Asia/Kolkata", label: "India — Kolkata" },
  { value: "Asia/Singapore", label: "Singapore" },
  { value: "Asia/Hong_Kong", label: "Hong Kong" },
  { value: "Asia/Tokyo", label: "Japan — Tokyo" },
  { value: "Australia/Perth", label: "Australia — Perth" },
  { value: "Australia/Brisbane", label: "Australia — Brisbane" },
  { value: "Australia/Sydney", label: "Australia — Sydney" },
  { value: "Pacific/Auckland", label: "New Zealand — Auckland" },
  { value: "UTC", label: "UTC" },
];

const LOCALES: { value: string; label: string }[] = [
  { value: "en-US", label: "English (United States)" },
  { value: "en-GB", label: "English (United Kingdom)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "es-ES", label: "Español (España)" },
  { value: "es-MX", label: "Español (México)" },
  { value: "fr-FR", label: "Français (France)" },
  { value: "fr-CA", label: "Français (Canada)" },
  { value: "de-DE", label: "Deutsch (Deutschland)" },
  { value: "it-IT", label: "Italiano (Italia)" },
  { value: "nl-NL", label: "Nederlands (Nederland)" },
  { value: "pt-BR", label: "Português (Brasil)" },
];

/** 5 MB. Bigger than any sane headshot, small enough to fail fast on a 4G upload. */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type FieldName = "firstName" | "lastName" | "timezone" | "locale";
type FieldErrors = Partial<Record<FieldName, string>>;

/** Pulls per-field messages out of a zod `.flatten()` payload, if there is one. */
function fieldErrorsFrom(details: unknown): FieldErrors {
  if (typeof details !== "object" || details === null) return {};
  const flattened = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof flattened !== "object" || flattened === null) return {};

  const out: FieldErrors = {};
  for (const key of ["firstName", "lastName", "timezone", "locale"] as const) {
    const messages = (flattened as Record<string, unknown>)[key];
    if (Array.isArray(messages) && typeof messages[0] === "string") out[key] = messages[0];
  }
  return out;
}

export default function Profile() {
  const { member, setMember } = useMember();

  const [firstName, setFirstName] = useState(member?.firstName ?? "");
  const [lastName, setLastName] = useState(member?.lastName ?? "");
  const [timezone, setTimezone] = useState(member?.timezone ?? "America/New_York");
  const [locale, setLocale] = useState(member?.locale ?? "en-US");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // A member whose zone was set from the browser may sit on something the
  // short list does not carry (America/Detroit, Europe/Zurich). Appending it
  // keeps the select from silently rewriting their zone on the next save.
  const timezoneOptions = useMemo(() => {
    if (!timezone || TIMEZONES.some((tz) => tz.value === timezone)) return TIMEZONES;
    return [...TIMEZONES, { value: timezone, label: timezone.replace(/_/g, " ") }];
  }, [timezone]);

  const localeOptions = useMemo(() => {
    if (!locale || LOCALES.some((l) => l.value === locale)) return LOCALES;
    return [...LOCALES, { value: locale, label: locale }];
  }, [locale]);

  if (!member) return null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError("");

    try {
      const updated = await memberApi.updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        timezone,
        locale,
      });
      setMember(updated);
      toast.success("Your details are saved.");
    } catch (error) {
      if (error instanceof MemberApiError) {
        setErrors(fieldErrorsFrom(error.details));
        setFormError(error.message);
      } else {
        setFormError("We could not save that just now. Please try again in a moment.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <MemberShell
      title="Your details"
      description="This is the name other members see, and the time zone every date on the site is shown in."
    >
      <Seo title="Your Details | Boss Clinician" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr] lg:items-start">
        <AvatarPanel />

        <GlassCard spotlight={false} interactive={false} className="p-6 sm:p-8">
          <form onSubmit={(event) => void onSubmit(event)} noValidate>
            <div className="grid gap-6 sm:grid-cols-2">
              <LuxeInput
                label="First name"
                name="firstName"
                autoComplete="given-name"
                value={firstName}
                required
                error={errors.firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
              <LuxeInput
                label="Last name"
                name="lastName"
                autoComplete="family-name"
                value={lastName}
                error={errors.lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
              <LuxeSelect
                label="Time zone"
                name="timezone"
                value={timezone}
                error={errors.timezone}
                hint="Live calls and deadlines are shown in this zone."
                onChange={(event) => setTimezone(event.target.value)}
              >
                {timezoneOptions.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </LuxeSelect>
              <LuxeSelect
                label="Language"
                name="locale"
                value={locale}
                error={errors.locale}
                hint="Sets how dates and numbers are written."
                onChange={(event) => setLocale(event.target.value)}
              >
                {localeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </LuxeSelect>
            </div>

            <div aria-live="polite" className="mt-5 min-h-[1.25rem]">
              {formError && (
                <p role="alert" className="text-sm font-medium text-red-400">
                  {formError}
                </p>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <LuxeButton type="submit" variant="foil" size="sm" disabled={saving}>
                {saving && <Loader2 aria-hidden className="size-4 animate-spin" />}
                {saving ? "Saving" : "Save changes"}
              </LuxeButton>
              <p className="text-xs text-orchid-faint">
                Your email address is changed from the Password &amp; devices page.
              </p>
            </div>
          </form>
        </GlassCard>
      </div>
    </MemberShell>
  );
}

/**
 * Avatar panel.
 *
 * The file uploads the moment it is chosen rather than waiting for the form's
 * Save: it is a different endpoint with a different failure mode (413, wrong
 * type), and burying that inside a save that also writes four text fields
 * makes a rejected photo look like a rejected form. The local object URL shows
 * the crop instantly so the wait never looks like nothing happened.
 */
function AvatarPanel() {
  const { member, setMember } = useMember();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  if (!member) return null;

  const onPick = async (file: File) => {
    setError("");

    if (!file.type.startsWith("image/")) {
      setError("That file is not an image. Please choose a JPG or PNG.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError("That photo is larger than 5 MB. Please choose a smaller one.");
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const { avatarUrl } = await memberApi.uploadAvatar(file);
      setMember({ ...member, avatarUrl });
      setPreview(null);
      toast.success("Your photo is updated.");
    } catch (uploadError) {
      setPreview(null);
      setError(
        uploadError instanceof MemberApiError
          ? uploadError.message
          : "We could not upload that photo. Please try again.",
      );
    } finally {
      setUploading(false);
      // Clearing the input lets the same file be re-picked after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <GlassCard
      accent="gold"
      spotlight={false}
      interactive={false}
      className="flex flex-col items-center gap-5 p-6 text-center sm:p-8"
    >
      <div className="relative">
        <MemberAvatar
          src={preview ?? member.avatarUrl}
          name={member.name}
          email={member.email}
          className={cn("size-28 text-2xl", uploading && "opacity-50")}
        />
        {uploading && (
          <Loader2
            aria-hidden
            className="absolute inset-0 m-auto size-7 animate-spin text-gold"
          />
        )}
      </div>

      <div>
        <h2 className="font-display text-lg text-white">Your photo</h2>
        <p className="copy-luxe mt-1 text-sm">
          A square headshot looks best. JPG or PNG, up to 5 MB.
        </p>
      </div>

      <label
        className={cn(
          "inline-flex min-h-[2.75rem] cursor-pointer items-center justify-center gap-2.5 rounded-full",
          "border border-white/25 px-6 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-white/85",
          "transition-colors duration-300 hover:border-gold/60 hover:bg-gold/[0.08] hover:text-white",
          "focus-within:outline focus-within:outline-2 focus-within:outline-offset-4 focus-within:outline-gold",
          uploading && "pointer-events-none opacity-50",
        )}
      >
        <Camera aria-hidden className="size-4" />
        {member.avatarUrl ? "Change photo" : "Add a photo"}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={uploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onPick(file);
          }}
        />
      </label>

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-red-400">
        {error}
      </p>
    </GlassCard>
  );
}

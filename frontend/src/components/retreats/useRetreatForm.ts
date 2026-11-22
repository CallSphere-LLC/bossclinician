import { useRef, useState } from "react";
import { memberRetreatsApi, type FormKey, type FormResponseView } from "@/lib/retreatsApi";
import { errorMessage, fieldErrorsFrom, formatSavedAt } from "./retreatUi";

/**
 * Save & Finish Later / Submit for one native retreat form.
 *
 * The draft lives on the server (retreat_form_responses), so it survives a
 * logout and a different device. `revision` is sent back on every write; a 409
 * means another device saved first and the guest is asked to reload rather than
 * silently overwriting it. A double click cannot submit twice: `busy` holds the
 * buttons while a request is in flight.
 */
export function useRetreatForm<T extends object>(opts: {
  slug: string;
  formKey: FormKey;
  initial: FormResponseView;
  readOnly: boolean;
  onSaved?: () => void;
}) {
  const [data, setData] = useState<T>(() => ({ ...(opts.initial.data as T) }));
  const [response, setResponse] = useState<FormResponseView>(opts.initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ text: string; tone: "neutral" | "error" | "success" }>(() =>
    opts.initial.state === "draft" && opts.initial.updatedAt
      ? { text: `Draft saved ${formatSavedAt(opts.initial.updatedAt)}`, tone: "neutral" }
      : opts.initial.state === "submitted" && opts.initial.submittedAt
        ? { text: `Submitted ${formatSavedAt(opts.initial.submittedAt)}`, tone: "success" }
        : { text: "", tone: "neutral" },
  );
  const inFlight = useRef(false);

  const set = <K extends keyof T>(key: K, value: T[K]) => setData((prev) => ({ ...prev, [key]: value }));

  async function save(submit: boolean, validate?: (data: T) => Record<string, string>) {
    if (opts.readOnly || inFlight.current) return;
    if (submit && validate) {
      const local = validate(data);
      setErrors(local);
      if (Object.keys(local).length > 0) {
        setMessage({ text: "Please answer the questions marked below before submitting.", tone: "error" });
        return;
      }
    } else if (!submit) {
      setErrors({});
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await memberRetreatsApi.saveForm(
        opts.slug,
        opts.formKey,
        data as Record<string, unknown>,
        submit,
        response.revision,
      );
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
        setErrors(result.fieldErrors);
        setMessage({ text: "Please answer the questions marked below before submitting.", tone: "error" });
        return;
      }
      setResponse(result.response);
      setErrors({});
      setMessage(
        submit
          ? { text: `Submitted ${formatSavedAt(result.response.submittedAt)}. Thank you!`, tone: "success" }
          : { text: `Draft saved ${formatSavedAt(result.response.updatedAt)}`, tone: "neutral" },
      );
      opts.onSaved?.();
    } catch (error) {
      setErrors(fieldErrorsFrom(error));
      setMessage({ text: errorMessage(error, "That didn't save. Please try again."), tone: "error" });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return { data, set, response, busy, errors, message, save };
}

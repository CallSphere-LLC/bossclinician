import { useEffect, useState } from "react";
import { Paperclip } from "lucide-react";
import { formatDate } from "@/lib/format";
import { formsApi, type SentFile } from "@/lib/formsApi";
import { Card, CardHeader, EmptyState, ErrorNotice } from "@/pages/admin/ui/primitives";

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Files this person sent through a form upload question.
 *
 * Fetched every time the contact opens, never cached: each `previewUrl` is a
 * signed link that stops working after two hours.
 */
export default function ContactFilesCard({ contactId }: { contactId: number }) {
  const [files, setFiles] = useState<SentFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isInteger(contactId)) return;
    let cancelled = false;
    formsApi
      .contactFiles(contactId)
      .then((rows) => {
        if (!cancelled) setFiles(rows);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load the files they sent just now.");
      });
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  // Most people never send a file; an empty card on every contact is noise.
  if (!error && (files === null || files.length === 0)) return null;

  return (
    <Card>
      <CardHeader title="Files they sent" icon={<Paperclip />} />
      {error ? (
        <div className="px-5 py-4">
          <ErrorNotice message={error} />
        </div>
      ) : files && files.length > 0 ? (
        <ul className="divide-y divide-hairline/60">
          {files.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <a
                  href={file.previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-semibold text-ink hover:text-gold"
                >
                  {file.name}
                </a>
                <p className="text-xs text-ink-soft">
                  {file.formName ? `Through “${file.formName}” · ` : ""}
                  {formatDate(file.createdAt)} · {sizeOf(file.sizeBytes)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<Paperclip />} title="No files" description="Nothing sent through a form yet." />
      )}
    </Card>
  );
}

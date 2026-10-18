import { sessionFetch } from "@/lib/adminTransport";
import { ApiError } from "@/lib/api";

/**
 * Course-level release and certificate settings for the course builder
 * (routes/admin/curriculum.ts): Kajabi's "Lock" for a whole course in one
 * click, and whether finishing the course issues a certificate — and whether
 * every graded quiz must be passed first.
 */

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await sessionFetch(`${API_BASE}/admin/curriculum${path}`, { ...options, headers });
  if (!res.ok) {
    let message = "Something went wrong. Please try again in a moment.";
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // A non-JSON body tells us nothing worth showing.
    }
    throw new ApiError(message, res.status, {}, false);
  }
  return (await res.json()) as T;
}

export interface CourseCertificateSettings {
  /** Finishing the course issues a certificate. */
  enabled: boolean;
  templateId: number | null;
  title: string;
  /** "Require passing every quiz to earn the certificate". */
  requirePass: boolean;
  gradedQuizzes: {
    lessonTitle: string;
    title: string;
    passMark: number | null;
    /** The quiz itself keeps the next lesson locked until passed. */
    requirePass: boolean;
    /** Both the quiz and its lesson are live. */
    published: boolean;
  }[];
}

/** One certificate issued for a course, as GET /admin/curriculum/:id/certificates lists it. */
export interface IssuedCertificate {
  id: number;
  memberId: number;
  recipientName: string;
  email: string | null;
  verificationCode: string;
  completedAt: string;
  issuedAt: string;
  /** Set when the certificate was withdrawn; it then fails verification. */
  revokedAt: string | null;
}

export const courseReleaseApi = {
  /** Lock (or unlock) every lesson of the course behind the one before it. */
  lockSequence: (courseId: number, locked: boolean) =>
    call<{ locked: boolean; updated: number }>(`/${courseId}/lock-sequence`, {
      method: "POST",
      body: JSON.stringify({ locked }),
    }),

  certificate: (courseId: number) => call<CourseCertificateSettings>(`/${courseId}/certificate`),

  /** Every certificate this course has issued, newest first. */
  issuedCertificates: (courseId: number) =>
    call<{ certificates: IssuedCertificate[] }>(`/${courseId}/certificates`),

  saveCertificate: (
    courseId: number,
    changes: { enabled?: boolean; requirePass?: boolean; title?: string },
  ) =>
    call<CourseCertificateSettings>(`/${courseId}/certificate`, {
      method: "PUT",
      body: JSON.stringify(changes),
    }),
};

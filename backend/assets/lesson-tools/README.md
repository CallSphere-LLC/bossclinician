# Rate Raise Lab (tracker row 233)
Source HTML: https://drive.google.com/file/d/1DFlehOApr2UUfopBcuS8I_GMNAFGCQN-/view
Implementation spec: https://drive.google.com/file/d/1X-X_xImKwSTrV2qRCi8VmJPy-JJywQUk/view

HTML is returned only through authenticated member route after exact course61/lesson163 access. No public HTML file, new lesson or grants. Original lesson body untouched. Demo save adapter removed. Script extracted to frontend/rate-raise-runtime.js?url so the existing CSP stays unchanged. The sandbox has no allow-same-origin, storage, auth token, API connection or forms. Parent only accepts messages from its exact opaque iframe and validates the same strict numeric/date/choice/checklist schema as the server. Reads/writes bound to expected signed-in member and revisions. Free text, generated templates, patient/client names, IDs and contacts never sync. User must copy/download local text before leaving.

No standalone public calculator list was added because the spec requires existing lesson-only access. Admin generic calculator dropdown was not broadened.

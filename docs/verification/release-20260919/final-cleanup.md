# Final QA account cleanup

After root confirmed that the browser recording checks finished and all 28 exact QA voice sessions were deleted through the application API, account cleanup ran in a guarded database transaction. The guard locked and verified the exact release QA account identities, required zero remaining voice sessions, and rejected unexpected dependent records.

Deleted admins 21/22, member 65, lead 22, 45 QA admin-audit rows, 18 login-attempt rows for the five exact QA emails, and two tour-progress rows. Member 66 had already been deleted by its verifier. Account session records were revoked through the database's cascading foreign keys.

Post-commit verification found zero remaining exact account IDs, zero matches across all 61 foreign-key reference columns for those identities, and zero matches across all 24 email/admin-email columns for the five fixture addresses. Commerce fixture cleanup is recorded separately in `community-commerce-cleanup.md`. Root owns S3 cleanup verification; this cleanup did not access or alter S3.

Final public health still reports `20260919183929-f736b5f`. Both K3s pods remain ready, with zero container restarts. The checkout source SHA256 remains `1bfe0709be4c20665d87ca8c5bde149386f65fe6180181bb60d453a41316512a`, matching the deployed images.

Exact zero counts and the final runtime snapshot are in [final-cleanup.json](final-cleanup.json).

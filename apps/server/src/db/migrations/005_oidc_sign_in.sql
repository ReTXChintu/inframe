-- Sign-in moves to the OpenID Connect identity server shared with SpendLog
-- and Trippin. A local account is tied to the identity server's subject
-- (`sub`); existing accounts are linked on first sign-in by verified email.
-- InFrame no longer keeps passwords: accounts created from now on have none.
ALTER TABLE users ADD COLUMN oidc_sub text UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

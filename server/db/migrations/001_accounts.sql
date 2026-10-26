-- Accounts (see Accounts in ARCHITECTURE.md). Migrations are forward-only and
-- additive: a later change adds a new file, never edits this one.
CREATE TABLE users (
  id text PRIMARY KEY,
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  google_sub text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL
);

-- token_hash is HMAC-SHA256(SESSION_SECRET, token): the token itself is only in the cookie.
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_id ON sessions (user_id);
CREATE INDEX sessions_expires_at ON sessions (expires_at);

-- User accounts and server-side sessions.
-- Each user owns exactly one player row; all campaigns and saves hang off the player.

CREATE TABLE users (
  id                   uuid PRIMARY KEY,
  username             text NOT NULL CHECK (username ~ '^[A-Za-z0-9_.-]{3,32}$'),
  password_hash        text NOT NULL,
  player_id            uuid NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  created_at           timestamptz NOT NULL DEFAULT now(),
  password_changed_at  timestamptz NOT NULL DEFAULT now(),
  last_login_at        timestamptz
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

-- Only a SHA-256 of the session token is stored, so a database leak does not leak live sessions.
CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  user_agent    text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

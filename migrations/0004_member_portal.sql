-- Member portal: link app_users accounts to a person record
ALTER TABLE app_users ADD COLUMN people_id INTEGER REFERENCES people(id);

-- One-time invite/verification tokens for member portal sign-up
CREATE TABLE IF NOT EXISTS member_invite_tokens (
  token       TEXT    PRIMARY KEY,
  people_id   INTEGER NOT NULL REFERENCES people(id),
  email       TEXT    NOT NULL DEFAULT '',
  expires_at  INTEGER NOT NULL DEFAULT 0,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

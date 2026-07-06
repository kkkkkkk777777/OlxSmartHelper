-- OLX Smart Helper — Phase 2 database schema (PostgreSQL 14+)
-- Scope: exactly the current product needs — users, message presets, seller
-- contact history, and lightweight listing-interaction history. No more.
--
-- gen_random_uuid() requires pgcrypto (bundled in PG13+ as an extension).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Shared updated_at trigger.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. users
-- Why: owner of presets and history. Phase 1 has no accounts, so `client_id`
-- (a UUID the extension generates and stores in chrome.storage) identifies a
-- device today; `email` is filled later if real auth is added.
-- ============================================================
CREATE TABLE users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  UUID NOT NULL,                 -- device/client id from the extension
    email      TEXT,                          -- optional, only once auth exists
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_client_id_key UNIQUE (client_id),
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_email_format CHECK (email IS NULL OR email LIKE '%_@_%')
);
CREATE TRIGGER trg_users_updated
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 2. message_presets
-- Why: the seller message templates edited in Phase 1. `id` is the SAME UUID the
-- extension already generates, so local→DB sync is an idempotent upsert.
-- One default per user is enforced by a partial unique index.
-- ============================================================
CREATE TABLE message_presets (
    id         UUID PRIMARY KEY,              -- reuse the client-generated preset id
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label      TEXT NOT NULL,
    body       TEXT NOT NULL,                 -- "text" in Phase 1; `body` avoids the SQL keyword
    is_default BOOLEAN NOT NULL DEFAULT false,
    position   INTEGER NOT NULL DEFAULT 0,    -- display ordering
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT message_presets_label_len CHECK (char_length(label) BETWEEN 1 AND 120),
    CONSTRAINT message_presets_body_len  CHECK (char_length(body) BETWEEN 1 AND 2000)
);
CREATE INDEX idx_presets_user ON message_presets (user_id, position);
-- At most one default preset per user.
CREATE UNIQUE INDEX uq_presets_one_default
    ON message_presets (user_id) WHERE is_default;
CREATE TRIGGER trg_presets_updated
    BEFORE UPDATE ON message_presets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 3. contact_history
-- Why: record of messages the user actually sent/copied to a seller. Stores a
-- snapshot of the message text so history stays accurate even if the source
-- preset is later edited or deleted (preset_id → SET NULL).
-- ============================================================
CREATE TABLE contact_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    preset_id     UUID REFERENCES message_presets(id) ON DELETE SET NULL,
    listing_url   TEXT NOT NULL,
    listing_title TEXT,
    listing_price NUMERIC(12,2),
    currency      TEXT,
    message_text  TEXT NOT NULL,              -- snapshot of what was sent
    channel       TEXT NOT NULL DEFAULT 'copy'
                  CHECK (channel IN ('copy','olx_chat','phone','other')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_user_time ON contact_history (user_id, created_at DESC);
CREATE INDEX idx_contact_user_listing ON contact_history (user_id, listing_url);

-- ============================================================
-- 4. listing_actions
-- Why: lightweight interaction log powering "recently viewed / evaluated" and
-- future analytics (which verdicts lead to contact). Kept flat and append-only.
-- ============================================================
CREATE TABLE listing_actions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_url   TEXT NOT NULL,
    listing_title TEXT,
    action        TEXT NOT NULL
                  CHECK (action IN ('view','similar_search','copy_template','contact','open')),
    verdict       TEXT CHECK (verdict IN ('good','market','high','unknown')),
    confidence    TEXT CHECK (confidence IN ('low','mid','high')),
    price         NUMERIC(12,2),
    currency      TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_actions_user_time ON listing_actions (user_id, created_at DESC);
CREATE INDEX idx_actions_user_listing ON listing_actions (user_id, listing_url);

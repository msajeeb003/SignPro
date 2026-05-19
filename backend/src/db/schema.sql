-- =====================================================================
-- SignPro - Legal Document Signing Application
-- PostgreSQL Schema
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =====================================================================
-- ENUM TYPES
-- =====================================================================

DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'sender', 'signer', 'auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE document_status AS ENUM (
        'uploaded', 'parsing', 'ready', 'sent', 'partially_signed',
        'completed', 'declined', 'expired', 'voided', 'failed'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE document_type AS ENUM ('pdf', 'docx');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE signature_request_status AS ENUM (
        'pending', 'viewed', 'signed', 'declined', 'expired', 'cancelled'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE signature_field_type AS ENUM (
        'signature', 'initial', 'date', 'text', 'checkbox', 'name', 'email'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_channel AS ENUM ('email', 'sms', 'extension', 'webhook', 'in_app');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM ('queued', 'sent', 'delivered', 'failed', 'bounced', 'read');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE audit_action AS ENUM (
        'user_registered', 'user_login', 'user_logout', 'password_changed',
        'document_uploaded', 'document_parsed', 'document_sent', 'document_viewed',
        'document_signed', 'document_declined', 'document_voided', 'document_downloaded',
        'signature_request_created', 'signature_request_resent',
        'smtp_configured', 'sms_dispatched', 'email_dispatched', 'extension_notified',
        'verification_attempted', 'verification_succeeded', 'verification_failed'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =====================================================================
-- USERS
-- =====================================================================

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           CITEXT NOT NULL UNIQUE,
    phone_number    VARCHAR(32),
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'sender',
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret      VARCHAR(255),
    last_login_at   TIMESTAMPTZ,
    last_login_ip   INET,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active) WHERE is_active = TRUE;

-- =====================================================================
-- USER SESSIONS (refresh tokens / device sessions)
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info     JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address      INET,
    user_agent      TEXT,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions (expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions (refresh_token_hash);

-- =====================================================================
-- SMTP CONFIGURATIONS (per user)
-- =====================================================================

CREATE TABLE IF NOT EXISTS smtp_configurations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL DEFAULT 'Default',
    host            VARCHAR(255) NOT NULL,
    port            INTEGER NOT NULL CHECK (port > 0 AND port <= 65535),
    secure          BOOLEAN NOT NULL DEFAULT FALSE,
    username        VARCHAR(255) NOT NULL,
    password_encrypted TEXT NOT NULL,
    from_name       VARCHAR(255) NOT NULL,
    from_address    VARCHAR(255) NOT NULL,
    reply_to        VARCHAR(255),
    is_default      BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    last_verified_at TIMESTAMPTZ,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_smtp_user ON smtp_configurations (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_smtp_default ON smtp_configurations (user_id) WHERE is_default = TRUE;

-- =====================================================================
-- DOCUMENTS
-- =====================================================================

CREATE TABLE IF NOT EXISTS documents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(500) NOT NULL,
    description     TEXT,
    document_type   document_type NOT NULL,
    status          document_status NOT NULL DEFAULT 'uploaded',
    original_filename VARCHAR(500) NOT NULL,
    stored_filename VARCHAR(500) NOT NULL,
    storage_path    TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    file_hash_sha256 VARCHAR(64) NOT NULL,
    page_count      INTEGER,
    page_dimensions JSONB,
    extracted_text  TEXT,
    rendered_pages  JSONB,
    parse_error     TEXT,
    expires_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents (owner_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents (status);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents (file_hash_sha256);
CREATE INDEX IF NOT EXISTS idx_documents_expires ON documents (expires_at) WHERE status NOT IN ('completed', 'voided', 'expired');

-- =====================================================================
-- SIGNATURE REQUESTS (one per recipient per document)
-- =====================================================================

CREATE TABLE IF NOT EXISTS signature_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signer_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    signer_email    VARCHAR(255) NOT NULL,
    signer_name     VARCHAR(255) NOT NULL,
    signer_phone    VARCHAR(32),
    signing_order   INTEGER NOT NULL DEFAULT 1,
    status          signature_request_status NOT NULL DEFAULT 'pending',
    access_token    VARCHAR(255) NOT NULL UNIQUE,
    access_token_expires_at TIMESTAMPTZ NOT NULL,
    message         TEXT,
    sent_at         TIMESTAMPTZ,
    first_viewed_at TIMESTAMPTZ,
    signed_at       TIMESTAMPTZ,
    declined_at     TIMESTAMPTZ,
    decline_reason  TEXT,
    sign_ip_address INET,
    sign_user_agent TEXT,
    sign_geolocation JSONB,
    verification_code VARCHAR(10),
    verification_attempts INTEGER NOT NULL DEFAULT 0,
    reminder_count  INTEGER NOT NULL DEFAULT 0,
    last_reminder_at TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sig_requests_document ON signature_requests (document_id);
CREATE INDEX IF NOT EXISTS idx_sig_requests_sender ON signature_requests (sender_id);
CREATE INDEX IF NOT EXISTS idx_sig_requests_signer_user ON signature_requests (signer_user_id);
CREATE INDEX IF NOT EXISTS idx_sig_requests_signer_email ON signature_requests (signer_email);
CREATE INDEX IF NOT EXISTS idx_sig_requests_status ON signature_requests (status);
CREATE INDEX IF NOT EXISTS idx_sig_requests_token ON signature_requests (access_token);
CREATE INDEX IF NOT EXISTS idx_sig_requests_pending_signer ON signature_requests (signer_user_id, status)
    WHERE status IN ('pending', 'viewed');

-- =====================================================================
-- SIGNATURE COORDINATES (placement fields on documents)
-- =====================================================================

CREATE TABLE IF NOT EXISTS signature_coordinates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    field_type      signature_field_type NOT NULL DEFAULT 'signature',
    page_number     INTEGER NOT NULL CHECK (page_number >= 1),
    x_position      NUMERIC(10,4) NOT NULL,
    y_position      NUMERIC(10,4) NOT NULL,
    width           NUMERIC(10,4) NOT NULL,
    height          NUMERIC(10,4) NOT NULL,
    page_width      NUMERIC(10,4) NOT NULL,
    page_height     NUMERIC(10,4) NOT NULL,
    is_required     BOOLEAN NOT NULL DEFAULT TRUE,
    label           VARCHAR(255),
    placeholder     VARCHAR(255),
    signed_value    TEXT,
    signed_image_data TEXT,
    signed_at       TIMESTAMPTZ,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sig_coords_request ON signature_coordinates (signature_request_id);
CREATE INDEX IF NOT EXISTS idx_sig_coords_document ON signature_coordinates (document_id);
CREATE INDEX IF NOT EXISTS idx_sig_coords_page ON signature_coordinates (document_id, page_number);

-- =====================================================================
-- SIGNATURE EVIDENCE (cryptographic proof of signing event)
-- =====================================================================

CREATE TABLE IF NOT EXISTS signature_evidence (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    signature_request_id UUID NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    signer_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    signed_document_hash VARCHAR(64) NOT NULL,
    signature_hmac  VARCHAR(128) NOT NULL,
    signed_pdf_path TEXT,
    certificate_serial VARCHAR(255),
    timestamp_token TEXT,
    consent_text    TEXT NOT NULL,
    consent_accepted_at TIMESTAMPTZ NOT NULL,
    ip_address      INET NOT NULL,
    user_agent      TEXT NOT NULL,
    geolocation     JSONB,
    verification_method VARCHAR(50),
    verification_value VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sig_evidence_request ON signature_evidence (signature_request_id);
CREATE INDEX IF NOT EXISTS idx_sig_evidence_doc ON signature_evidence (document_id);
CREATE INDEX IF NOT EXISTS idx_sig_evidence_hash ON signature_evidence (signed_document_hash);

-- =====================================================================
-- AUDIT TRAIL (immutable log of all actions)
-- =====================================================================

CREATE TABLE IF NOT EXISTS audit_trails (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_email     VARCHAR(255),
    action          audit_action NOT NULL,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID,
    document_id     UUID REFERENCES documents(id) ON DELETE SET NULL,
    signature_request_id UUID REFERENCES signature_requests(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    request_id      VARCHAR(64),
    previous_state  JSONB,
    new_state       JSONB,
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    chain_hash      VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_trails (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_document ON audit_trails (document_id);
CREATE INDEX IF NOT EXISTS idx_audit_sig_request ON audit_trails (signature_request_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_trails (action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_trails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trails (entity_type, entity_id);

-- Prevent updates/deletes on audit_trails (append-only)
CREATE OR REPLACE FUNCTION audit_immutable() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_trails is append-only - operation % not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_audit_changes ON audit_trails;
CREATE TRIGGER prevent_audit_changes
    BEFORE UPDATE OR DELETE ON audit_trails
    FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- =====================================================================
-- NOTIFICATION LOGS
-- =====================================================================

CREATE TABLE IF NOT EXISTS notification_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    signature_request_id UUID REFERENCES signature_requests(id) ON DELETE CASCADE,
    document_id     UUID REFERENCES documents(id) ON DELETE CASCADE,
    channel         notification_channel NOT NULL,
    status          notification_status NOT NULL DEFAULT 'queued',
    recipient       VARCHAR(255) NOT NULL,
    subject         VARCHAR(500),
    body_preview    TEXT,
    provider        VARCHAR(50),
    provider_message_id VARCHAR(255),
    provider_response JSONB,
    error_message   TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    max_retries     INTEGER NOT NULL DEFAULT 3,
    next_retry_at   TIMESTAMPTZ,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON notification_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_notif_sig_request ON notification_logs (signature_request_id);
CREATE INDEX IF NOT EXISTS idx_notif_status ON notification_logs (status);
CREATE INDEX IF NOT EXISTS idx_notif_channel ON notification_logs (channel);
CREATE INDEX IF NOT EXISTS idx_notif_retry ON notification_logs (next_retry_at) WHERE status = 'failed' AND retry_count < max_retries;
CREATE INDEX IF NOT EXISTS idx_notif_unread_extension ON notification_logs (user_id, channel, read_at)
    WHERE channel = 'extension' AND read_at IS NULL;

-- =====================================================================
-- EXTENSION POLLING TOKENS (long-lived API tokens for browser extension)
-- =====================================================================

CREATE TABLE IF NOT EXISTS extension_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL DEFAULT 'Browser Extension',
    last_polled_at  TIMESTAMPTZ,
    last_polled_ip  INET,
    poll_count      INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ext_token_user ON extension_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_ext_token_hash ON extension_tokens (token_hash) WHERE revoked_at IS NULL;

-- =====================================================================
-- WEBHOOK SUBSCRIPTIONS
-- =====================================================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    secret          VARCHAR(255) NOT NULL,
    events          TEXT[] NOT NULL DEFAULT ARRAY['*']::TEXT[],
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at TIMESTAMPTZ,
    failure_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_user ON webhook_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_active ON webhook_subscriptions (is_active) WHERE is_active = TRUE;

-- =====================================================================
-- TRIGGERS: auto-update updated_at
-- =====================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
             WHERE column_name = 'updated_at' AND table_schema = 'public'
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;', t, t);
        EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION set_updated_at();', t, t);
    END LOOP;
END $$;

-- =====================================================================
-- VIEWS for common queries
-- =====================================================================

CREATE OR REPLACE VIEW v_pending_signatures_for_user AS
SELECT
    sr.id AS signature_request_id,
    sr.signer_user_id,
    sr.signer_email,
    sr.signer_name,
    sr.status,
    sr.expires_at,
    sr.access_token,
    sr.sent_at,
    sr.first_viewed_at,
    d.id AS document_id,
    d.title AS document_title,
    d.document_type,
    d.page_count,
    d.status AS document_status,
    u.full_name AS sender_name,
    u.email AS sender_email,
    sr.created_at
FROM signature_requests sr
JOIN documents d ON d.id = sr.document_id
JOIN users u ON u.id = sr.sender_id
WHERE sr.status IN ('pending', 'viewed')
  AND sr.expires_at > NOW();

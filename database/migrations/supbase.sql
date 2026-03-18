-- ================================================================
-- UNIVERSAL DAY BOOK - CLEAN CONSOLIDATED DATABASE SCHEMA
-- Version: 2.0.0 (Single source of truth, de-duplicated, idempotent)
-- Includes: Units, Masters, Masters, Sessions/Vouchers,
--           Templates, FY system, Voucher sequencing, Bank refs,
--           Audit logs, RLS + Roles/Permissions, Admin RPCs
-- ================================================================

-- -----------------------------
-- 0) EXTENSIONS
-- -----------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ================================================================
-- 1) MASTER CONFIGURATION TABLES
-- ================================================================





-- UOMs (Units of Measure)
CREATE TABLE IF NOT EXISTS public.uoms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    uom_type VARCHAR(20) NOT NULL CHECK (uom_type IN ('CURRENCY', 'WEIGHT', 'COUNT')),
    precision INTEGER NOT NULL DEFAULT 2,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ledger Groups (Chart of Accounts Grouping)
CREATE TABLE IF NOT EXISTS public.ledger_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_name VARCHAR(100) NOT NULL UNIQUE,
    nature VARCHAR(20) NOT NULL CHECK (nature IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY')),
    parent_group_id UUID REFERENCES public.ledger_groups(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ledger Tags (Business Classification)
CREATE TABLE IF NOT EXISTS public.ledger_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tag_name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Party Groups
CREATE TABLE IF NOT EXISTS public.party_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voucher Groups
CREATE TABLE IF NOT EXISTS public.voucher_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Template Groups
CREATE TABLE IF NOT EXISTS public.template_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Financial Years
CREATE TABLE IF NOT EXISTS public.financial_years (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE, -- ex: "FY 2025-26"
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    is_closed BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_fy_dates CHECK (start_date < end_date)
);

-- System Config (Singleton)
CREATE TABLE IF NOT EXISTS public.system_configurations (
    id UUID PRIMARY KEY,
    current_financial_year_id UUID REFERENCES public.financial_years(id),
    allow_backdated_posting BOOLEAN DEFAULT FALSE,
    backdate_limit_days INTEGER DEFAULT 0,
    allow_cross_fy_reports BOOLEAN DEFAULT FALSE,
    require_device_auth BOOLEAN DEFAULT FALSE,

    business_name VARCHAR(200),
    business_address TEXT,
    business_gstin VARCHAR(15),
    business_phone VARCHAR(20),
    business_email VARCHAR(100),
    business_logo_url TEXT,

    customer_id_prefix VARCHAR(10) DEFAULT 'CU',
    customer_id_start_number INTEGER DEFAULT 1,
    enable_txn_approvals BOOLEAN DEFAULT TRUE,

    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Staff Profiles (Human Identity)
CREATE TABLE IF NOT EXISTS public.staff_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_name VARCHAR(200) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    designation VARCHAR(100),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Profiles (Link Identity to Auth)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    is_super_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Roles
CREATE TABLE IF NOT EXISTS public.roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    category VARCHAR(20) DEFAULT 'JOB' CHECK (category IN ('ADMIN', 'JOB')),
    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Org Access (Scoped Permissions)
CREATE TABLE IF NOT EXISTS public.user_org_access (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES public.roles(id) ON DELETE CASCADE,
    scope_type VARCHAR(20) NOT NULL CHECK (scope_type IN ('GLOBAL')),
    scope_id UUID,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Devices
CREATE TABLE IF NOT EXISTS public.devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_name VARCHAR(100) NOT NULL,
    device_fingerprint VARCHAR(255) NOT NULL, -- Uniqueness removed to allow multiple logical terminals per hardware ID
    is_authorized BOOLEAN DEFAULT FALSE,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lookup performance (since UNIQUE constraint provided one implicitly before)
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON public.devices(device_fingerprint);

-- ================================================================
-- 2) CORE MASTER TABLES
-- ================================================================

-- Ledgers (Master Chart of Accounts)
CREATE TABLE IF NOT EXISTS public.ledgers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_name VARCHAR(200) NOT NULL UNIQUE,
    ledger_group_id UUID REFERENCES public.ledger_groups(id) NOT NULL,
    business_tags UUID[] DEFAULT '{}',
    nature VARCHAR(20) NOT NULL CHECK (nature IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY')),
    normal_side VARCHAR(2) NOT NULL CHECK (normal_side IN ('DR', 'CR')),

    opening_balance DECIMAL(15, 2) DEFAULT 0,
    opening_balance_side VARCHAR(2) CHECK (opening_balance_side IN ('DR', 'CR')),

    is_active BOOLEAN DEFAULT TRUE,
    allow_party BOOLEAN DEFAULT FALSE,
    is_cash_bank BOOLEAN DEFAULT FALSE,

    -- Units / Quantity
    default_uom_id UUID REFERENCES public.uoms(id),
    allow_quantity BOOLEAN DEFAULT FALSE,
    quantity_required BOOLEAN DEFAULT FALSE,

    -- Branch

    -- Bank Meta (optional, only for bank-type ledgers)
    bank_name VARCHAR(100),
    bank_account_no VARCHAR(50),
    bank_ifsc VARCHAR(20),
    bank_branch VARCHAR(100),
    sib_rap_prefix VARCHAR(50),

    is_system BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Parties (Enhanced Profile)
CREATE TABLE IF NOT EXISTS public.parties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES public.party_groups(id) ON DELETE SET NULL,
    party_name VARCHAR(200) NOT NULL,
    party_type VARCHAR(20) CHECK (party_type IN ('CUSTOMER', 'VENDOR', 'BOTH')),

    contact_person VARCHAR(100),
    phone VARCHAR(20),
    phone_country_code VARCHAR(10) DEFAULT '+91',
    whatsapp_active BOOLEAN DEFAULT TRUE,
    customer_id VARCHAR(50),

    email VARCHAR(100),
    address TEXT,
    pincode VARCHAR(10),

    gender VARCHAR(20),
    dob DATE,
    religion VARCHAR(50),
    occupation VARCHAR(100),

    aadhar_no VARCHAR(20),
    gstin VARCHAR(15),

    -- Opening balance for party-as-subledger use
    opening_balance DECIMAL(15, 2) DEFAULT 0,
    opening_balance_side VARCHAR(2) CHECK (opening_balance_side IN ('DR', 'CR')),

    is_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Party Bank Accounts (Normalized)
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id UUID REFERENCES public.parties(id) ON DELETE CASCADE,
    bank_name VARCHAR(100) NOT NULL,
    bank_account_no VARCHAR(50) NOT NULL,
    bank_ifsc VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voucher Types
CREATE TABLE IF NOT EXISTS public.voucher_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES public.voucher_groups(id) ON DELETE SET NULL,

    type_code VARCHAR(50) NOT NULL UNIQUE,
    type_name VARCHAR(100) NOT NULL,
    prefix VARCHAR(10) NOT NULL,

    is_active BOOLEAN DEFAULT TRUE,

    voucher_nature VARCHAR(20) NOT NULL DEFAULT 'JOURNAL'
        CHECK (voucher_nature IN ('RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL', 'SALE', 'PURCHASE')),

    cash_bank_flow VARCHAR(20) NOT NULL DEFAULT 'NEUTRAL'
        CHECK (cash_bank_flow IN ('INFLOW', 'OUTFLOW', 'NEUTRAL')),

    party_rule VARCHAR(20) NOT NULL DEFAULT 'OPTIONAL'
        CHECK (party_rule IN ('MANDATORY', 'OPTIONAL', 'NOT_ALLOWED')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 3) TEMPLATE SYSTEM (created BEFORE vouchers template FK is added)
-- ================================================================

-- Rapid Templates
CREATE TABLE IF NOT EXISTS public.rapid_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_name VARCHAR(100) NOT NULL,
    template_code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    group_id UUID REFERENCES public.template_groups(id) ON DELETE SET NULL,
    voucher_type_id UUID REFERENCES public.voucher_types(id),
    is_active BOOLEAN DEFAULT TRUE,
    rounding_rule TEXT DEFAULT 'ROUND' CHECK (rounding_rule IN ('ROUND', 'UP', 'DOWN', 'NONE')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Template ↔ Voucher Types (Many-to-Many)
CREATE TABLE IF NOT EXISTS public.template_voucher_types (
    template_id UUID REFERENCES public.rapid_templates(id) ON DELETE CASCADE,
    voucher_type_id UUID REFERENCES public.voucher_types(id) ON DELETE CASCADE,
    PRIMARY KEY (template_id, voucher_type_id)
);

-- Template Lines
CREATE TABLE IF NOT EXISTS public.template_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID REFERENCES public.rapid_templates(id) ON DELETE CASCADE NOT NULL,
    line_number INTEGER NOT NULL,

    ledger_id UUID REFERENCES public.ledgers(id),
    default_side VARCHAR(2) NOT NULL CHECK (default_side IN ('DR', 'CR')),
    is_fixed_side BOOLEAN DEFAULT TRUE,
    is_required BOOLEAN DEFAULT TRUE,

    amount_rule VARCHAR(20) DEFAULT 'INPUT' CHECK (amount_rule IN ('INPUT', 'FIXED', 'CALCULATED')),
    amount_value DECIMAL(16,2) DEFAULT 0,
    calc_formula TEXT,

    input_key TEXT,
    link_key TEXT,

    line_narration_default TEXT,
    external_ref_hint TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(template_id, line_number)
);

-- ================================================================
-- 4) TRANSACTION TABLES
-- ================================================================

-- Transaction Sessions (Parent Container)
CREATE TABLE IF NOT EXISTS public.transaction_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    party_id UUID REFERENCES public.parties(id) NOT NULL,
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    narration TEXT,
    session_ref VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'CANCELLED')),
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vouchers (Transaction Headers)
CREATE TABLE IF NOT EXISTS public.vouchers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    session_id UUID REFERENCES public.transaction_sessions(id) ON DELETE CASCADE,
    voucher_no VARCHAR(50) NOT NULL UNIQUE,

    voucher_type_id UUID REFERENCES public.voucher_types(id) NOT NULL,
    voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,

    narration TEXT NOT NULL,
    reference_no VARCHAR(100),

    party_id UUID REFERENCES public.parties(id),

    total_debit DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_credit DECIMAL(15, 2) NOT NULL DEFAULT 0,

    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'REVERSED')),
    reversed_voucher_id UUID REFERENCES public.vouchers(id),
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    posted_at TIMESTAMPTZ,

    -- Financial Year tagging (assigned by trigger)
    financial_year_id UUID REFERENCES public.financial_years(id),

    -- Bank workflow fields
    bank_status VARCHAR(20) DEFAULT 'NONE'
        CHECK (bank_status IN ('PENDING', 'APPROVED', 'REJECTED', 'SENT_FOR_APPROVAL', 'FINAL_APPROVED', 'NONE')),
    approval_status VARCHAR(20) DEFAULT 'NOT_REQUIRED'
        CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED', 'NOT_REQUIRED')),

    sender_bank_account_id UUID REFERENCES public.ledgers(id), -- paying bank ledger
    bank_validation_status TEXT DEFAULT 'NONE' -- NONE / VALID / INVALID / etc.
);

-- Add template_id FK AFTER vouchers exists (avoid order problems)
ALTER TABLE public.vouchers
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.rapid_templates(id) ON DELETE SET NULL;

-- Voucher Lines
CREATE TABLE IF NOT EXISTS public.voucher_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID REFERENCES public.vouchers(id) ON DELETE CASCADE NOT NULL,
    line_number INTEGER NOT NULL,

    ledger_id UUID REFERENCES public.ledgers(id) NOT NULL,
    party_id UUID REFERENCES public.parties(id),

    side VARCHAR(2) NOT NULL CHECK (side IN ('DR', 'CR')),

    amount DECIMAL(15, 2) NOT NULL CHECK (amount >= 0),

    line_narration TEXT,
    external_ref VARCHAR(100),

    quantity DECIMAL(16, 4),
    uom_id UUID REFERENCES public.uoms(id),
    rate DECIMAL(16, 4),
    valuation_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Bank Reconciliation Fields
    recon_status VARCHAR(20) DEFAULT 'UNRECONCILED' CHECK (recon_status IN ('UNRECONCILED', 'RECONCILED')),
    recon_date DATE,
    statement_ref TEXT,
    matched_statement_id UUID, -- Link to bank_statement_items
    recon_audit JSONB, -- store {reconciled_by, reconciled_at}

    UNIQUE(voucher_id, line_number)
);

-- Backfill reconciliation columns for already existing voucher_lines table
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_status VARCHAR(20) DEFAULT 'UNRECONCILED' CHECK (recon_status IN ('UNRECONCILED', 'RECONCILED'));
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_date DATE;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS statement_ref TEXT;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS matched_statement_id UUID;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_audit JSONB;

-- Hard Consistency Constraint: Ensure status and linkage are always in sync
ALTER TABLE public.voucher_lines DROP CONSTRAINT IF EXISTS chk_voucher_line_recon_integrity;
ALTER TABLE public.voucher_lines ADD CONSTRAINT chk_voucher_line_recon_integrity 
CHECK ((recon_status = 'RECONCILED' AND matched_statement_id IS NOT NULL AND recon_date IS NOT NULL) 
    OR (recon_status = 'UNRECONCILED' AND matched_statement_id IS NULL AND recon_date IS NULL));



-- Approval Requests
CREATE TABLE IF NOT EXISTS public.approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    payload JSONB NOT NULL,
    reason TEXT,
    requested_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    target_scope_id UUID,
    approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    decision_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

-- Bank Statement Items (Truth Feed from Bank)
CREATE TABLE IF NOT EXISTS public.bank_statement_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ledger_id UUID REFERENCES public.ledgers(id) NOT NULL,
    txn_date DATE NOT NULL,
    description TEXT,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount >= 0),
    direction VARCHAR(2) NOT NULL CHECK (direction IN ('DR', 'CR')), -- Bank's view
    reference TEXT,
    match_status VARCHAR(20) DEFAULT 'UNMATCHED' CHECK (match_status IN ('UNMATCHED', 'MATCHED', 'IGNORED')),
    matched_book_line_id UUID REFERENCES public.voucher_lines(id) ON DELETE SET NULL,
    import_batch_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Hard Consistency Constraint: Ensure status and linkage are always in sync
    CONSTRAINT chk_bank_item_recon_integrity CHECK (
        (match_status = 'MATCHED' AND matched_book_line_id IS NOT NULL) OR 
        (match_status != 'MATCHED' AND matched_book_line_id IS NULL)
    ),
    -- Deterministic dedup fingerprint of the bank row's natural identity
    row_hash TEXT GENERATED ALWAYS AS (
        md5(ledger_id::TEXT || txn_date::TEXT || COALESCE(description,'') || amount::TEXT || direction || COALESCE(reference,''))
    ) STORED
);

-- Backfill row_hash for existing rows using generation expression (safe to re-run)
ALTER TABLE public.bank_statement_items
    ADD COLUMN IF NOT EXISTS row_hash TEXT 
    GENERATED ALWAYS AS (
        md5(ledger_id::TEXT || txn_date::TEXT || COALESCE(description,'') || amount::TEXT || direction || COALESCE(reference,''))
    ) STORED;

-- Clean up existing duplicates before index creation (keeps only the oldest row)
DELETE FROM public.bank_statement_items a
USING public.bank_statement_items b
WHERE (a.created_at, a.id) > (b.created_at, b.id)
  AND a.row_hash = b.row_hash;

DROP INDEX IF EXISTS uidx_bank_stmt_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_bank_stmt_dedup
    ON public.bank_statement_items (row_hash);

-- Enforce referential integrity for bank reconciliation (Bidirectional Link)
-- This MUST be added after both tables exist to avoid fresh migration ordering issues
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_voucher_lines_matched_statement'
    ) THEN
        ALTER TABLE public.voucher_lines
        ADD CONSTRAINT fk_voucher_lines_matched_statement
        FOREIGN KEY (matched_statement_id)
        REFERENCES public.bank_statement_items(id)
        ON DELETE SET NULL;
    END IF;
END $$;


-- System Audit Logs
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    staff_id UUID REFERENCES public.staff_profiles(id) ON DELETE SET NULL,
    device_id UUID REFERENCES public.devices(id),
    action_type VARCHAR(50) NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id UUID,
    old_data JSONB,
    new_data JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    client_ip VARCHAR(45),
    user_agent TEXT
);

-- Voucher Attachments
CREATE TABLE IF NOT EXISTS public.voucher_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID REFERENCES public.vouchers(id) ON DELETE CASCADE NOT NULL,
    file_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    uploaded_by VARCHAR(100),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 5) BANK EXPORT / REFERENCE SYSTEM (Prefix + Daily Counter)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.reference_prefixes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prefix VARCHAR(10) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one default prefix exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_default_prefix
ON public.reference_prefixes (is_default)
WHERE (is_default = true);

CREATE TABLE IF NOT EXISTS public.reference_counters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prefix_id UUID REFERENCES public.reference_prefixes(id) ON DELETE CASCADE,
    counter_date DATE NOT NULL DEFAULT CURRENT_DATE,
    last_number INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(prefix_id, counter_date)
);

CREATE TABLE IF NOT EXISTS public.bank_txn_exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_ids UUID[] NOT NULL,
    prefix_id UUID REFERENCES public.reference_prefixes(id),
    reference_no VARCHAR(20) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    sender_bank_account_id UUID REFERENCES public.ledgers(id),
    payment_method VARCHAR(20), -- NEFT, IMPS, RTGS, SIB
    payload_json JSONB,
    generated_by UUID, -- auth.users.id optional
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 6) SEQUENCING
-- ================================================================

CREATE TABLE IF NOT EXISTS public.voucher_sequences (
    voucher_type_id UUID PRIMARY KEY REFERENCES public.voucher_types(id) ON DELETE CASCADE,
    next_number INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voucher Number Generator
CREATE OR REPLACE FUNCTION public.get_next_voucher_number(p_voucher_type_id UUID)
RETURNS VARCHAR AS $$
DECLARE
    v_prefix VARCHAR(10);
    v_next INT;
BEGIN
    SELECT prefix INTO v_prefix
    FROM public.voucher_types
    WHERE id = p_voucher_type_id;

    IF v_prefix IS NULL THEN
        RAISE EXCEPTION 'Invalid voucher_type_id: %', p_voucher_type_id;
    END IF;

    INSERT INTO public.voucher_sequences (voucher_type_id, next_number)
    VALUES (p_voucher_type_id, 1)
    ON CONFLICT (voucher_type_id) DO NOTHING;

    SELECT next_number INTO v_next
    FROM public.voucher_sequences
    WHERE voucher_type_id = p_voucher_type_id
    FOR UPDATE;

    UPDATE public.voucher_sequences
    SET next_number = next_number + 1,
        updated_at = NOW()
    WHERE voucher_type_id = p_voucher_type_id;

    RETURN v_prefix || '-' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 7) AUDIT TRIGGER (Generic)
-- ================================================================

CREATE OR REPLACE FUNCTION public.log_table_changes()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    BEGIN
    EXCEPTION WHEN undefined_column THEN
    END;

    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.system_audit_logs (user_id, action_type, table_name, record_id, new_data)
        VALUES (v_user_id, 'INSERT', TG_TABLE_NAME, NEW.id, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF row_to_json(OLD)::jsonb != row_to_json(NEW)::jsonb THEN
            INSERT INTO public.system_audit_logs (user_id, action_type, table_name, record_id, old_data, new_data)
            VALUES (v_user_id, 'UPDATE', TG_TABLE_NAME, NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        END IF;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.system_audit_logs (user_id, action_type, table_name, record_id, old_data)
        VALUES (v_user_id, 'DELETE', TG_TABLE_NAME, OLD.id, row_to_json(OLD)::jsonb);
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Attach audit triggers (only where you explicitly want them)
DROP TRIGGER IF EXISTS audit_system_configurations ON public.system_configurations;
CREATE TRIGGER audit_system_configurations
AFTER UPDATE ON public.system_configurations
FOR EACH ROW EXECUTE FUNCTION public.log_table_changes();

DROP TRIGGER IF EXISTS audit_roles ON public.roles;
CREATE TRIGGER audit_roles
AFTER INSERT OR UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.log_table_changes();

DROP TRIGGER IF EXISTS audit_vouchers_update ON public.vouchers;
CREATE TRIGGER audit_vouchers_update
AFTER UPDATE ON public.vouchers
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.total_debit IS DISTINCT FROM NEW.total_debit OR OLD.total_credit IS DISTINCT FROM NEW.total_credit)
EXECUTE FUNCTION public.log_table_changes();

-- ================================================================
-- 8) CORE RPCs
-- ================================================================

-- Save Voucher (optimistic lock)
DROP FUNCTION IF EXISTS public.save_voucher_v1(UUID, UUID, UUID, DATE, TEXT, VARCHAR, UUID, UUID, DECIMAL, DECIMAL, VARCHAR, VARCHAR, VARCHAR, JSONB, TIMESTAMPTZ, UUID);
CREATE OR REPLACE FUNCTION public.save_voucher_v1(
    p_voucher_id UUID,
    p_voucher_type_id UUID,
    p_template_id UUID,
    p_voucher_date DATE,
    p_narration TEXT,
    p_reference_no VARCHAR,
    p_party_id UUID,
    p_session_id UUID,
    p_total_debit DECIMAL,
    p_total_credit DECIMAL,
    p_status VARCHAR,
    p_bank_status VARCHAR,
    p_approval_status VARCHAR,
    p_lines JSONB,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_voucher_id UUID := p_voucher_id;
    v_voucher_no VARCHAR;
    v_line RECORD;
    v_index INTEGER := 1;
    v_current_updated_at TIMESTAMPTZ;
BEGIN
    -- Optimistic lock
    IF v_voucher_id IS NOT NULL THEN
        SELECT updated_at INTO v_current_updated_at FROM public.vouchers WHERE id = v_voucher_id;
        IF p_expected_updated_at IS NOT NULL AND v_current_updated_at > p_expected_updated_at THEN
            RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR: Record modified by another user.';
        END IF;
    END IF;

    IF COALESCE(p_status, 'DRAFT') != 'DRAFT' AND ABS(p_total_debit - p_total_credit) > 0.01 THEN
        RAISE EXCEPTION 'Debit (%) must equal Credit (%)', p_total_debit, p_total_credit;
    END IF;

    IF v_voucher_id IS NOT NULL THEN
        -- Integrity Check: Cannot modify lines of a reconciled voucher
        IF EXISTS (SELECT 1 FROM public.voucher_lines WHERE voucher_id = v_voucher_id AND recon_status = 'RECONCILED') THEN
            RAISE EXCEPTION 'VOUCHER_LOCKED: Cannot modify reconciled voucher (%). Please unreconcile first.', v_voucher_id;
        END IF;

        UPDATE public.vouchers SET
            voucher_type_id = p_voucher_type_id,
            template_id = p_template_id,
            voucher_date = p_voucher_date,
            narration = p_narration,
            reference_no = p_reference_no,
            party_id = p_party_id,
            session_id = p_session_id,
            total_debit = p_total_debit,
            total_credit = p_total_credit,
            status = p_status,
            posted_at = CASE WHEN p_status = 'POSTED' AND posted_at IS NULL THEN NOW() ELSE posted_at END,
            bank_status = COALESCE(p_bank_status, bank_status),
            approval_status = COALESCE(p_approval_status, approval_status),
            updated_at = NOW()
        WHERE id = v_voucher_id;
    ELSE
        v_voucher_no := public.get_next_voucher_number(p_voucher_type_id);

        INSERT INTO public.vouchers (
            voucher_no, voucher_type_id, template_id, voucher_date, narration,
            reference_no, party_id, session_id, total_debit, total_credit,
            status, posted_at, bank_status, approval_status
        ) VALUES (
            v_voucher_no, p_voucher_type_id, p_template_id, p_voucher_date, p_narration,
            p_reference_no, p_party_id, p_session_id, p_total_debit, p_total_credit,
            p_status, CASE WHEN p_status = 'POSTED' THEN NOW() ELSE NULL END,
            COALESCE(p_bank_status, 'NONE'), COALESCE(p_approval_status, 'NOT_REQUIRED')
        ) RETURNING id INTO v_voucher_id;
    END IF;

    DELETE FROM public.voucher_lines WHERE voucher_id = v_voucher_id;

    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
        ledger_id UUID, party_id UUID, side VARCHAR, amount DECIMAL,
        line_narration TEXT, external_ref VARCHAR, quantity DECIMAL,
        uom_id UUID, rate DECIMAL, valuation_ref TEXT
    ) LOOP
        INSERT INTO public.voucher_lines (
            voucher_id, line_number, ledger_id, party_id, side, amount,
            line_narration, external_ref, quantity, uom_id, rate, valuation_ref) VALUES (
            v_voucher_id, v_index, v_line.ledger_id, v_line.party_id, v_line.side, v_line.amount,
            v_line.line_narration, v_line.external_ref, v_line.quantity, v_line.uom_id, v_line.rate, v_line.valuation_ref);
        v_index := v_index + 1;
    END LOOP;

    RETURN v_voucher_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Save Session (saves many vouchers, deletes removed ones)
CREATE OR REPLACE FUNCTION public.save_transaction_session_v1(
    p_session_id UUID,
    p_party_id UUID,
    p_session_date DATE,
    p_narration TEXT,
    p_session_ref VARCHAR,
    p_status VARCHAR,
    p_vouchers JSONB,
    p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
    p_audit_exception_reason TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_session_id UUID := p_session_id;
    v_voucher_data RECORD;
    v_voucher_ids_in_payload UUID[] := '{}';
    v_saved_voucher_id UUID;
    v_result_vouchers JSONB := '[]'::jsonb;
    v_saved_voucher JSONB;
    v_current_updated_at TIMESTAMPTZ;
BEGIN
    -- Optimistic lock
    IF v_session_id IS NOT NULL THEN
        SELECT updated_at INTO v_current_updated_at FROM public.transaction_sessions WHERE id = v_session_id;
        IF p_expected_updated_at IS NOT NULL AND v_current_updated_at > p_expected_updated_at THEN
            RAISE EXCEPTION 'OPTIMISTIC_LOCK_ERROR: Session modified by another user.';
        END IF;
    END IF;

    IF v_session_id IS NOT NULL THEN
        UPDATE public.transaction_sessions SET
            party_id = p_party_id,
            session_date = p_session_date,
            narration = p_narration,
            session_ref = p_session_ref,
            status = p_status,
            audit_exception_reason = p_audit_exception_reason,
            updated_at = NOW()
        WHERE id = v_session_id;
    ELSE
        INSERT INTO public.transaction_sessions (
            party_id, session_date, narration, session_ref, status, audit_exception_reason
        ) VALUES (
            p_party_id, p_session_date, p_narration, p_session_ref, p_status, p_audit_exception_reason
        ) RETURNING id INTO v_session_id;
    END IF;

    FOR v_voucher_data IN
        SELECT draft_id FROM jsonb_to_recordset(p_vouchers) AS x(draft_id UUID)
    LOOP
        IF v_voucher_data.draft_id IS NOT NULL THEN
            v_voucher_ids_in_payload := array_append(v_voucher_ids_in_payload, v_voucher_data.draft_id);
        END IF;
    END LOOP;

    -- Integrity Check: Cannot delete reconciled vouchers
    IF EXISTS (
        SELECT 1 FROM public.voucher_lines 
        WHERE voucher_id IN (
            SELECT id FROM public.vouchers 
            WHERE session_id = v_session_id 
              AND (v_voucher_ids_in_payload = '{}' OR id != ALL(v_voucher_ids_in_payload))
        ) AND recon_status = 'RECONCILED'
    ) THEN
        RAISE EXCEPTION 'SESSION_LOCKED: One or more vouchers are reconciled. Cannot delete reconciled records.';
    END IF;

    DELETE FROM public.vouchers
    WHERE session_id = v_session_id
      AND (v_voucher_ids_in_payload = '{}' OR id != ALL(v_voucher_ids_in_payload));

    FOR v_voucher_data IN SELECT * FROM jsonb_to_recordset(p_vouchers) AS x(
        draft_id UUID, ui_key TEXT, voucher_type_id UUID, template_id UUID,
        narration TEXT, reference_no VARCHAR, total_debit DECIMAL,
        total_credit DECIMAL, status VARCHAR, bank_status VARCHAR,
        approval_status VARCHAR, lines JSONB, expected_updated_at TIMESTAMPTZ
    ) LOOP
        v_saved_voucher_id := public.save_voucher_v1(
            v_voucher_data.draft_id,
            v_voucher_data.voucher_type_id,
            v_voucher_data.template_id,
            p_session_date,
            v_voucher_data.narration,
            v_voucher_data.reference_no,
            p_party_id,
            v_session_id,
            v_voucher_data.total_debit,
            v_voucher_data.total_credit,
            COALESCE(v_voucher_data.status, 'DRAFT'),
            COALESCE(v_voucher_data.bank_status, 'NONE'),
            COALESCE(v_voucher_data.approval_status, 'NOT_REQUIRED'),
            v_voucher_data.lines,
            v_voucher_data.expected_updated_at
        );

        SELECT jsonb_build_object(
            'id', v_saved_voucher_id,
            'ui_key', v_voucher_data.ui_key,
            'voucher_no', voucher_no,
            'status', status
        ) INTO v_saved_voucher
        FROM public.vouchers
        WHERE id = v_saved_voucher_id;

        v_result_vouchers := v_result_vouchers || v_saved_voucher;
    END LOOP;

    RETURN jsonb_build_object('id', v_session_id, 'vouchers', v_result_vouchers);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Voucher Reversal 
CREATE OR REPLACE FUNCTION public.reverse_voucher_v1(
    p_voucher_id UUID,
    p_reason TEXT
) RETURNS UUID AS $$
DECLARE
    v_original RECORD;
    v_reversal_id UUID;
    v_reversal_no VARCHAR;
    v_line RECORD;
    v_index INTEGER := 1;
BEGIN
    SELECT * INTO v_original FROM public.vouchers WHERE id = p_voucher_id;
    IF v_original.id IS NULL THEN RAISE EXCEPTION 'Voucher not found'; END IF;
    IF v_original.status = 'REVERSED' THEN RAISE EXCEPTION 'Voucher is already reversed'; END IF;

    v_reversal_no := 'REV-' || v_original.voucher_no;

    INSERT INTO public.vouchers (
        voucher_no, voucher_type_id, template_id, voucher_date, narration, reference_no,
        party_id, session_id, total_debit, total_credit,
        status, posted_at, bank_status, approval_status
    )
    VALUES (
        v_reversal_no, v_original.voucher_type_id, v_original.template_id, CURRENT_DATE,
        'REVERSAL: ' || v_original.narration || COALESCE(' | ' || p_reason, ''),
        v_original.reference_no, v_original.party_id, v_original.session_id,
        v_original.total_credit, v_original.total_debit,
        'POSTED', NOW(), v_original.bank_status, 'NOT_REQUIRED'
    )
    RETURNING id INTO v_reversal_id;

    FOR v_line IN SELECT * FROM public.voucher_lines WHERE voucher_id = p_voucher_id ORDER BY line_number LOOP
        INSERT INTO public.voucher_lines (
            voucher_id, line_number, ledger_id, party_id, side, amount,
            line_narration, external_ref, quantity, uom_id, rate, valuation_ref)
        VALUES (
            v_reversal_id, v_index, v_line.ledger_id, v_line.party_id,
            CASE WHEN v_line.side = 'DR' THEN 'CR' ELSE 'DR' END,
            v_line.amount,
            'Reversal: ' || COALESCE(v_line.line_narration, ''),
            v_line.external_ref, v_line.quantity, v_line.uom_id, v_line.rate, v_line.valuation_ref);
        v_index := v_index + 1;
    END LOOP;

    UPDATE public.vouchers
    SET status = 'REVERSED', reversed_voucher_id = v_reversal_id, updated_at = NOW()
    WHERE id = p_voucher_id;

    RETURN v_reversal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Reporting: Ledger Statement 
DROP FUNCTION IF EXISTS public.fetch_ledger_statement_v1(UUID, UUID, DATE, DATE, UUID, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.fetch_ledger_statement_v1(
    p_ledger_id UUID DEFAULT NULL,
    p_party_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL,
    p_limit INTEGER DEFAULT 1000,
    p_offset INTEGER DEFAULT 0
) RETURNS JSONB AS $$
DECLARE
    v_nature VARCHAR;
    v_balance_bf DECIMAL := 0;
    v_quantity_bf DECIMAL := 0;
    v_party_opening DECIMAL := 0;
    v_party_opening_side VARCHAR;
    v_party_type VARCHAR;
    v_is_asset_or_expense BOOLEAN;
    v_ledger_name VARCHAR;
    v_result_lines JSONB;
    v_balance_bf_calc DECIMAL := 0;
    v_quantity_bf_calc DECIMAL := 0;
BEGIN
    IF p_ledger_id IS NOT NULL THEN
        SELECT nature, opening_balance, ledger_name
        INTO v_nature, v_balance_bf, v_ledger_name
        FROM public.ledgers WHERE id = p_ledger_id;
    ELSE
        SELECT party_type, opening_balance, opening_balance_side
        INTO v_party_type, v_party_opening, v_party_opening_side
        FROM public.parties WHERE id = p_party_id;

        v_nature := CASE WHEN v_party_type = 'VENDOR' THEN 'LIABILITY' ELSE 'ASSET' END;
        v_balance_bf := 0;
    END IF;

    v_is_asset_or_expense := v_nature IN ('ASSET', 'EXPENSE');

    IF p_start_date IS NOT NULL THEN
        SELECT
            SUM(
                CASE
                    WHEN v_is_asset_or_expense THEN (CASE WHEN side = 'DR' THEN amount ELSE -amount END)
                    ELSE (CASE WHEN side = 'CR' THEN amount ELSE -amount END)
                END
            ),
            SUM(
                CASE
                    WHEN v_is_asset_or_expense THEN (CASE WHEN side = 'DR' THEN COALESCE(quantity,0) ELSE -COALESCE(quantity,0) END)
                    ELSE (CASE WHEN side = 'CR' THEN COALESCE(quantity,0) ELSE -COALESCE(quantity,0) END)
                END
            )
        INTO v_balance_bf_calc, v_quantity_bf_calc
        FROM public.voucher_lines vl
        JOIN public.vouchers v ON vl.voucher_id = v.id
        LEFT JOIN public.ledgers l ON vl.ledger_id = l.id
        WHERE v.status IN ('POSTED', 'REVERSED')
          AND v.voucher_date < p_start_date
          AND (p_ledger_id IS NULL OR vl.ledger_id = p_ledger_id)
          AND (p_party_id IS NULL OR vl.party_id = p_party_id OR v.party_id = p_party_id)
          AND (p_ledger_id IS NOT NULL OR l.is_cash_bank = FALSE);

        v_balance_bf := v_balance_bf + COALESCE(v_balance_bf_calc, 0);
        v_quantity_bf := COALESCE(v_quantity_bf_calc, 0);
    END IF;

    SELECT jsonb_agg(t) INTO v_result_lines
    FROM (
        SELECT
            vl.id, vl.side, vl.amount, vl.quantity, vl.line_narration,
            vl.external_ref, vl.ledger_id, l.ledger_name,
            l.nature AS ledger_nature, u.code AS uom_code,
            v.voucher_date, v.voucher_no, v.narration AS voucher_narration,
            v.created_at, (v.status = 'REVERSED') as is_reversed
        FROM public.voucher_lines vl
        JOIN public.vouchers v ON vl.voucher_id = v.id
        LEFT JOIN public.ledgers l ON vl.ledger_id = l.id
        LEFT JOIN public.uoms u ON vl.uom_id = u.id
        WHERE v.status IN ('POSTED', 'REVERSED')
          AND (p_ledger_id IS NULL OR vl.ledger_id = p_ledger_id)
          AND (p_party_id IS NULL OR vl.party_id = p_party_id OR v.party_id = p_party_id)
          AND (p_start_date IS NULL OR v.voucher_date >= p_start_date)
          AND (p_end_date IS NULL OR v.voucher_date <= p_end_date)
          AND (p_ledger_id IS NOT NULL OR l.is_cash_bank = FALSE)
        ORDER BY v.voucher_date DESC, v.created_at DESC
        LIMIT p_limit OFFSET p_offset
    ) t;

    RETURN jsonb_build_object(
        'balance_bf', v_balance_bf,
        'quantity_bf', v_quantity_bf,
        'nature', v_nature,
        'lines', COALESCE(v_result_lines, '[]'::jsonb)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trial Balance (hierarchical)
DROP FUNCTION IF EXISTS public.fetch_trial_balance_tally_v1(DATE, DATE, BOOLEAN, UUID);
CREATE OR REPLACE FUNCTION public.fetch_trial_balance_tally_v1(
    p_start_date DATE,
    p_end_date DATE,
    p_include_drafts BOOLEAN DEFAULT FALSE
) RETURNS TABLE (
    node_id UUID,
    node_name VARCHAR,
    node_type VARCHAR,
    nature VARCHAR,
    parent_id UUID,
    depth INTEGER,
    opening_dr DECIMAL,
    opening_cr DECIMAL,
    period_dr DECIMAL,
    period_cr DECIMAL,
    closing_dr DECIMAL,
    closing_cr DECIMAL,
    is_leaf BOOLEAN,
    allow_party BOOLEAN,
    sub_ledger_total DECIMAL,
    reconciliation_gap DECIMAL
) AS $$
DECLARE
    v_status_filter TEXT[];
BEGIN
    IF p_include_drafts THEN
        v_status_filter := ARRAY['POSTED', 'DRAFT'];
    ELSE
        v_status_filter := ARRAY['POSTED'];
    END IF;

    RETURN QUERY
    WITH RECURSIVE
    ledger_stats AS (
        SELECT
            l.id as ledger_id,
            l.ledger_name,
            l.ledger_group_id,
            l.nature::TEXT as item_nature,
            l.allow_party,
            COALESCE((
                SELECT SUM(CASE WHEN vl.side = 'DR' THEN vl.amount ELSE -vl.amount END)
                FROM public.voucher_lines vl
                JOIN public.vouchers v ON vl.voucher_id = v.id
                WHERE v.voucher_date < p_start_date
                  AND vl.ledger_id = l.id
                  AND UPPER(v.status::TEXT) = ANY(v_status_filter)
            ), 0)
            + COALESCE(
                CASE
                    WHEN l.opening_balance_side = 'DR' THEN l.opening_balance
                    WHEN l.opening_balance_side = 'CR' THEN -l.opening_balance
                    ELSE 0
                END, 0
            ) as op_net,
            COALESCE((
                SELECT SUM(vl.amount)
                FROM public.voucher_lines vl
                JOIN public.vouchers v ON vl.voucher_id = v.id
                WHERE v.voucher_date BETWEEN p_start_date AND p_end_date
                  AND vl.ledger_id = l.id AND vl.side = 'DR'
                  AND UPPER(v.status::TEXT) = ANY(v_status_filter)
            ), 0) as p_dr,
            COALESCE((
                SELECT SUM(vl.amount)
                FROM public.voucher_lines vl
                JOIN public.vouchers v ON vl.voucher_id = v.id
                WHERE v.voucher_date BETWEEN p_start_date AND p_end_date
                  AND vl.ledger_id = l.id AND vl.side = 'CR'
                  AND UPPER(v.status::TEXT) = ANY(v_status_filter)
            ), 0) as p_cr,
            COALESCE((
                SELECT SUM(CASE WHEN vl.side = 'DR' THEN vl.amount ELSE -vl.amount END)
                FROM public.voucher_lines vl
                JOIN public.vouchers v ON vl.voucher_id = v.id
                WHERE vl.ledger_id = l.id
                  AND UPPER(v.status::TEXT) = ANY(v_status_filter)
            ), 0) as sl_total
        FROM public.ledgers l
        WHERE l.is_active = true
    ),
    active_ledgers AS (
        SELECT * FROM ledger_stats
        WHERE (ABS(op_net) > 0.001 OR p_dr > 0.001 OR p_cr > 0.001)
    ),
    involved_groups AS (
        SELECT DISTINCT ledger_group_id as group_id FROM active_ledgers
        UNION
        SELECT lg.parent_group_id
        FROM involved_groups ig
        JOIN public.ledger_groups lg ON ig.group_id = lg.id
        WHERE lg.parent_group_id IS NOT NULL
    ),
    node_paths AS (
        SELECT id as item_id, 1 as depth, id::TEXT as path
        FROM public.ledger_groups
        WHERE parent_group_id IS NULL OR parent_group_id NOT IN (SELECT id FROM public.ledger_groups)
        UNION ALL
        SELECT lg.id, np.depth + 1, np.path || '.' || lg.id::TEXT
        FROM public.ledger_groups lg
        JOIN node_paths np ON lg.parent_group_id = np.item_id
    ),
    ledger_paths AS (
        SELECT al.ledger_id,
               COALESCE(np.path, '') || (CASE WHEN np.path IS NOT NULL THEN '.' ELSE '' END) || al.ledger_id::TEXT as path
        FROM active_ledgers al
        LEFT JOIN node_paths np ON al.ledger_group_id = np.item_id
    ),
    visible_nodes AS (
        SELECT lg.id as item_id,
               lg.group_name as item_name,
               'GROUP'::VARCHAR as item_type,
               lg.nature::TEXT as item_nature,
               lg.parent_group_id as parent_id,
               COALESCE(np.path, lg.id::TEXT) as node_path
        FROM public.ledger_groups lg
        LEFT JOIN node_paths np ON lg.id = np.item_id
        WHERE lg.id IN (SELECT group_id FROM involved_groups)

        UNION ALL

        SELECT al.ledger_id,
               al.ledger_name,
               'LEDGER'::VARCHAR,
               al.item_nature,
               al.ledger_group_id,
               lp.path as node_path
        FROM active_ledgers al
        JOIN ledger_paths lp ON al.ledger_id = lp.ledger_id
    ),
    aggregated_values AS (
        SELECT vn.item_id,
            (CASE WHEN SUM(al.op_net) > 0 THEN SUM(al.op_net) ELSE 0 END) as op_dr,
            (CASE WHEN SUM(al.op_net) < 0 THEN ABS(SUM(al.op_net)) ELSE 0 END) as op_cr,
            SUM(al.p_dr) as p_dr,
            SUM(al.p_cr) as p_cr,
            SUM(al.sl_total) as sl_total
        FROM visible_nodes vn
        JOIN active_ledgers al
          ON (
              (vn.item_id = al.ledger_id AND vn.item_type = 'LEDGER')
              OR
              (vn.item_type = 'GROUP' AND EXISTS (
                    SELECT 1 FROM ledger_paths lp
                    WHERE lp.ledger_id = al.ledger_id
                      AND lp.path LIKE '%' || vn.item_id::TEXT || '%'
                ))
          )
        GROUP BY vn.item_id
    )
    SELECT
        vn.item_id as node_id,
        vn.item_name::VARCHAR as node_name,
        vn.item_type::VARCHAR as node_type,
        vn.item_nature::VARCHAR as nature,
        (CASE WHEN vn.parent_id IN (SELECT item_id FROM visible_nodes) THEN vn.parent_id ELSE NULL END) as parent_id,
        COALESCE(np.depth, 1) + (CASE WHEN vn.item_type = 'LEDGER' THEN 1 ELSE 0 END) as depth,
        COALESCE(av.op_dr, 0) as opening_dr,
        COALESCE(av.op_cr, 0) as opening_cr,
        COALESCE(av.p_dr, 0) as period_dr,
        COALESCE(av.p_cr, 0) as period_cr,
        (CASE WHEN (COALESCE(av.op_dr,0) - COALESCE(av.op_cr,0) + COALESCE(av.p_dr,0) - COALESCE(av.p_cr,0)) >= 0
              THEN (COALESCE(av.op_dr,0) - COALESCE(av.op_cr,0) + COALESCE(av.p_dr,0) - COALESCE(av.p_cr,0))
              ELSE 0 END) as closing_dr,
        (CASE WHEN (COALESCE(av.op_dr,0) - COALESCE(av.op_cr,0) + COALESCE(av.p_dr,0) - COALESCE(av.p_cr,0)) < 0
              THEN ABS(COALESCE(av.op_dr,0) - COALESCE(av.op_cr,0) + COALESCE(av.p_dr,0) - COALESCE(av.p_cr,0))
              ELSE 0 END) as closing_cr,
        (vn.item_type = 'LEDGER')::BOOLEAN as is_leaf,
        COALESCE(al.allow_party, false) as allow_party,
        COALESCE(av.sl_total, 0) as sub_ledger_total,
        (CASE WHEN COALESCE(al.allow_party,false)
              THEN ABS((COALESCE(av.op_dr,0) - COALESCE(av.op_cr,0) + COALESCE(av.p_dr,0) - COALESCE(av.p_cr,0)) - COALESCE(av.sl_total,0))
              ELSE 0 END) as reconciliation_gap
    FROM visible_nodes vn
    JOIN aggregated_values av ON vn.item_id = av.item_id
    LEFT JOIN active_ledgers al ON vn.item_id = al.ledger_id
    LEFT JOIN node_paths np ON vn.item_id = np.item_id
    ORDER BY vn.node_path ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 9) FINANCIAL YEAR VALIDATION TRIGGER
-- ================================================================

CREATE OR REPLACE FUNCTION public.validate_and_assign_voucher_fy()
RETURNS TRIGGER AS $$
DECLARE
    v_fy RECORD;
    v_config RECORD;
BEGIN
    SELECT id, is_closed, start_date, end_date
    INTO v_fy
    FROM public.financial_years
    WHERE NEW.voucher_date >= start_date AND NEW.voucher_date <= end_date
      AND is_active = TRUE
    LIMIT 1;

    IF v_fy.id IS NULL THEN
        RAISE EXCEPTION 'Voucher date (%) does not fall within any ACTIVE Financial Year.', NEW.voucher_date;
    ELSIF v_fy.is_closed THEN
        RAISE EXCEPTION 'Financial Year for voucher date (%) is CLOSED. No transactions allowed.', NEW.voucher_date;
    END IF;

    SELECT allow_backdated_posting, backdate_limit_days
    INTO v_config
    FROM public.system_configurations
    WHERE id = '00000000-0000-0000-0000-000000000000'
    LIMIT 1;

    IF NEW.voucher_date < CURRENT_DATE THEN
        IF COALESCE(v_config.allow_backdated_posting, FALSE) = FALSE THEN
            RAISE EXCEPTION 'Backdated posting is DISABLED in system settings.';
        ELSIF (CURRENT_DATE - NEW.voucher_date) > COALESCE(v_config.backdate_limit_days, 0) THEN
            RAISE EXCEPTION 'Voucher date (%) exceeds the backdate limit of % days.', NEW.voucher_date, v_config.backdate_limit_days;
        END IF;
    END IF;

    NEW.financial_year_id := v_fy.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_validate_and_assign_voucher_fy ON public.vouchers;
CREATE TRIGGER trigger_validate_and_assign_voucher_fy
BEFORE INSERT OR UPDATE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.validate_and_assign_voucher_fy();

-- ================================================================
-- 10) INDEXES
-- ================================================================

-- Vouchers
CREATE INDEX IF NOT EXISTS idx_vouchers_date ON public.vouchers(voucher_date);
CREATE INDEX IF NOT EXISTS idx_vouchers_type ON public.vouchers(voucher_type_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON public.vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_party ON public.vouchers(party_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_session ON public.vouchers(session_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_fy ON public.vouchers(financial_year_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_bank_status ON public.vouchers(bank_status);
CREATE INDEX IF NOT EXISTS idx_vouchers_sender_bank ON public.vouchers(sender_bank_account_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_bank_validation ON public.vouchers(bank_validation_status);
CREATE INDEX IF NOT EXISTS idx_vouchers_approval_status ON public.vouchers(approval_status);
CREATE INDEX IF NOT EXISTS idx_vouchers_template ON public.vouchers(template_id);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_party ON public.transaction_sessions(party_id);

-- Voucher Lines
CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher ON public.voucher_lines(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_lines_ledger ON public.voucher_lines(ledger_id);
CREATE INDEX IF NOT EXISTS idx_voucher_lines_party ON public.voucher_lines(party_id);

-- Ledgers
CREATE INDEX IF NOT EXISTS idx_ledgers_group ON public.ledgers(ledger_group_id);

-- Party Bank Accounts
CREATE INDEX IF NOT EXISTS idx_bank_accounts_party_id ON public.bank_accounts(party_id);

-- Audit
CREATE INDEX IF NOT EXISTS idx_system_audit_logs_record ON public.system_audit_logs(table_name, record_id);

-- Templates
CREATE INDEX IF NOT EXISTS idx_rapid_templates_code ON public.rapid_templates(template_code);

-- Reconciliation Performance Indexes
CREATE INDEX IF NOT EXISTS idx_bank_statement_items_lookup ON public.bank_statement_items(ledger_id, txn_date, match_status);
CREATE INDEX IF NOT EXISTS idx_voucher_line_recon_lookup ON public.voucher_lines(matched_statement_id, recon_status);

-- ================================================================
-- 11) SEED DATA (Idempotent)
-- ================================================================

-- Seed UOMs
INSERT INTO public.uoms (code, name, uom_type, precision) VALUES
    ('INR', 'Rupees', 'CURRENCY', 2),
    ('GM',  'Grams',  'WEIGHT',   3),
    ('PCS', 'Pieces', 'COUNT',    0)
ON CONFLICT (code) DO NOTHING;

-- Seed Ledger Groups
INSERT INTO public.ledger_groups (group_name, nature) VALUES
    ('Current Assets', 'ASSET'),
    ('Fixed Assets', 'ASSET'),
    ('Bank Accounts', 'ASSET'),
    ('Loans & Advances (Asset)', 'ASSET'),
    ('Current Liabilities', 'LIABILITY'),
    ('Loans (Liability)', 'LIABILITY'),
    ('Duties & Taxes', 'LIABILITY'),
    ('Capital Account', 'EQUITY'),
    ('Direct Income', 'INCOME'),
    ('Indirect Income', 'INCOME'),
    ('Direct Expenses', 'EXPENSE'),
    ('Indirect Expenses', 'EXPENSE')
ON CONFLICT (group_name) DO NOTHING;

-- Seed Ledger Tags
INSERT INTO public.ledger_tags (tag_name) VALUES
    ('COUNTERPARTY ACCOUNTS'),
    ('ACTIONS')
ON CONFLICT (tag_name) DO NOTHING;

-- Seed ledger defaults using PL/pgSQL for cross-reference lookups
DO $$
DECLARE
    v_inr_id UUID;
    v_actions_tag_id UUID;
    v_counterparty_tag_id UUID;
BEGIN
    SELECT id INTO v_inr_id FROM public.uoms WHERE code = 'INR' LIMIT 1;

    SELECT id INTO v_actions_tag_id FROM public.ledger_tags WHERE tag_name = 'ACTIONS' LIMIT 1;
    SELECT id INTO v_counterparty_tag_id FROM public.ledger_tags WHERE tag_name = 'COUNTERPARTY ACCOUNTS' LIMIT 1;

    -- Create base system ledgers if missing
    INSERT INTO public.ledgers (
        ledger_name, ledger_group_id, nature, normal_side, opening_balance,
        allow_party, is_cash_bank, is_system, default_uom_id) VALUES
        ('Cash in Hand',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Current Assets' LIMIT 1),
            'ASSET', 'DR', 0, FALSE, TRUE, TRUE, v_inr_id
        ),
        ('Customer Receivables',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Current Assets' LIMIT 1),
            'ASSET', 'DR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Supplier Payables',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Current Liabilities' LIMIT 1),
            'LIABILITY', 'CR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Customer Advances',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Current Liabilities' LIMIT 1),
            'LIABILITY', 'CR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Supplier Advances',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Current Assets' LIMIT 1),
            'ASSET', 'DR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Round Off +',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Indirect Income' LIMIT 1),
            'INCOME', 'CR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Round off -',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Indirect Expenses' LIMIT 1),
            'EXPENSE', 'DR', 0, TRUE, FALSE, TRUE, v_inr_id
        ),
        ('Discount Allowed',
            (SELECT id FROM public.ledger_groups WHERE group_name = 'Indirect Expenses' LIMIT 1),
            'EXPENSE', 'DR', 0, TRUE, FALSE, TRUE, v_inr_id
        )
    ON CONFLICT (ledger_name) DO NOTHING;

    
    UPDATE public.ledgers
    SET
        default_uom_id = COALESCE(default_uom_id, v_inr_id),
        updated_at = NOW()
    WHERE is_system = TRUE;

    -- Tag ACTIONS ledgers
    UPDATE public.ledgers
    SET business_tags = CASE
        WHEN business_tags IS NULL THEN ARRAY[v_actions_tag_id]
        WHEN business_tags @> ARRAY[v_actions_tag_id] THEN business_tags
        ELSE array_append(business_tags, v_actions_tag_id)
    END
    WHERE ledger_name IN ('Round Off +', 'Round off -', 'Discount Allowed');

    -- Tag Counterparty ledgers
    UPDATE public.ledgers
    SET business_tags = CASE
        WHEN business_tags IS NULL THEN ARRAY[v_counterparty_tag_id]
        WHEN business_tags @> ARRAY[v_counterparty_tag_id] THEN business_tags
        ELSE array_append(business_tags, v_counterparty_tag_id)
    END
    WHERE ledger_name IN ('Customer Receivables', 'Supplier Payables', 'Customer Advances', 'Supplier Advances');
END $$;

-- Seed Voucher Types (base + actions)
INSERT INTO public.voucher_types (type_code, type_name, prefix, voucher_nature, cash_bank_flow, party_rule) VALUES
    ('RECEIPT',  'Receipt',       'RCP', 'RECEIPT',  'INFLOW',  'OPTIONAL'),
    ('PAYMENT',  'Payment',       'PAY', 'PAYMENT',  'OUTFLOW', 'OPTIONAL'),
    ('CONTRA',   'Contra',        'CON', 'CONTRA',   'NEUTRAL', 'NOT_ALLOWED'),
    ('JOURNAL',  'Journal Entry', 'JNL', 'JOURNAL',  'NEUTRAL', 'OPTIONAL'),
    ('SALE',     'Sales Invoice', 'SL',  'SALE',     'INFLOW',  'OPTIONAL'),
    ('PURCHASE', 'Purchase Bill', 'PUR', 'PURCHASE', 'OUTFLOW', 'OPTIONAL'),

    ('APPLY_CREDIT',   'Apply Credit',   'AC',  'JOURNAL', 'NEUTRAL', 'MANDATORY'),
    ('APPLY_DISCOUNT', 'Apply Discount', 'AD',  'JOURNAL', 'NEUTRAL', 'MANDATORY'),
    ('ROUND_OFF_PLUS',  'Round Off (+)', 'RO+', 'JOURNAL', 'NEUTRAL', 'MANDATORY'),
    ('ROUND_OFF_MINUS', 'Round Off (-)', 'RO-', 'JOURNAL', 'NEUTRAL', 'MANDATORY')
ON CONFLICT (type_code) DO NOTHING;

-- Seed Voucher Sequences (for all voucher types)
INSERT INTO public.voucher_sequences (voucher_type_id, next_number)
SELECT id, 1 FROM public.voucher_types
ON CONFLICT (voucher_type_id) DO NOTHING;

-- Seed Template Groups
INSERT INTO public.template_groups (group_name, description) VALUES
    ('General',  'Common utility templates'),
    ('Jewellery','Jewellery industry specific templates')
ON CONFLICT (group_name) DO NOTHING;

-- Seed FY (example)
INSERT INTO public.financial_years (name, start_date, end_date)
VALUES ('FY 2025-26', '2025-04-01', '2026-03-31')
ON CONFLICT (name) DO NOTHING;

-- Ensure System Config singleton exists (fixed UUID)
DO $$
DECLARE
    v_fy_id UUID;
BEGIN
    SELECT id INTO v_fy_id FROM public.financial_years WHERE name = 'FY 2025-26' LIMIT 1;

    IF NOT EXISTS (SELECT 1 FROM public.system_configurations WHERE id = '00000000-0000-0000-0000-000000000000') THEN
        INSERT INTO public.system_configurations (id, current_financial_year_id)
        VALUES ('00000000-0000-0000-0000-000000000000', v_fy_id);
    ELSE
        UPDATE public.system_configurations
        SET current_financial_year_id = COALESCE(current_financial_year_id, v_fy_id),
            updated_at = NOW()
        WHERE id = '00000000-0000-0000-0000-000000000000';
    END IF;
END $$;

-- Seed Default Bank Export Prefix
INSERT INTO public.reference_prefixes (prefix, description, is_default)
VALUES ('ALK', 'Alookaran Default', true)
ON CONFLICT (prefix) DO NOTHING;

-- ================================================================
-- 12) SECURITY: RLS + PERMISSIONS
-- ================================================================

-- Helper: Is Super Admin?
CREATE OR REPLACE FUNCTION public.get_is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.user_profiles
        WHERE id = auth.uid() AND is_super_admin = TRUE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper: has_permission(module, action)
-- NOTE: role.permissions is expected like: { "session": ["view","create"], ... }
CREATE OR REPLACE FUNCTION public.has_permission(p_module TEXT, p_action TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    IF public.get_is_super_admin() THEN
        RETURN TRUE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.user_org_access uoa
        JOIN public.roles r ON uoa.role_id = r.id
        WHERE uoa.user_id = auth.uid()
          AND uoa.is_active = TRUE
          AND (
            (r.permissions ? p_module AND (r.permissions->p_module) ? p_action)
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Enable RLS on security/config tables (explicit)
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_org_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_configurations ENABLE ROW LEVEL SECURITY;

-- user_profiles policies
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
CREATE POLICY "Users can view their own profile"
ON public.user_profiles FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Super Admins have full access to profiles" ON public.user_profiles;
CREATE POLICY "Super Admins have full access to profiles"
ON public.user_profiles FOR ALL
USING (public.get_is_super_admin());

-- roles policies
DROP POLICY IF EXISTS "Authenticated users can view roles" ON public.roles;
CREATE POLICY "Authenticated users can view roles"
ON public.roles FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Super Admins can manage roles" ON public.roles;
CREATE POLICY "Super Admins can manage roles"
ON public.roles FOR ALL TO authenticated
USING (public.get_is_super_admin());

-- user_org_access policies
DROP POLICY IF EXISTS "Users can view their own access mappings" ON public.user_org_access;
CREATE POLICY "Users can view their own access mappings"
ON public.user_org_access FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Super Admins can manage access mappings" ON public.user_org_access;
CREATE POLICY "Super Admins can manage access mappings"
ON public.user_org_access FOR ALL TO authenticated
USING (public.get_is_super_admin());

-- staff_profiles policies
DROP POLICY IF EXISTS "Authenticated users can view staff profiles" ON public.staff_profiles;
CREATE POLICY "Authenticated users can view staff profiles"
ON public.staff_profiles FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Super Admins can manage staff profiles" ON public.staff_profiles;
CREATE POLICY "Super Admins can manage staff profiles"
ON public.staff_profiles FOR ALL TO authenticated
USING (public.get_is_super_admin());

-- system_configurations policies
DROP POLICY IF EXISTS "Authenticated users can view system config" ON public.system_configurations;
CREATE POLICY "Authenticated users can view system config"
ON public.system_configurations FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Super Admins can manage system config" ON public.system_configurations;
CREATE POLICY "Super Admins can manage system config"
ON public.system_configurations FOR ALL TO authenticated
USING (public.get_is_super_admin());

-- ================================================================
-- BANK RECONCILIATION INFRASTRUCTURE (Required for RLS Loop)
-- ================================================================

-- Table for period locking
CREATE TABLE IF NOT EXISTS public.reconcile_locks (
    ledger_id UUID PRIMARY KEY REFERENCES public.ledgers(id),
    lock_date DATE NOT NULL,
    locked_by UUID REFERENCES auth.users(id),
    locked_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.reconcile_locks ENABLE ROW LEVEL SECURITY;

-- Any authenticated user with bank_recon view rights can read locks (needed to check period)
DROP POLICY IF EXISTS "RLS: reconcile_locks SELECT" ON public.reconcile_locks;
CREATE POLICY "RLS: reconcile_locks SELECT" ON public.reconcile_locks
    FOR SELECT TO authenticated
    USING (public.has_permission('bank_recon', 'view') OR public.get_is_super_admin());

-- Only admins/super-admins can manage (create/update/delete) period locks
DROP POLICY IF EXISTS "RLS: reconcile_locks MANAGE" ON public.reconcile_locks;
CREATE POLICY "RLS: reconcile_locks MANAGE" ON public.reconcile_locks
    FOR ALL TO authenticated
    USING (public.get_is_super_admin() OR public.has_permission('bank_recon', 'lock'))
    WITH CHECK (public.get_is_super_admin() OR public.has_permission('bank_recon', 'lock'));

-- bank_statement_items: view requires bank_recon view; write requires bank_recon reconcile
DROP POLICY IF EXISTS "RLS: bank_statement_items SELECT" ON public.bank_statement_items;
CREATE POLICY "RLS: bank_statement_items SELECT" ON public.bank_statement_items
    FOR SELECT TO authenticated
    USING (public.has_permission('bank_recon', 'view') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "RLS: bank_statement_items WRITE" ON public.bank_statement_items;
CREATE POLICY "RLS: bank_statement_items WRITE" ON public.bank_statement_items
    FOR ALL TO authenticated
    USING (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin())
    WITH CHECK (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin());

-- Universal enrollment: enable RLS on all business tables and define module-based policies
DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'ledgers', 'parties', 'bank_accounts', 'voucher_types', 'uoms',
        'ledger_groups', 'ledger_tags', 'party_groups', 'voucher_groups',
        'template_groups', 'financial_years', 'transaction_sessions',
        'vouchers', 'voucher_lines', 'approval_requests', 'system_audit_logs',
        'rapid_templates', 'template_voucher_types', 'template_lines',
        'voucher_sequences', 'reference_prefixes', 'reference_counters',
        'bank_txn_exports', 'bank_statement_items', 'reconcile_locks'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "Access Control" ON public.%I', t);
    END LOOP;
END $$;

-- Core module policies (examples aligned to your structure)
-- Ledgers
DROP POLICY IF EXISTS "RLS: ledgers" ON public.ledgers;
CREATE POLICY "RLS: ledgers" ON public.ledgers FOR ALL TO authenticated
USING (public.has_permission('ledgers','view'))
WITH CHECK (public.has_permission('ledgers','create') OR public.has_permission('ledgers','edit'));

-- Parties
DROP POLICY IF EXISTS "RLS: parties" ON public.parties;
CREATE POLICY "RLS: parties" ON public.parties FOR ALL TO authenticated
USING (public.has_permission('parties','view'))
WITH CHECK (public.has_permission('parties','create') OR public.has_permission('parties','edit'));

-- Voucher types (masters)
DROP POLICY IF EXISTS "RLS: voucher_types" ON public.voucher_types;
CREATE POLICY "RLS: voucher_types" ON public.voucher_types FOR ALL TO authenticated
USING (public.has_permission('vouchers','view'))
WITH CHECK (public.has_permission('vouchers','create') OR public.has_permission('vouchers','edit'));

-- Sessions
DROP POLICY IF EXISTS "RLS: transaction_sessions" ON public.transaction_sessions;
CREATE POLICY "RLS: transaction_sessions" ON public.transaction_sessions FOR ALL TO authenticated
USING (public.has_permission('daybook','view') OR public.has_permission('session','view'))
WITH CHECK (public.has_permission('session','create') OR public.has_permission('session','edit'));

-- Vouchers
DROP POLICY IF EXISTS "RLS: vouchers ALL" ON public.vouchers;
DROP POLICY IF EXISTS "RLS: vouchers" ON public.vouchers;
DROP POLICY IF EXISTS "RLS: vouchers SELECT" ON public.vouchers;
DROP POLICY IF EXISTS "RLS: vouchers INSERT" ON public.vouchers;
DROP POLICY IF EXISTS "RLS: vouchers UPDATE" ON public.vouchers;
DROP POLICY IF EXISTS "RLS: vouchers DELETE" ON public.vouchers;
CREATE POLICY "RLS: vouchers SELECT" ON public.vouchers FOR SELECT TO authenticated
USING (public.has_permission('daybook','view') OR public.has_permission('session','view'));
CREATE POLICY "RLS: vouchers INSERT" ON public.vouchers FOR INSERT TO authenticated
WITH CHECK (public.has_permission('session','create') OR public.has_permission('session','edit'));
CREATE POLICY "RLS: vouchers UPDATE" ON public.vouchers FOR UPDATE TO authenticated
USING (public.has_permission('session','create') OR public.has_permission('session','edit'));
CREATE POLICY "RLS: vouchers DELETE" ON public.vouchers FOR DELETE TO authenticated
USING (public.has_permission('session','delete'));

-- Voucher lines
DROP POLICY IF EXISTS "RLS: voucher_lines ALL" ON public.voucher_lines;
DROP POLICY IF EXISTS "RLS: voucher_lines" ON public.voucher_lines;
DROP POLICY IF EXISTS "RLS: voucher_lines SELECT" ON public.voucher_lines;
DROP POLICY IF EXISTS "RLS: voucher_lines INSERT" ON public.voucher_lines;
DROP POLICY IF EXISTS "RLS: voucher_lines UPDATE" ON public.voucher_lines;
DROP POLICY IF EXISTS "RLS: voucher_lines DELETE" ON public.voucher_lines;
CREATE POLICY "RLS: voucher_lines SELECT" ON public.voucher_lines FOR SELECT TO authenticated
USING (public.has_permission('daybook','view') OR public.has_permission('session','view'));
CREATE POLICY "RLS: voucher_lines INSERT" ON public.voucher_lines FOR INSERT TO authenticated
WITH CHECK (public.has_permission('session','create') OR public.has_permission('session','edit'));
CREATE POLICY "RLS: voucher_lines UPDATE" ON public.voucher_lines FOR UPDATE TO authenticated
USING (public.has_permission('session','create') OR public.has_permission('session','edit'));
CREATE POLICY "RLS: voucher_lines DELETE" ON public.voucher_lines FOR DELETE TO authenticated
USING (public.has_permission('session','delete'));

-- Protection for reconciliation fields (prevents direct manipulation by non-recon users)
CREATE OR REPLACE FUNCTION public.protect_recon_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF (
        NEW.recon_status IS DISTINCT FROM OLD.recon_status OR
        NEW.recon_date IS DISTINCT FROM OLD.recon_date OR
        NEW.matched_statement_id IS DISTINCT FROM OLD.matched_statement_id OR
        NEW.recon_audit IS DISTINCT FROM OLD.recon_audit
    ) THEN
        IF NOT (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin()) THEN
            RAISE EXCEPTION 'ACCESS_DENIED: Direct modification of reconciliation fields is prohibited. Use the reconciliation module.';
        END IF;
    ELSIF OLD.recon_status = 'RECONCILED' THEN
        -- If it wasn't a reconciliation status change (handled above), but the row is already reconciled, block the edit.
        RAISE EXCEPTION 'LOCKED_RECORD: Cannot modify core fields of a reconciled voucher line.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_recon_fields ON public.voucher_lines;
CREATE TRIGGER trg_protect_recon_fields
BEFORE UPDATE ON public.voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.protect_recon_fields();

-- Protection for bank statement items (prevents direct manipulation of key reconciliation fields)
CREATE OR REPLACE FUNCTION public.protect_bank_statement_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF (
        NEW.match_status IS DISTINCT FROM OLD.match_status OR
        NEW.matched_book_line_id IS DISTINCT FROM OLD.matched_book_line_id OR
        NEW.ledger_id IS DISTINCT FROM OLD.ledger_id OR
        NEW.txn_date IS DISTINCT FROM OLD.txn_date OR
        NEW.amount IS DISTINCT FROM OLD.amount
    ) THEN
        IF NOT (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin()) THEN
            RAISE EXCEPTION 'ACCESS_DENIED: Direct modification of bank statement reconciliation or core fields is prohibited. Use the reconciliation module.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_protect_bank_statement_fields ON public.bank_statement_items;
CREATE TRIGGER trg_protect_bank_statement_fields
BEFORE UPDATE ON public.bank_statement_items
FOR EACH ROW EXECUTE FUNCTION public.protect_bank_statement_fields();

-- Templates
DROP POLICY IF EXISTS "RLS: rapid_templates" ON public.rapid_templates;
CREATE POLICY "RLS: rapid_templates" ON public.rapid_templates FOR ALL TO authenticated
USING (public.has_permission('templates','view'))
WITH CHECK (public.has_permission('templates','edit') OR public.has_permission('templates','create'));

-- Audit logs (read only)
DROP POLICY IF EXISTS "RLS: system_audit_logs" ON public.system_audit_logs;
CREATE POLICY "RLS: system_audit_logs" ON public.system_audit_logs FOR SELECT TO authenticated
USING (public.has_permission('audit_logs','view_audits'));

-- Approval requests
DROP POLICY IF EXISTS "RLS: approval_requests" ON public.approval_requests;
CREATE POLICY "RLS: approval_requests" ON public.approval_requests FOR ALL TO authenticated
USING (public.has_permission('approval_hub','view_approvals') OR public.has_permission('approvals','view_approvals') OR requested_by = auth.uid())
WITH CHECK (public.has_permission('approval_hub','view_approvals') OR requested_by = auth.uid());

-- Global masters: allow all authenticated to SELECT, only super admin can manage
DO $$
DECLARE
    t TEXT;
    masters TEXT[] := ARRAY[
        'uoms', 'ledger_groups', 'ledger_tags',
        'party_groups', 'voucher_groups', 'template_groups', 'financial_years'
    ];
BEGIN
    FOREACH t IN ARRAY masters LOOP
        EXECUTE format('DROP POLICY IF EXISTS "Authenticated users can view masters" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Authenticated users can view masters" ON public.%I FOR SELECT TO authenticated USING (true)', t);

        EXECUTE format('DROP POLICY IF EXISTS "Super Admins can manage masters" ON public.%I', t);
        EXECUTE format('CREATE POLICY "Super Admins can manage masters" ON public.%I FOR ALL TO authenticated USING (public.get_is_super_admin())', t);
    END LOOP;
END $$;

-- ================================================================
-- 13) FIX DUPLICATE ROLE MAPPINGS (Partial unique indexes)
-- ================================================================

DO $$
BEGIN
    -- Cleanup duplicates
    DELETE FROM public.user_org_access a
    USING public.user_org_access b
    WHERE a.id < b.id
      AND a.user_id = b.user_id
      AND a.role_id = b.role_id
      AND a.scope_type = b.scope_type
      AND (a.scope_id = b.scope_id OR (a.scope_id IS NULL AND b.scope_id IS NULL));

    -- Scoped assignments (scope_id NOT NULL)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_org_access_scoped_unique
    ON public.user_org_access (user_id, role_id, scope_type, scope_id)
    WHERE scope_id IS NOT NULL;

    -- Global assignments (scope_id NULL)
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_org_access_global_unique
    ON public.user_org_access (user_id, role_id, scope_type)
    WHERE scope_id IS NULL;
END $$;

-- ================================================================
-- 14) PROTECT SUPER ADMIN ACCOUNTS
-- ================================================================

CREATE OR REPLACE FUNCTION public.prevent_super_admin_changes()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent deletion of Super Admin profile
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_super_admin = TRUE THEN
            RAISE EXCEPTION 'CRITICAL: Super Admin accounts cannot be deleted.';
        END IF;
        RETURN OLD;
    END IF;

    -- Prevent unauthorized promotion
    IF TG_OP IN ('INSERT','UPDATE') THEN
        IF NEW.is_super_admin = TRUE AND (TG_OP = 'INSERT' OR COALESCE(OLD.is_super_admin,FALSE) = FALSE) THEN
            IF NOT public.get_is_super_admin() THEN
                RAISE EXCEPTION 'CRITICAL: Only an existing Super Admin can promote another Super Admin.';
            END IF;
        END IF;
    END IF;

    -- Prevent downgrading
    IF TG_OP = 'UPDATE' THEN
        IF OLD.is_super_admin = TRUE AND NEW.is_super_admin = FALSE THEN
            RAISE EXCEPTION 'CRITICAL: Super Admin status cannot be removed.';
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_protect_super_admin ON public.user_profiles;
CREATE TRIGGER trg_protect_super_admin
BEFORE INSERT OR UPDATE OR DELETE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_super_admin_changes();

-- ================================================================
-- 15) SEED: SYSTEM ADMIN ROLES (Master Admin / User Admin)
-- ================================================================

DO $$
BEGIN
    INSERT INTO public.roles (role_name, description, is_system, category, permissions)
    VALUES (
        'Master Admin',
        'Manages masters, reports, and ledger configurations. Cannot modify security or staff permissions.',
        TRUE,
        'ADMIN',
        jsonb_build_object(
            'dashboard',      jsonb_build_array('view'),
            'reports',        jsonb_build_array('view'),
            'staff_mgmt',     jsonb_build_array('view'),
            'session',        jsonb_build_array('view','create','edit','delete','post','reverse'),
            'daybook',        jsonb_build_array('view','create','edit','delete','post','reverse'),
            'day_book',       jsonb_build_array('view','create','edit','delete','post','reverse'),
            'bank_txn',       jsonb_build_array('view','create','edit','delete','post','reverse'),
            'approvals',      jsonb_build_array('view','view_approvals'),
            'ledgers',        jsonb_build_array('view','create','edit','delete'),
            'vouchers',       jsonb_build_array('view','create','edit','delete'),
            'parties',        jsonb_build_array('view','create','edit','delete'),
            'templates',      jsonb_build_array('view','create','edit','delete')
        )
    )
    ON CONFLICT (role_name) DO UPDATE SET
        permissions = EXCLUDED.permissions,
        is_system = TRUE,
        category = 'ADMIN',
        description = EXCLUDED.description;

    INSERT INTO public.roles (role_name, description, is_system, category, permissions)
    VALUES (
        'User Admin',
        'Manages staff enrollment, role assignments, and device access. No financial data access.',
        TRUE,
        'ADMIN',
        jsonb_build_object(
            'dashboard',      jsonb_build_array('view'),
            'staff_mgmt',     jsonb_build_array('view','manage_staff'),
            'device_mgmt',    jsonb_build_array('view','manage_devices'),
            'approval_hub',   jsonb_build_array('view','view_approvals'),
            'approvals',      jsonb_build_array('view','view_approvals'),
            'audit_logs',     jsonb_build_array('view','view_audits'),
            'role_mgmt',      jsonb_build_array('view','manage_org')
        )
    )
    ON CONFLICT (role_name) DO UPDATE SET
        permissions = EXCLUDED.permissions,
        is_system = TRUE,
        category = 'ADMIN',
        description = EXCLUDED.description;
END $$;

-- ================================================================
-- 16) RPC: update_user_auth_credentials (Super Admin only)
-- ================================================================

CREATE OR REPLACE FUNCTION public.update_user_auth_credentials(
  p_email     TEXT,
  p_password  TEXT DEFAULT NULL,
  p_new_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND is_super_admin = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied: Super Admin privileges required');
  END IF;

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(trim(p_email))
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('No Supabase Auth user found with email "%s". Create the account in Authentication first.', p_email)
    );
  END IF;

  -- Prevent modifying other Super Admins
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user_id AND is_super_admin = true)
     AND v_user_id != auth.uid()
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied: Cannot modify another Super Admin.');
  END IF;

  IF p_password IS NOT NULL AND trim(p_password) != '' THEN
    UPDATE auth.users
    SET encrypted_password = crypt(trim(p_password), gen_salt('bf')),
        updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  IF p_new_email IS NOT NULL
     AND trim(p_new_email) != ''
     AND lower(trim(p_new_email)) != lower(trim(p_email))
  THEN
    UPDATE auth.users
    SET email = trim(p_new_email),
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        updated_at = NOW()
    WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'user_id', v_user_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_user_auth_credentials(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_user_auth_credentials(TEXT, TEXT, TEXT) TO authenticated;

-- ================================================================
-- 17) RPC: upsert_user_org_access_v1 (server-side upsert)
-- ================================================================

CREATE OR REPLACE FUNCTION public.upsert_user_org_access_v1(
    p_user_id UUID,
    p_role_id UUID,
    p_scope_type TEXT,
    p_scope_id UUID DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS public.user_org_access AS $$
DECLARE
    v_result public.user_org_access;
BEGIN
    IF NOT (public.has_permission('role_mgmt', 'manage_org') OR public.get_is_super_admin()) THEN
        RAISE EXCEPTION 'Unauthorized: Insufficient privileges to manage role assignments.';
    END IF;

    IF p_scope_id IS NOT NULL THEN
        INSERT INTO public.user_org_access (user_id, role_id, scope_type, scope_id, is_active)
        VALUES (p_user_id, p_role_id, p_scope_type, p_scope_id, p_is_active)
        ON CONFLICT (user_id, role_id, scope_type, scope_id) WHERE scope_id IS NOT NULL
        DO UPDATE SET
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
        RETURNING * INTO v_result;
    ELSE
        INSERT INTO public.user_org_access (user_id, role_id, scope_type, scope_id, is_active)
        VALUES (p_user_id, p_role_id, p_scope_type, NULL, p_is_active)
        ON CONFLICT (user_id, role_id, scope_type) WHERE scope_id IS NULL
        DO UPDATE SET
            is_active = EXCLUDED.is_active,
            updated_at = NOW()
        RETURNING * INTO v_result;
    END IF;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- 18) OPTIONAL: Remove Demo Administrator (public schema cleanup)
-- ================================================================

DO $$
DECLARE
    v_staff_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_staff_id FROM public.staff_profiles WHERE email = 'demo@daybook.com' LIMIT 1;

    IF v_staff_id IS NOT NULL THEN
        SELECT id INTO v_user_id FROM public.user_profiles WHERE staff_id = v_staff_id LIMIT 1;

        DELETE FROM public.user_org_access WHERE user_id = v_user_id;

        UPDATE public.system_audit_logs SET staff_id = NULL WHERE staff_id = v_staff_id;
        UPDATE public.system_audit_logs SET user_id  = NULL WHERE user_id  = v_user_id;

        DELETE FROM public.user_profiles WHERE id = v_user_id;
        DELETE FROM public.staff_profiles WHERE id = v_staff_id;
    END IF;
END $$;

-- ================================================================
-- 19) POSTGREST SCHEMA CACHE RELOAD
-- ================================================================
NOTIFY pgrst, 'reload config';












































































































DROP FUNCTION IF EXISTS public.get_attendance_history_v2(UUID, DATE, DATE);
DROP FUNCTION IF EXISTS public.create_delay_incident_v1(DATE, TEXT, UUID[], INTEGER, UUID, UUID, TIME, TIME);
DROP FUNCTION IF EXISTS public.resolve_delay_incident_v1(UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.provision_device_account_v1(UUID, TEXT);
DROP FUNCTION IF EXISTS public.delete_device_v1(UUID);
DROP FUNCTION IF EXISTS public.provision_staff_account_v1(UUID, TEXT);
DROP FUNCTION IF EXISTS public.upsert_user_org_access_v1(UUID, UUID, TEXT, UUID, BOOLEAN);



-- ================================================================
-- LEAVE / HR MODULE - CONSOLIDATED MIGRATION (DEDUPED)
-- Includes:
--   1) Attendance/Shift/Delay Incident schema hardening
--   2) Permission-based RLS policies (removes "Admin All Access")
--   3) Attendance history + incident RPCs (atomic)
--   4) Secure staff disconnect RPC
--   5) Exit policy + relieving/exit management tables + active-policy enforcement
-- Notes:
--   - This script is designed to be re-runnable (idempotent) where possible.
--   - Assumes these already exist: staff_master, user_profiles, user_org_access,
--     devices, leave_days, and permission helpers:
--       public.has_permission(module, action), public.get_is_super_admin()
-- ================================================================

BEGIN;

-- -----------------------------
-- 0) EXTENSIONS (for UUID helpers)
-- -----------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- 1) ATTENDANCE MANAGEMENT SCHEMA
-- ================================================================

-- 1.1 Shift Groups
CREATE TABLE IF NOT EXISTS shift_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration_minutes INTEGER DEFAULT 60,
  grace_in_minutes INTEGER DEFAULT 10,
  grace_out_minutes INTEGER DEFAULT 10,
  min_hours_present DECIMAL(4,2) DEFAULT 8.0,
  min_hours_half_day DECIMAL(4,2) DEFAULT 4.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure all shift_groups columns exist (Hardening for Phase 7 idempotency)
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS weekly_off INTEGER[];
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS penalty_per_minute NUMERIC(12,2) DEFAULT 0;
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS max_monthly_penalty_pct NUMERIC(5,2) DEFAULT 100;
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS boundary_start_time TIME DEFAULT '06:00:00';
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS min_hours_present NUMERIC(4,2) DEFAULT 8;
ALTER TABLE public.shift_groups ADD COLUMN IF NOT EXISTS min_hours_half_day NUMERIC(4,2) DEFAULT 4;


-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1.2 Staff Master: shift assignment (deferred — staff_master may not be created yet here)
-- This is re-applied safely in section 8 when staff_master is guaranteed to exist.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_master') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'staff_master' AND column_name = 'shift_group_id') THEN
            ALTER TABLE public.staff_master ADD COLUMN shift_group_id UUID REFERENCES public.shift_groups(id);
        END IF;
    END IF;
END $$;

-- 1.3 Attendance Records
-- Note: staff_master FK is safe here because the CONSOLIDATED block that actually
-- runs attendance_records creation (section 4, ~line 6144) runs after staff_master.
-- This earlier definition is idempotent and safe only if staff_master already exists.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_master') THEN
        -- attendance_records will be created in the consolidated block below; this is a no-op if table already exists
        NULL;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS attendance_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID,  -- FK to staff_master added after staff_master is guaranteed to exist
  attendance_date DATE NOT NULL,

  punch_in TIMESTAMPTZ,
  break_start TIMESTAMPTZ,
  break_end TIMESTAMPTZ,
  punch_out TIMESTAMPTZ,

  status TEXT NOT NULL DEFAULT 'ABSENT',

  is_verified BOOLEAN DEFAULT false,
  verified_by UUID,
  notes TEXT,

  excused_late_minutes INTEGER DEFAULT 0,
  incident_id UUID,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (staff_id, attendance_date)
);

-- Attach FK constraints safely after both tables exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_master')
    AND NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
        AND table_name = 'attendance_records'
        AND constraint_name = 'attendance_records_staff_id_fkey'
    ) THEN
        ALTER TABLE public.attendance_records
            ADD CONSTRAINT attendance_records_staff_id_fkey
            FOREIGN KEY (staff_id) REFERENCES public.staff_master(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 1.4 Delay Incidents
CREATE TABLE IF NOT EXISTS delay_incidents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_date DATE NOT NULL,
  shift_group_id UUID REFERENCES shift_groups(id),
  reason TEXT NOT NULL,
  responsible_staff_ids UUID[] NOT NULL,
  excuse_minutes INTEGER NOT NULL,
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  approved_by UUID REFERENCES user_profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1.5 Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON attendance_records(staff_id);

-- 1.6 Update punch columns to TIMESTAMPTZ if they were TIME
ALTER TABLE attendance_records
  ALTER COLUMN punch_in TYPE TIMESTAMPTZ USING (attendance_date + punch_in::time)::TIMESTAMPTZ,
  ALTER COLUMN break_start TYPE TIMESTAMPTZ USING (attendance_date + break_start::time)::TIMESTAMPTZ,
  ALTER COLUMN break_end TYPE TIMESTAMPTZ USING (attendance_date + break_end::time)::TIMESTAMPTZ,
  ALTER COLUMN punch_out TYPE TIMESTAMPTZ USING (attendance_date + punch_out::time)::TIMESTAMPTZ;

-- 1.7 Apply triggers
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance_records;
CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON attendance_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_incidents_updated_at ON delay_incidents;
CREATE TRIGGER trg_incidents_updated_at BEFORE UPDATE ON delay_incidents FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_shifts_updated_at ON shift_groups;
CREATE TRIGGER trg_shifts_updated_at BEFORE UPDATE ON shift_groups FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 1.7 Ensure default UUID generator on attendance_records.id (idempotent)
ALTER TABLE attendance_records
  ALTER COLUMN id SET DEFAULT uuid_generate_v4();
ALTER TABLE attendance_records
  ALTER COLUMN id SET NOT NULL;

-- 1.8 Harden status values (clean + CHECK)
UPDATE attendance_records
SET status = 'ABSENT'
WHERE status NOT IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'MISS_PUNCH', 'LATE_PRESENT', 'EARLY_OUT');

ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS check_attendance_status;
ALTER TABLE attendance_records
  ADD CONSTRAINT check_attendance_status
  CHECK (status IN ('PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'MISS_PUNCH', 'LATE_PRESENT', 'EARLY_OUT'));

-- 1.9 FK for incident_id (delay_incidents)
ALTER TABLE attendance_records DROP CONSTRAINT IF EXISTS attendance_records_incident_id_fkey;
ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_incident_id_fkey
  FOREIGN KEY (incident_id) REFERENCES delay_incidents(id) ON DELETE SET NULL;

-- ================================================================
-- 2) ENABLE RLS + SECURE POLICIES (DEDUPED)
-- ================================================================

ALTER TABLE shift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE delay_incidents ENABLE ROW LEVEL SECURITY;

-- ---- attendance_records policies
DROP POLICY IF EXISTS "Admin All Access" ON attendance_records;
DROP POLICY IF EXISTS "attendance_records: SELECT" ON attendance_records;
DROP POLICY IF EXISTS "attendance_records: INSERT/UPDATE" ON attendance_records;
DROP POLICY IF EXISTS "attendance_records: INSERT" ON attendance_records;
DROP POLICY IF EXISTS "attendance_records: UPDATE" ON attendance_records;

CREATE POLICY "attendance_records: SELECT"
ON attendance_records
FOR SELECT TO authenticated
USING (public.has_permission('hr_attendance', 'view'));

DROP POLICY IF EXISTS "attendance_records: INSERT" ON attendance_records;
CREATE POLICY "attendance_records: INSERT"
ON attendance_records
FOR INSERT TO authenticated
WITH CHECK (
  public.has_permission('hr_attendance', 'manage_attendance')
  OR public.has_permission('hr_attendance', 'approve_correction')
);

DROP POLICY IF EXISTS "attendance_records: UPDATE" ON attendance_records;
CREATE POLICY "attendance_records: UPDATE"
ON attendance_records
FOR UPDATE TO authenticated
USING (
  public.has_permission('hr_attendance', 'manage_attendance')
  OR public.has_permission('hr_attendance', 'approve_correction')
)
WITH CHECK (
  public.has_permission('hr_attendance', 'manage_attendance')
  OR public.has_permission('hr_attendance', 'approve_correction')
);

-- ---- shift_groups policies
DROP POLICY IF EXISTS "Admin All Access" ON shift_groups;
DROP POLICY IF EXISTS "shift_groups: SELECT" ON shift_groups;
DROP POLICY IF EXISTS "shift_groups: INSERT/UPDATE" ON shift_groups;
DROP POLICY IF EXISTS "shift_groups: INSERT" ON shift_groups;
DROP POLICY IF EXISTS "shift_groups: UPDATE" ON shift_groups;

CREATE POLICY "shift_groups: SELECT"
ON shift_groups
FOR SELECT TO authenticated
USING (public.has_permission('hr_attendance', 'view'));

DROP POLICY IF EXISTS "shift_groups: INSERT" ON shift_groups;
CREATE POLICY "shift_groups: INSERT"
ON shift_groups
FOR INSERT TO authenticated
WITH CHECK (public.has_permission('hr_settings', 'edit') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "shift_groups: UPDATE" ON shift_groups;
CREATE POLICY "shift_groups: UPDATE"
ON shift_groups
FOR UPDATE TO authenticated
USING (public.has_permission('hr_settings', 'edit') OR public.get_is_super_admin())
WITH CHECK (public.has_permission('hr_settings', 'edit') OR public.get_is_super_admin());

-- ---- delay_incidents policies
DROP POLICY IF EXISTS "Admin All Access" ON delay_incidents;
DROP POLICY IF EXISTS "delay_incidents: SELECT" ON delay_incidents;
DROP POLICY IF EXISTS "delay_incidents: ALL" ON delay_incidents;
DROP POLICY IF EXISTS "delay_incidents: INSERT" ON delay_incidents;
DROP POLICY IF EXISTS "delay_incidents: UPDATE" ON delay_incidents;

CREATE POLICY "delay_incidents: SELECT"
ON delay_incidents
FOR SELECT TO authenticated
USING (public.has_permission('hr_attendance', 'view'));

DROP POLICY IF EXISTS "delay_incidents: INSERT" ON delay_incidents;
CREATE POLICY "delay_incidents: INSERT"
ON delay_incidents
FOR INSERT TO authenticated
WITH CHECK (public.has_permission('hr_attendance', 'manage_attendance'));

DROP POLICY IF EXISTS "delay_incidents: UPDATE" ON delay_incidents;
CREATE POLICY "delay_incidents: UPDATE"
ON delay_incidents
FOR UPDATE TO authenticated
USING (public.has_permission('hr_attendance', 'manage_attendance'))
WITH CHECK (public.has_permission('hr_attendance', 'manage_attendance'));

-- Legacy duplicate RPC block removed.
-- 4) SECURE DISCONNECTION RPC (DEDUPED + RESTRICTED)
-- ================================================================

CREATE OR REPLACE FUNCTION rpc_disconnect_staff_account(p_staff_id UUID)
RETURNS VOID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Basic hard gate: only super admin should be able to disconnect accounts
  IF NOT public.get_is_super_admin() THEN
    RAISE EXCEPTION 'Unauthorized: Super admin required to disconnect staff accounts.';
  END IF;

  SELECT id INTO v_user_id
  FROM user_profiles
  WHERE staff_id = p_staff_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE user_profiles
  SET staff_id = NULL
  WHERE id = v_user_id;

  DELETE FROM user_org_access
  WHERE user_id = v_user_id;

  UPDATE devices
  SET user_id = NULL, is_authorized = false
  WHERE user_id = v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION rpc_disconnect_staff_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION rpc_disconnect_staff_account(UUID) TO authenticated;

-- ================================================================
-- 5) RELIEVING & EXIT MANAGEMENT (DEDUPED + ACTIVE POLICY ENFORCEMENT)
-- ================================================================

-- 5.1 Exit Policies
CREATE TABLE IF NOT EXISTS exit_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_period_days int NOT NULL DEFAULT 30,
  allow_withdrawal boolean NOT NULL DEFAULT true,
  withdrawal_cutoff_days int NOT NULL DEFAULT 7,
  encash_leave_enabled boolean NOT NULL DEFAULT false,
  encash_leave_max_days int NOT NULL DEFAULT 0,
  absconding_unpaid_rule boolean NOT NULL DEFAULT true,

  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure updated_at exists for older versions
ALTER TABLE exit_policies
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 5.2 Enforce only one ACTIVE policy (keep latest ACTIVE; if none, activate latest)
UPDATE exit_policies
SET
  status = 'INACTIVE',
  effective_to = CURRENT_DATE,
  updated_at = NOW()
WHERE id NOT IN (
  SELECT id
  FROM exit_policies
  WHERE status = 'ACTIVE'
  ORDER BY created_at DESC
  LIMIT 1
)
AND status = 'ACTIVE';

UPDATE exit_policies
SET
  status = 'ACTIVE',
  effective_to = NULL,
  updated_at = NOW()
WHERE id = (
  SELECT id
  FROM exit_policies
  ORDER BY created_at DESC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM exit_policies WHERE status = 'ACTIVE');

DROP INDEX IF EXISTS idx_exit_policies_active_only;
CREATE UNIQUE INDEX idx_exit_policies_active_only
ON exit_policies (status)
WHERE (status = 'ACTIVE');

-- 5.3 Seed default policy (only if no ACTIVE exists)
INSERT INTO exit_policies (
  notice_period_days, allow_withdrawal, withdrawal_cutoff_days,
  encash_leave_enabled, encash_leave_max_days, absconding_unpaid_rule,
  effective_from, status
)
SELECT 30, true, 7, false, 0, true, CURRENT_DATE, 'ACTIVE'
WHERE NOT EXISTS (SELECT 1 FROM exit_policies WHERE status = 'ACTIVE');

-- 5.4 Exit Cases
CREATE TABLE IF NOT EXISTS exit_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff_master(id) ON DELETE CASCADE,
  exit_type text NOT NULL CHECK (exit_type IN ('RESIGNATION', 'TERMINATION', 'ABSCONDING', 'CONTRACT_END', 'DEATH', 'TRANSFER')),
  reason_category text,
  notes text,
  initiated_date date NOT NULL DEFAULT CURRENT_DATE,
  proposed_lwd date,
  final_lwd date,
  status text NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'MANAGER_APPROVED', 'EXIT_SCHEDULED', 'CLEARANCE_IN_PROGRESS', 'CLOSED')),
  manager_id uuid REFERENCES auth.users(id),
  hr_admin_id uuid REFERENCES auth.users(id),
  is_withdrawn boolean NOT NULL DEFAULT false,
  payroll_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5.5 Exit Checklist Templates
CREATE TABLE IF NOT EXISTS exit_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5.6 Exit Checklist Items
CREATE TABLE IF NOT EXISTS exit_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES exit_checklist_templates(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('ASSETS', 'SECURITY', 'MONEY', 'HANDOVER', 'OTHER')),
  task_name text NOT NULL,
  owner_role text NOT NULL CHECK (owner_role IN ('MANAGER', 'HR', 'FINANCE', 'IT')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5.7 Exit Clearance Tasks
CREATE TABLE IF NOT EXISTS exit_clearance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_case_id uuid NOT NULL REFERENCES exit_cases(id) ON DELETE CASCADE,
  category text NOT NULL,
  task_name text NOT NULL,
  owner_role text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'NOT_APPLICABLE')),
  completed_by uuid REFERENCES auth.users(id),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5.8 Exit Final Settlement (F&F)
CREATE TABLE IF NOT EXISTS exit_fnf_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exit_case_id uuid NOT NULL UNIQUE REFERENCES exit_cases(id) ON DELETE CASCADE,
  earnings_total numeric(12,2) NOT NULL DEFAULT 0,
  leave_encashment_total numeric(12,2) NOT NULL DEFAULT 0,
  deductions_total numeric(12,2) NOT NULL DEFAULT 0,
  net_payable numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'PAID')),
  approved_by uuid REFERENCES auth.users(id),
  paid_by uuid REFERENCES auth.users(id),
  paid_date timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;




-- ================================================================
-- LEAVE MANAGEMENT + STAFF ECOSYSTEM + DEVICE MGMT
-- Consolidated single SQL (deduplicated + idempotent)
-- Target: Postgres / Supabase
-- ================================================================

BEGIN;

-- -----------------------------
-- 0) EXTENSIONS
-- -----------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- 1) UNIVERSAL updated_at TRIGGER FUNCTION
--    (Used for multiple tables to avoid duplicate functions)
-- ================================================================
CREATE OR REPLACE FUNCTION public.trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 2) TRIGGERS FOR EXIT MODULE TABLES (ASSUMES TABLES ALREADY EXIST)
-- ================================================================

-- exit_cases
DROP TRIGGER IF EXISTS trg_update_exit_cases_modtime ON public.exit_cases;
CREATE TRIGGER trg_update_exit_cases_modtime
BEFORE UPDATE ON public.exit_cases
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- exit_clearance_tasks
DROP TRIGGER IF EXISTS trg_update_exit_clearance_tasks_modtime ON public.exit_clearance_tasks;
CREATE TRIGGER trg_update_exit_clearance_tasks_modtime
BEFORE UPDATE ON public.exit_clearance_tasks
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- exit_fnf_settlements
DROP TRIGGER IF EXISTS trg_update_exit_fnf_settlements_modtime ON public.exit_fnf_settlements;
CREATE TRIGGER trg_update_exit_fnf_settlements_modtime
BEFORE UPDATE ON public.exit_fnf_settlements
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- exit_policies
DROP TRIGGER IF EXISTS trg_update_exit_policies_modtime ON public.exit_policies;
CREATE TRIGGER trg_update_exit_policies_modtime
BEFORE UPDATE ON public.exit_policies
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- ================================================================
-- 3) LEAVE MANAGEMENT TABLES (POLICY-DRIVEN, VERSIONED)
-- ================================================================

-- 3.1) Leave Policies
CREATE TABLE IF NOT EXISTS public.leave_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Entitlements
  annual_paid_days int NOT NULL DEFAULT 15,
  annual_unpaid_days int NOT NULL DEFAULT 10,

  -- Monthly soft cap
  monthly_paid_cap int NOT NULL DEFAULT 2,
  cap_type text NOT NULL DEFAULT 'SOFT' CHECK (cap_type IN ('SOFT','HARD')),

  -- Half-day
  half_day_allowed boolean NOT NULL DEFAULT true,

  -- Penalty slabs
  penalty_slab1_limit int NOT NULL DEFAULT 5,
  penalty_slab1_mult numeric(4,2) NOT NULL DEFAULT 1.0,
  penalty_slab2_limit int NOT NULL DEFAULT 10,
  penalty_slab2_mult numeric(4,2) NOT NULL DEFAULT 1.5,
  penalty_slab3_mult numeric(4,2) NOT NULL DEFAULT 2.0,

  -- Incentive
  incentive_enabled boolean NOT NULL DEFAULT true,
  incentive_full_limit int NOT NULL DEFAULT 6,
  incentive_half_limit int NOT NULL DEFAULT 9,
  incentive_type text NOT NULL DEFAULT 'BONUS' CHECK (incentive_type IN ('BONUS','EXTRA_LEAVES','FESTIVAL')),
  incentive_bonus_amount numeric(12,2) NOT NULL DEFAULT 0,

  -- Discipline controls
  consecutive_limit int NOT NULL DEFAULT 3,
  same_day_rule text NOT NULL DEFAULT 'REQUIRE_APPROVAL' CHECK (same_day_rule IN ('AUTO_UPL','REQUIRE_APPROVAL')),

  -- Cancellation / Revocation workflow controls (added here as final schema)
  cancel_future_days_notice INTEGER DEFAULT 1,
  cancel_same_day_allowed BOOLEAN DEFAULT false,
  revoke_past_allowed BOOLEAN DEFAULT false,
  payroll_lock_protection BOOLEAN DEFAULT true,

  -- Versioning
  effective_from date NOT NULL DEFAULT '2024-01-01',
  effective_to date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- If leave_policies existed earlier without the workflow columns, ensure they exist
ALTER TABLE public.leave_policies
  ADD COLUMN IF NOT EXISTS cancel_future_days_notice INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cancel_same_day_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS revoke_past_allowed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payroll_lock_protection BOOLEAN DEFAULT true;

-- 3.2) Leave Balances
CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
  year int NOT NULL,

  paid_balance numeric(5,1) NOT NULL DEFAULT 0,
  unpaid_balance numeric(5,1) NOT NULL DEFAULT 0,
  penalty_count numeric(5,1) NOT NULL DEFAULT 0,
  total_leaves_taken numeric(5,1) NOT NULL DEFAULT 0,

  incentive_status text NOT NULL DEFAULT 'NOT_EVALUATED'
    CHECK (incentive_status IN ('ELIGIBLE','HALF','NOT_ELIGIBLE','NOT_EVALUATED')),

  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(staff_id, year)
);

-- 3.3) Leave Requests
CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,

  from_date date NOT NULL,
  to_date date NOT NULL,
  days_count numeric(5,1) NOT NULL,
  reason text,

  status text NOT NULL DEFAULT 'PENDING',
  approved_by uuid,
  rejection_reason text,
  policy_version_id uuid REFERENCES public.leave_policies(id),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce final status set (works whether table existed or new)
ALTER TABLE public.leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_status_check;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_status_check
  CHECK (status IN (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCEL_REQUESTED',
    'CANCELLED',
    'TAKEN',
    'LAPSED',
    'REVOKED'
  ));

-- 3.4) Leave Days
CREATE TABLE IF NOT EXISTS public.leave_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,

  leave_date date NOT NULL,
  day_count numeric(3,1) NOT NULL DEFAULT 1,

  allocation_type text NOT NULL CHECK (allocation_type IN ('PAID','UNPAID','PENALTY')),
  deduction_multiplier numeric(4,2) NOT NULL DEFAULT 1.0,

  policy_version_id uuid REFERENCES public.leave_policies(id),
  payroll_locked boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id, leave_date, allocation_type)
);

-- Ensure the constraint is updated if table already exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_days_request_id_leave_date_key') THEN
        ALTER TABLE public.leave_days DROP CONSTRAINT leave_days_request_id_leave_date_key;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leave_days_request_id_leave_date_allocation_type_key') THEN
        ALTER TABLE public.leave_days ADD CONSTRAINT leave_days_request_id_leave_date_allocation_type_key UNIQUE(request_id, leave_date, allocation_type);
    END IF;
END $$;

-- 3.5) Monthly Cap Tracking
CREATE TABLE IF NOT EXISTS public.leave_monthly_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),

  paid_used numeric(5,1) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(staff_id, year, month)
);

-- RLS disabled (service role only) - as per your note
ALTER TABLE public.leave_policies DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_days DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_monthly_tracking DISABLE ROW LEVEL SECURITY;

-- ================================================================
-- 4) SEED DEFAULT POLICY (ONLY IF NO ACTIVE POLICY EXISTS)
-- ================================================================
INSERT INTO public.leave_policies (
  annual_paid_days, annual_unpaid_days, monthly_paid_cap, cap_type,
  half_day_allowed, penalty_slab1_limit, penalty_slab1_mult,
  penalty_slab2_limit, penalty_slab2_mult, penalty_slab3_mult,
  incentive_enabled, incentive_full_limit, incentive_half_limit,
  incentive_type, incentive_bonus_amount, consecutive_limit, same_day_rule,
  effective_from, status
)
SELECT
  15, 10, 2, 'SOFT',
  true, 5, 1.0,
  10, 1.5, 2.0,
  true, 6, 9,
  'BONUS', 0,
  3, 'AUTO_UPL',
  '2024-01-01', 'ACTIVE'
WHERE NOT EXISTS (
  SELECT 1 FROM public.leave_policies WHERE status = 'ACTIVE'
);

-- ================================================================
-- 5) FIX: SINGLE ACTIVE POLICY ENFORCEMENT
-- ================================================================

-- 5.1) Deactivate all but the most recent ACTIVE policy
UPDATE public.leave_policies
SET status = 'INACTIVE'
WHERE status = 'ACTIVE'
  AND id NOT IN (
    SELECT id
    FROM public.leave_policies
    WHERE status = 'ACTIVE'
    ORDER BY effective_from DESC, created_at DESC
    LIMIT 1
  );

-- 5.2) Trigger to auto-deactivate other ACTIVE policies when setting one ACTIVE
CREATE OR REPLACE FUNCTION public.deactivate_other_leave_policies()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    UPDATE public.leave_policies
    SET status = 'INACTIVE'
    WHERE id <> NEW.id
      AND status = 'ACTIVE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deactivate_other_leave_policies ON public.leave_policies;
CREATE TRIGGER trg_deactivate_other_leave_policies
BEFORE INSERT OR UPDATE OF status ON public.leave_policies
FOR EACH ROW
WHEN (NEW.status = 'ACTIVE')
EXECUTE FUNCTION public.deactivate_other_leave_policies();

-- ================================================================
-- 6) RPC: process_leave_allocation_v2 (Atomic & Transactional)
-- ================================================================
CREATE OR REPLACE FUNCTION public.process_leave_allocation_v2(
  p_request_id UUID,
  p_approver_id UUID
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
  v_staff RECORD;
  v_bal RECORD;
  v_pol RECORD;
  v_track RECORD;
  v_date DATE;
  v_day_weight NUMERIC(3,1);
  v_day_index INTEGER := 0;
  v_total_days INTEGER;
  v_alloc_type TEXT;
  v_multiplier NUMERIC(4,2);
  v_effective_month_cap NUMERIC;
  v_month_key_month INTEGER;
  v_month_key_year INTEGER;
  v_over_month_cap BOOLEAN;
  v_is_same_day BOOLEAN;
  v_calendar_days INTEGER;
BEGIN
  -- 1) LOCK & FETCH the request
  SELECT * INTO v_req FROM public.leave_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  
  -- Prevent redundant runs (idempotency)
  IF EXISTS (SELECT 1 FROM public.leave_days WHERE request_id = p_request_id) THEN
    -- If already allocated, just ensure status is correct and exit
    IF v_req.status <> 'APPROVED' THEN
      UPDATE public.leave_requests SET status = 'APPROVED', approved_by = p_approver_id, updated_at = NOW() WHERE id = p_request_id;
    END IF;
    RETURN;
  END IF;

  -- 2) LOCK & FETCH the staff's balances for all possible affected years
  -- We lock explicitly to prevent race conditions on balance deductions
  -- (Staff might have overlapping approvals being processed)
  v_calendar_days := (v_req.to_date - v_req.from_date) + 1;

  -- 3) Iterate through days locally
  v_total_days := v_calendar_days;
  
  FOR v_date IN SELECT generate_series(v_req.from_date, v_req.to_date, '1 day'::interval)::date LOOP
    -- 3a) Fetch policy for this specific date (versioned)
    SELECT * INTO v_pol
    FROM public.leave_policies
    WHERE effective_from <= v_date
      AND (effective_to IS NULL OR effective_to >= v_date)
    ORDER BY status = 'ACTIVE' DESC, created_at DESC
    LIMIT 1;

    IF v_pol IS NULL THEN RAISE EXCEPTION 'No policy found for date %', v_date; END IF;

    -- Enforcement: Consecutive limit check (Bypass if it reaches here, as Approval Hub or Manager has already vetted)
    -- IF v_calendar_days > v_pol.consecutive_limit THEN
    --   RAISE EXCEPTION 'Policy Violation: Consecutive leave limit (%) exceeded.', v_pol.consecutive_limit;
    -- END IF;

    -- Enforcement: Same day rule
    v_is_same_day := (v_date = v_req.created_at::date);
    IF v_is_same_day AND v_pol.same_day_rule = 'REQUIRE_APPROVAL' AND v_req.status = 'PENDING' AND auth.uid() = v_req.staff_id THEN
      -- This is a soft check, usually handled by UI/Workflow, but we keep it here for API safety
      -- Logically, if the approver is NOT the staff, we allow it.
    END IF;

    -- 3b) Fetch/Create Balance for the year (Locked)
    v_month_key_year := EXTRACT(YEAR FROM v_date);
    v_month_key_month := EXTRACT(MONTH FROM v_date);

    -- Ensure balance exists and lock it
    INSERT INTO public.leave_balances (staff_id, year, paid_balance, unpaid_balance, penalty_count, total_leaves_taken)
    VALUES (v_req.staff_id, v_month_key_year, v_pol.annual_paid_days, v_pol.annual_unpaid_days, 0, 0)
    ON CONFLICT (staff_id, year) DO NOTHING;

    SELECT * INTO v_bal 
    FROM public.leave_balances 
    WHERE staff_id = v_req.staff_id AND year = v_month_key_year 
    FOR UPDATE;

    -- 3c) Fetch/Create Monthly Tracking
    INSERT INTO public.leave_monthly_tracking (staff_id, year, month, paid_used)
    VALUES (v_req.staff_id, v_month_key_year, v_month_key_month, 0)
    ON CONFLICT (staff_id, year, month) DO NOTHING;

    SELECT * INTO v_track 
    FROM public.leave_monthly_tracking 
    WHERE staff_id = v_req.staff_id AND year = v_month_key_year AND month = v_month_key_month 
    FOR UPDATE;

    -- 3d) Calculate day weight
    v_day_weight := 1.0;
    IF v_day_index = 0 AND v_req.start_day_type = 'HALF' THEN v_day_weight := 0.5;
    ELSIF v_day_index = v_total_days - 1 AND v_req.end_day_type = 'HALF' THEN v_day_weight := 0.5;
    END IF;
    v_day_index := v_day_index + 1;

    IF v_day_weight < 1 AND NOT v_pol.half_day_allowed THEN RAISE EXCEPTION 'Half-days are not allowed in policy.'; END IF;

    -- 3e) Allocation Logic (Bucket-Filling with Split-Day Support)
    v_effective_month_cap := CASE WHEN v_pol.monthly_paid_cap >= 0 THEN v_pol.monthly_paid_cap ELSE 999 END;
    
    WHILE v_day_weight > 0 LOOP
      DECLARE
        v_can_allocate NUMERIC(3,1);
      BEGIN
        -- Option 1: PAID
        IF v_bal.paid_balance > 0 AND v_track.paid_used < v_effective_month_cap THEN
          v_alloc_type := 'PAID';
          v_multiplier := 1.0;
          v_can_allocate := LEAST(v_day_weight, v_bal.paid_balance, v_effective_month_cap - v_track.paid_used);
          
          v_bal.paid_balance := v_bal.paid_balance - v_can_allocate;
          v_track.paid_used := v_track.paid_used + v_can_allocate;

        -- Option 2: UNPAID
        ELSIF v_bal.unpaid_balance > 0 THEN
          IF v_track.paid_used >= v_effective_month_cap AND v_pol.cap_type = 'HARD' THEN
            RAISE EXCEPTION 'Hard monthly cap of % reached. Cannot allocate unpaid leave.', v_pol.monthly_paid_cap;
          END IF;
          v_alloc_type := 'UNPAID';
          v_multiplier := 1.0;
          v_can_allocate := LEAST(v_day_weight, v_bal.unpaid_balance);
          
          v_bal.unpaid_balance := v_bal.unpaid_balance - v_can_allocate;

        -- Option 3: PENALTY
        ELSE
          IF v_track.paid_used >= v_effective_month_cap AND v_pol.cap_type = 'HARD' THEN
            RAISE EXCEPTION 'Hard monthly cap reached. Cannot allocate penalty leave.';
          END IF;
          v_alloc_type := 'PENALTY';
          v_can_allocate := v_day_weight;
          
          -- Penalty count increases before slab multiplier calculation
          v_bal.penalty_count := v_bal.penalty_count + v_can_allocate;
          
          -- Slab Logic
          IF v_bal.penalty_count <= v_pol.penalty_slab1_limit THEN v_multiplier := v_pol.penalty_slab1_mult;
          ELSIF v_bal.penalty_count <= v_pol.penalty_slab2_limit THEN v_multiplier := v_pol.penalty_slab2_mult;
          ELSE v_multiplier := v_pol.penalty_slab3_mult;
          END IF;
        END IF;

        v_bal.total_leaves_taken := v_bal.total_leaves_taken + v_can_allocate;
        v_day_weight := v_day_weight - v_can_allocate;

        -- Update Balances & Trackers (Intermediate)
        UPDATE public.leave_balances 
        SET paid_balance = v_bal.paid_balance, 
            unpaid_balance = v_bal.unpaid_balance, 
            penalty_count = v_bal.penalty_count, 
            total_leaves_taken = v_bal.total_leaves_taken,
            updated_at = NOW()
        WHERE id = v_bal.id;

        UPDATE public.leave_monthly_tracking SET paid_used = v_track.paid_used, updated_at = NOW() WHERE id = v_track.id;

        -- Insert/Update Day Allocation
        INSERT INTO public.leave_days (request_id, staff_id, leave_date, day_count, allocation_type, deduction_multiplier, policy_version_id)
        VALUES (v_req.id, v_req.staff_id, v_date, v_can_allocate, v_alloc_type, v_multiplier, v_pol.id)
        ON CONFLICT (request_id, leave_date, allocation_type) 
        DO UPDATE SET day_count = leave_days.day_count + EXCLUDED.day_count;
      END;
    END LOOP;

  END LOOP;

  -- 4) Finalize Request Status & Incentives
  -- Recalculate incentive for any years touched
    FOR v_bal IN SELECT * FROM public.leave_balances WHERE staff_id = v_req.staff_id AND year IN (
        SELECT DISTINCT EXTRACT(YEAR FROM leave_date) FROM public.leave_days WHERE request_id = p_request_id
    ) LOOP
        DECLARE
            v_p RECORD;
        BEGIN
            SELECT * INTO v_p FROM public.leave_policies WHERE status = 'ACTIVE' LIMIT 1;
            IF v_p IS NOT NULL AND v_p.incentive_enabled THEN
                UPDATE public.leave_balances SET incentive_status = 
                    CASE WHEN v_bal.total_leaves_taken <= v_p.incentive_full_limit THEN 'ELIGIBLE'::text
                         WHEN v_bal.total_leaves_taken <= v_p.incentive_half_limit THEN 'HALF'::text
                         ELSE 'NOT_ELIGIBLE'::text END
                WHERE id = v_bal.id;
            END IF;
        END;
    END LOOP;

  UPDATE public.leave_requests 
  SET status = 'APPROVED', 
      approved_by = p_approver_id, 
      policy_version_id = (SELECT policy_version_id FROM public.leave_days WHERE request_id = p_request_id LIMIT 1),
      updated_at = NOW() 
  WHERE id = p_request_id;

END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 7) RPC: process_leave_reversal (Atomic & Transactional)
-- ================================================================

-- 6.1) Reversal RPC
CREATE OR REPLACE FUNCTION public.process_leave_reversal(
  p_request_id UUID,
  p_new_status VARCHAR, -- 'CANCELLED' or 'REVOKED'
  p_admin_id UUID DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
  v_day RECORD;
  v_bal RECORD;
  v_req_month INTEGER;
  v_req_year INTEGER;
  v_req_date DATE;
  v_pol RECORD;
BEGIN
  -- 1) Get the leave request
  SELECT * INTO v_req
  FROM public.leave_requests
  WHERE id = p_request_id;

  IF v_req IS NULL THEN
    RAISE EXCEPTION 'Leave request not found';
  END IF;

  IF v_req.status IN ('CANCELLED', 'REVOKED') THEN
    RAISE EXCEPTION 'Leave request is already cancelled or revoked';
  END IF;

  v_req_date := v_req.from_date;
  v_req_year := EXTRACT(YEAR FROM v_req_date);
  v_req_month := EXTRACT(MONTH FROM v_req_date);

  -- 1.1) ENFORCE CANCELLATION/REVOCATION POLICY
  -- Find policy for the request (use policy version if available, else active)
  SELECT * INTO v_pol
  FROM public.leave_policies
  WHERE id = v_req.policy_version_id
  OR (status = 'ACTIVE' AND effective_from <= v_req_date)
  ORDER BY status = 'ACTIVE' DESC, created_at DESC
  LIMIT 1;

  IF v_pol IS NOT NULL THEN
     -- Cancellation rules
     IF p_new_status = 'CANCELLED' THEN
        IF v_req_date = CURRENT_DATE AND NOT v_pol.cancel_same_day_allowed THEN
           RAISE EXCEPTION 'Same-day cancellation is disabled by policy.';
        END IF;
        IF v_req_date > CURRENT_DATE AND (v_req_date - CURRENT_DATE) < v_pol.cancel_future_days_notice THEN
           RAISE EXCEPTION 'Cancellation requires % days notice.', v_pol.cancel_future_days_notice;
        END IF;
     END IF;
     -- Revocation rules
     IF p_new_status = 'REVOKED' THEN
        IF v_req_date < CURRENT_DATE AND NOT v_pol.revoke_past_allowed THEN
           RAISE EXCEPTION 'Revoking past leaves is disabled by policy.';
        END IF;
     END IF;
     -- Payroll lockout
     IF v_pol.payroll_lock_protection AND EXISTS (SELECT 1 FROM public.leave_days WHERE request_id = p_request_id AND payroll_locked = true) THEN
        RAISE EXCEPTION 'Cannot reverse leave: One or more days are already locked in payroll.';
     END IF;
  END IF;

  -- 2) Update the status
  UPDATE public.leave_requests
  SET status = p_new_status,
      updated_at = NOW()
  WHERE id = p_request_id;

  -- 3) Revert changes based on allocated leave_days
  FOR v_day IN
    SELECT * FROM public.leave_days WHERE request_id = p_request_id
  LOOP
    -- Each day might belong to a different month/year (multi-month/year requests)
    v_req_year := EXTRACT(YEAR FROM v_day.leave_date);
    v_req_month := EXTRACT(MONTH FROM v_day.leave_date);

    -- Get balance for the specific year of this day
    SELECT * INTO v_bal
    FROM public.leave_balances
    WHERE staff_id = v_req.staff_id
      AND year = v_req_year;

    IF v_bal IS NOT NULL THEN
      IF v_day.allocation_type = 'PAID' THEN
        UPDATE public.leave_balances
        SET paid_balance = paid_balance + v_day.day_count,
            total_leaves_taken = GREATEST(0, total_leaves_taken - v_day.day_count),
            updated_at = NOW()
        WHERE id = v_bal.id;

        -- Update monthly tracking for the specific month/year of this day
        UPDATE public.leave_monthly_tracking
        SET paid_used = GREATEST(0, paid_used - v_day.day_count),
            updated_at = NOW()
        WHERE staff_id = v_req.staff_id
          AND year = v_req_year
          AND month = v_req_month;

      ELSIF v_day.allocation_type = 'UNPAID' THEN
        UPDATE public.leave_balances
        SET unpaid_balance = unpaid_balance + v_day.day_count,
            total_leaves_taken = GREATEST(0, total_leaves_taken - v_day.day_count),
            updated_at = NOW()
        WHERE id = v_bal.id;

      ELSIF v_day.allocation_type = 'PENALTY' THEN
        UPDATE public.leave_balances
        SET penalty_count = GREATEST(0, penalty_count - v_day.day_count),
            total_leaves_taken = GREATEST(0, total_leaves_taken - v_day.day_count),
            updated_at = NOW()
        WHERE id = v_bal.id;
      END IF;
    END IF;
  END LOOP;

    -- 5) Recalculate Incentive Status for each modified year
    -- Correctly identifies the years from leave_days before deletion
    FOR v_bal IN
      SELECT DISTINCT b.*
      FROM public.leave_balances b
      JOIN (
        SELECT DISTINCT EXTRACT(YEAR FROM leave_date) as y
        FROM public.leave_days WHERE request_id = p_request_id
        UNION
        SELECT EXTRACT(YEAR FROM v_req.from_date)
      ) y ON b.year = y.y
      WHERE b.staff_id = v_req.staff_id
    LOOP
      DECLARE
        v_p RECORD;
        v_new_status TEXT := 'NOT_ELIGIBLE';
      BEGIN
        -- Find policy for the specific year being recalculated
        SELECT * INTO v_p
        FROM public.leave_policies
        WHERE effective_from <= (v_bal.year || '-12-31')::DATE
        ORDER BY status = 'ACTIVE' DESC, effective_from DESC, created_at DESC
        LIMIT 1;

        IF v_p IS NOT NULL AND v_p.incentive_enabled THEN
          IF v_bal.total_leaves_taken <= v_p.incentive_full_limit THEN
            v_new_status := 'ELIGIBLE';
          ELSIF v_bal.total_leaves_taken <= v_p.incentive_half_limit THEN
            v_new_status := 'HALF';
          END IF;
        END IF;

        UPDATE public.leave_balances
        SET incentive_status = v_new_status,
            updated_at = NOW()
        WHERE id = v_bal.id;
      END;
    END LOOP;

    -- 6) Delete audit-day allocations (since request reversed)
    DELETE FROM public.leave_days
    WHERE request_id = p_request_id;

END;
$$ LANGUAGE plpgsql;

-- 6.2) Freeze leaves after Last Working Day (LWD)
CREATE OR REPLACE FUNCTION public.freeze_leaves_after_lwd(
  p_staff_id UUID,
  p_lwd DATE
) RETURNS VOID AS $$
DECLARE
  v_req RECORD;
BEGIN
  FOR v_req IN
    SELECT id, status
    FROM public.leave_requests
    WHERE staff_id = p_staff_id
      AND from_date > p_lwd
      AND status IN ('APPROVED', 'PENDING')
  LOOP
    IF v_req.status = 'APPROVED' THEN
      PERFORM public.process_leave_reversal(v_req.id, 'CANCELLED', NULL);
    ELSE
      UPDATE public.leave_requests
      SET status = 'CANCELLED',
          updated_at = NOW()
      WHERE id = v_req.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ================================================================
-- 7) DEVICES: PERMISSIONS COLUMN + PROVISION/DELETE RPCs
-- ================================================================

-- 7.1) Add permissions column to devices if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='devices'
      AND column_name='permissions'
  ) THEN
    ALTER TABLE public.devices
      ADD COLUMN permissions JSONB DEFAULT '{}'::jsonb;

    COMMENT ON COLUMN public.devices.permissions
    IS 'Device-level permissions matrix. Structure: { module_id: [action_id, ...] }. Stored directly on the device — independent of user/role assignments.';
  END IF;
END $$;

-- 7.2) Ensure user_id + email columns exist on devices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='devices' AND column_name='user_id'
  ) THEN
    ALTER TABLE public.devices
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='devices' AND column_name='email'
  ) THEN
    ALTER TABLE public.devices
      ADD COLUMN email VARCHAR(255);
  END IF;
END $$;

-- 7.4) RELAX DEVICE FINGERPRINT UNIQUENESS (for multiple logical terminals)
DO $$
BEGIN
    -- Drop the unique constraint if it exists (legacy constraint)
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'devices_device_fingerprint_key'
    ) THEN
        ALTER TABLE public.devices DROP CONSTRAINT devices_device_fingerprint_key;
    END IF;
    
    -- Ensure index exists for performance
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_devices_fingerprint') THEN
        CREATE INDEX idx_devices_fingerprint ON public.devices(device_fingerprint);
    END IF;
END $$;

-- 7.3) RPC: provision_device_account_v1
CREATE OR REPLACE FUNCTION public.provision_device_account_v1(
  p_device_id UUID,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Super Admin check (profile flag + email fallback)
  SELECT
    COALESCE(up.is_super_admin, FALSE) OR
    (au.email IS NOT NULL AND (
      au.email ILIKE 'super@%' OR
      au.email ILIKE 'admin@%' OR
      au.email ILIKE 'universal@%' OR
      au.email IN ('super@daybook.com', 'admin@daybook.com')
    ))
  INTO v_is_super_admin
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON au.id = up.id
  WHERE au.id = auth.uid();

  IF v_is_super_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Super Admins can provision terminal accounts.';
  END IF;

  -- Lookup the user ID
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = trim(p_email);

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'USER_NOT_FOUND',
      'message', 'No authentication account found with email: ' || p_email
    );
  END IF;

  -- Ensure user not linked to another device
  IF EXISTS (
    SELECT 1 FROM public.devices
    WHERE user_id = v_user_id AND id <> p_device_id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'USER_ALREADY_ASSIGNED',
      'message', 'The user account ' || p_email || ' is already assigned to another terminal.'
    );
  END IF;

  -- Update device record
  UPDATE public.devices
  SET user_id = v_user_id,
      email = trim(p_email)
  WHERE id = p_device_id;

  -- Ensure user_profile exists
  INSERT INTO public.user_profiles (id, is_super_admin)
  VALUES (v_user_id, FALSE)
  ON CONFLICT (id) DO NOTHING;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'message', 'Terminal successfully linked to account: ' || p_email
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'INTERNAL_ERROR',
    'message', SQLERRM
  );
END;
$$;

-- 7.4) RPC: delete_device_v1
CREATE OR REPLACE FUNCTION public.delete_device_v1(p_device_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_super_admin BOOLEAN;
BEGIN
  SELECT COALESCE(is_super_admin, FALSE)
  INTO v_is_super_admin
  FROM public.user_profiles
  WHERE id = auth.uid();

  IF v_is_super_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Super Admins can delete terminals.';
  END IF;

  DELETE FROM public.devices WHERE id = p_device_id;
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 7.5) Permissions for device RPCs
REVOKE EXECUTE ON FUNCTION public.provision_device_account_v1(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provision_device_account_v1(UUID, TEXT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_device_v1(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.delete_device_v1(UUID) TO authenticated;

-- Optional: force config reload (PostgREST)
NOTIFY pgrst, 'reload config';

-- ================================================================
-- 8) STAFF ECOSYSTEM MIGRATION (DEDUPED)
-- ================================================================

-- 8.1) staff_master (Core Identity)
CREATE TABLE IF NOT EXISTS public.staff_master (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. EMP-0001
  full_name VARCHAR(200) NOT NULL,
  photo_url TEXT,
  gender VARCHAR(20) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
  dob DATE,
  blood_group VARCHAR(10),
  marital_status VARCHAR(50) CHECK (marital_status IN ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED')),

  -- Contact
  primary_mobile VARCHAR(20) UNIQUE NOT NULL,
  secondary_mobile VARCHAR(20),
  email VARCHAR(100) UNIQUE,
  permanent_address TEXT,
  current_address TEXT,
  district VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(20),

  -- Employment
  department VARCHAR(100),
  reporting_manager_id UUID REFERENCES public.staff_master(id) ON DELETE SET NULL,
  doj DATE,
  employment_type VARCHAR(50) CHECK (employment_type IN ('PERMANENT', 'CONTRACT', 'INTERN', 'PART_TIME')),
  shift_timing VARCHAR(100),
  status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED')),

  -- Legal & Compliance
  offer_letter_collected BOOLEAN DEFAULT FALSE,
  id_proof_collected BOOLEAN DEFAULT FALSE,
  address_proof_collected BOOLEAN DEFAULT FALSE,
  agreement_signed BOOLEAN DEFAULT FALSE,
  bg_check_completed BOOLEAN DEFAULT FALSE,

  -- Audit
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  is_active BOOLEAN DEFAULT TRUE,
  is_deleted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8.2) staff_salary
CREATE TABLE IF NOT EXISTS public.staff_salary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID UNIQUE NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,

  basic_salary NUMERIC(15,2) DEFAULT 0,
  commission_rate NUMERIC(5,2) DEFAULT 0,
  bonus_eligible BOOLEAN DEFAULT FALSE,

  bank_name VARCHAR(150),
  account_number VARCHAR(100),
  ifsc_code VARCHAR(20),
  upi_id VARCHAR(100),

  pan_number VARCHAR(20),
  aadhaar_number VARCHAR(20),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8.3) staff_audit_log
CREATE TABLE IF NOT EXISTS public.staff_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id),
  action VARCHAR(100) NOT NULL,
  old_data JSONB,
  new_data JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8.5) Data migration from legacy staff_profiles -> staff_master
DO $$
DECLARE
  v_record RECORD;
  v_counter INT := 1;
  v_staff_code TEXT;
  v_admin_user_id UUID;
BEGIN
  -- find a system user for attribution if needed later
  SELECT id INTO v_admin_user_id
  FROM auth.users
  ORDER BY created_at
  LIMIT 1;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='staff_profiles'
  ) THEN
    FOR v_record IN
      SELECT * FROM public.staff_profiles ORDER BY created_at ASC
    LOOP
      v_staff_code := 'EMP-' || LPAD(v_counter::TEXT, 4, '0');

      INSERT INTO public.staff_master (
        id, staff_code, full_name, primary_mobile, email, department, status, created_at, updated_at
      )
      VALUES (
        v_record.id,
        v_staff_code,
        v_record.staff_name,
        COALESCE(v_record.phone, 'N/A-' || v_counter),
        v_record.email,
        v_record.designation,
        v_record.status,
        v_record.created_at,
        v_record.updated_at
      )
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO public.staff_salary (staff_id)
      VALUES (v_record.id)
      ON CONFLICT (staff_id) DO NOTHING;

      v_counter := v_counter + 1;
    END LOOP;
  END IF;
END $$;

-- 8.6) Update FK: user_profiles.staff_id -> staff_master.id
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_staff_id_fkey;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.staff_master(id) ON DELETE SET NULL;

-- 8.7) Update FK: system_audit_logs.staff_id -> staff_master.id
ALTER TABLE public.system_audit_logs
  DROP CONSTRAINT IF EXISTS system_audit_logs_staff_id_fkey;

ALTER TABLE public.system_audit_logs
  ADD CONSTRAINT system_audit_logs_staff_id_fkey
  FOREIGN KEY (staff_id) REFERENCES public.staff_master(id) ON DELETE SET NULL;

-- 8.8) Enable RLS on staff tables
ALTER TABLE public.staff_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_salary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_audit_log ENABLE ROW LEVEL SECURITY;

-- 8.9) RLS Policies (as provided)
DROP POLICY IF EXISTS "RLS: staff_master ALL" ON public.staff_master;
CREATE POLICY "RLS: staff_master ALL"
ON public.staff_master
FOR ALL TO authenticated
USING (
    public.has_permission('staff_mgmt','view') 
    OR id IN (SELECT id FROM public.posting_eligible_staff_view)
)
WITH CHECK (public.has_permission('staff_mgmt','manage_staff') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "RLS: staff_salary ALL" ON public.staff_salary;
CREATE POLICY "RLS: staff_salary ALL"
ON public.staff_salary
FOR ALL TO authenticated
USING (public.has_permission('staff_mgmt','view') OR public.get_is_super_admin())
WITH CHECK (public.has_permission('staff_mgmt','manage_staff') OR public.get_is_super_admin());


DROP POLICY IF EXISTS "RLS: staff_audit_log SELECT" ON public.staff_audit_log;
CREATE POLICY "RLS: staff_audit_log SELECT"
ON public.staff_audit_log
FOR SELECT TO authenticated
USING (public.has_permission('staff_mgmt','view') OR public.get_is_super_admin());

-- 8.10) updated_at triggers for staff tables
DROP TRIGGER IF EXISTS set_staff_master_timestamp ON public.staff_master;
CREATE TRIGGER set_staff_master_timestamp
BEFORE UPDATE ON public.staff_master
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_staff_salary_timestamp ON public.staff_salary;
CREATE TRIGGER set_staff_salary_timestamp
BEFORE UPDATE ON public.staff_salary
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

-- 8.11) Add duties column to roles (if roles exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='roles'
  ) THEN
    ALTER TABLE public.roles
      ADD COLUMN IF NOT EXISTS duties JSONB DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- ================================================================
-- 9) RPC: provision_staff_account_v1 (STAFF <-> AUTH USER LINK)
-- ================================================================
CREATE OR REPLACE FUNCTION public.provision_staff_account_v1(
  p_staff_id UUID,
  p_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Super Admin check
  SELECT
    COALESCE(up.is_super_admin, FALSE) OR
    (au.email IS NOT NULL AND (
      au.email ILIKE 'super@%' OR
      au.email ILIKE 'admin@%' OR
      au.email ILIKE 'universal@%' OR
      au.email IN ('super@daybook.com', 'admin@daybook.com')
    ))
  INTO v_is_super_admin
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON au.id = up.id
  WHERE au.id = auth.uid();

  IF v_is_super_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Super Admins can provision accounts.';
  END IF;

  -- Lookup user
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = trim(p_email);

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'USER_NOT_FOUND',
      'message', 'No authentication account found with email: ' || p_email
    );
  END IF;

  -- Staff already linked?
  IF EXISTS (SELECT 1 FROM public.user_profiles WHERE staff_id = p_staff_id) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_LINKED',
      'message', 'This staff member is already linked to a user account.'
    );
  END IF;

  -- User already assigned to another staff?
  IF EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND staff_id IS NOT NULL
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'USER_ALREADY_ASSIGNED',
      'message', 'The user account ' || p_email || ' is already assigned to another staff member.'
    );
  END IF;

  -- Upsert link into user_profiles
  INSERT INTO public.user_profiles (id, staff_id, is_super_admin)
  VALUES (v_user_id, p_staff_id, FALSE)
  ON CONFLICT (id) DO UPDATE
  SET staff_id = EXCLUDED.staff_id;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'message', 'Staff profile successfully linked to account: ' || p_email
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'INTERNAL_ERROR',
    'message', SQLERRM
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.provision_staff_account_v1(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provision_staff_account_v1(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- 10) RPC: upsert_user_org_access_v1
-- ================================================================
CREATE OR REPLACE FUNCTION public.upsert_user_org_access_v1(
  p_user_id UUID,
  p_role_id UUID,
  p_scope_type TEXT,
  p_scope_id UUID DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS public.user_org_access
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result public.user_org_access;
BEGIN
  IF NOT (public.has_permission('role_mgmt', 'manage_org') OR public.get_is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: Insufficient privileges to manage role assignments.';
  END IF;

  IF p_scope_id IS NOT NULL THEN
    INSERT INTO public.user_org_access (user_id, role_id, scope_type, scope_id, is_active)
    VALUES (p_user_id, p_role_id, p_scope_type, p_scope_id, p_is_active)
    ON CONFLICT (user_id, role_id, scope_type, scope_id)
      WHERE scope_id IS NOT NULL
    DO UPDATE SET is_active = EXCLUDED.is_active
    RETURNING * INTO v_result;
  ELSE
    INSERT INTO public.user_org_access (user_id, role_id, scope_type, scope_id, is_active)
    VALUES (p_user_id, p_role_id, p_scope_type, NULL, p_is_active)
    ON CONFLICT (user_id, role_id, scope_type)
      WHERE scope_id IS NULL
    DO UPDATE SET is_active = EXCLUDED.is_active
    RETURNING * INTO v_result;
  END IF;

  RETURN v_result;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- 11) OPTIONAL: DEMO PROMOTIONS / DIAGNOSTICS (KEPT AS-IS, NOT DUPED)
-- ================================================================

-- Promote user@123.com -> User Admin (GLOBAL)
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
  v_target_email TEXT := 'user@123.com';
  v_target_role TEXT := 'User Admin';
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_target_email;
  SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_target_role;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found. Please sign up user@123.com in the app first.';
  END IF;

  INSERT INTO public.user_profiles (id, is_super_admin)
  VALUES (v_user_id, false)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_access
    WHERE user_id = v_user_id
      AND role_id = v_role_id
      AND scope_type = 'GLOBAL'
  ) THEN
    INSERT INTO public.user_org_access (user_id, role_id, scope_type, is_active)
    VALUES (v_user_id, v_role_id, 'GLOBAL', true);
  END IF;
END $$;

-- Promote master@123.com -> Master Admin (GLOBAL)
DO $$
DECLARE
  v_user_id UUID;
  v_role_id UUID;
  v_target_email TEXT := 'master@123.com';
  v_target_role TEXT := 'Master Admin';
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = v_target_email;
  SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_target_role;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found. Please ensure the user has signed up first.';
  END IF;

  INSERT INTO public.user_profiles (id, is_super_admin)
  VALUES (v_user_id, false)
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_org_access
    WHERE user_id = v_user_id
      AND role_id = v_role_id
      AND scope_type = 'GLOBAL'
  ) THEN
    INSERT INTO public.user_org_access (user_id, role_id, scope_type, is_active)
    VALUES (v_user_id, v_role_id, 'GLOBAL', true);
  END IF;
END $$;

-- Diagnostic: Check Master Admin Access
SELECT
  au.email,
  up.is_super_admin,
  r.role_name,
  uoa.scope_type,
  uoa.is_active,
  r.permissions
FROM auth.users au
LEFT JOIN public.user_profiles up ON au.id = up.id
LEFT JOIN public.user_org_access uoa ON au.id = uoa.user_id
LEFT JOIN public.roles r ON uoa.role_id = r.id
WHERE au.email = 'master@123.com';

-- Bootstrap Super Admin (temporarily disable protection trigger)
DO $$
BEGIN
  -- If the trigger doesn't exist, these statements are harmless in many setups,
  -- but some Postgres configs error on missing trigger name; keep as-is per your script.
  BEGIN
    ALTER TABLE public.user_profiles DISABLE TRIGGER trg_protect_super_admin;
  EXCEPTION WHEN undefined_object THEN
    -- ignore if trigger doesn't exist
    NULL;
  END;

  INSERT INTO public.user_profiles (id, is_super_admin)
  SELECT id, true
  FROM auth.users
  WHERE email = 'super@123.com'
  ON CONFLICT (id) DO UPDATE SET is_super_admin = true;

  BEGIN
    ALTER TABLE public.user_profiles ENABLE TRIGGER trg_protect_super_admin;
  EXCEPTION WHEN undefined_object THEN
    NULL;
  END;
END $$;

SELECT au.email, up.is_super_admin
FROM auth.users au
JOIN public.user_profiles up ON au.id = up.id
WHERE au.email = 'super@123.com';

-- ================================================================
-- 12) RPC: reset_user_management_v1
-- ================================================================
CREATE OR REPLACE FUNCTION public.reset_user_management_v1(
  p_confirm_phrase TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
DECLARE
  v_is_super_admin BOOLEAN;
  v_removed_staff INT;
  v_removed_mappings INT;
  v_removed_roles INT;
  v_removed_devices INT;
  v_removed_users INT;
BEGIN
  SELECT
    COALESCE(up.is_super_admin, FALSE) OR
    (au.email IS NOT NULL AND (
      au.email ILIKE 'super@%' OR
      au.email ILIKE 'admin@%' OR
      au.email ILIKE 'universal@%' OR
      au.email IN ('super@daybook.com', 'admin@daybook.com')
    ))
  INTO v_is_super_admin
  FROM auth.users au
  LEFT JOIN public.user_profiles up ON au.id = up.id
  WHERE au.id = auth.uid();

  IF v_is_super_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Only Super Admins can perform a system reset.';
  END IF;

  IF p_confirm_phrase IS DISTINCT FROM 'RESET USER MANAGEMENT' THEN
    RAISE EXCEPTION 'INVALID_CONFIRMATION: The confirmation phrase is incorrect.';
  END IF;

  -- Pre-clean: detach audit refs
  UPDATE public.system_audit_logs
  SET device_id = NULL,
      staff_id  = NULL,
      user_id   = NULL
  WHERE device_id IS NOT NULL
     OR staff_id IS NOT NULL
     OR user_id IS NOT NULL;

  -- A) Wipe Leave Management Data
  DELETE FROM public.leave_days WHERE id IS NOT NULL;
  DELETE FROM public.leave_requests WHERE id IS NOT NULL;
  DELETE FROM public.leave_monthly_tracking WHERE id IS NOT NULL;
  DELETE FROM public.leave_balances WHERE id IS NOT NULL;

  -- B) Wipe Attendance Data
  DELETE FROM public.attendance_records WHERE id IS NOT NULL;
  DELETE FROM public.delay_incidents WHERE id IS NOT NULL;

  -- C) Wipe Exit Management Data
  DELETE FROM public.exit_fnf_settlements WHERE id IS NOT NULL;
  DELETE FROM public.exit_clearance_tasks WHERE id IS NOT NULL;
  DELETE FROM public.exit_cases WHERE id IS NOT NULL;
  DELETE FROM public.exit_checklist_items WHERE id IS NOT NULL;
  DELETE FROM public.exit_checklist_templates WHERE id IS NOT NULL;

  -- D) Wipe Staff Sub-data
  DELETE FROM public.staff_salary WHERE id IS NOT NULL;
  DELETE FROM public.staff_audit_log WHERE id IS NOT NULL;

  -- E) Wipe Shift Groups (Nullify references first to avoid FK violation)
  UPDATE public.staff_master SET shift_group_id = NULL WHERE shift_group_id IS NOT NULL;
  DELETE FROM public.shift_groups WHERE id IS NOT NULL;

  -- F) Wipe devices
  DELETE FROM public.devices WHERE id IS NOT NULL;
  GET DIAGNOSTICS v_removed_devices = ROW_COUNT;

  -- E) Wipe access mappings for non-admin roles
  DELETE FROM public.user_org_access
  WHERE role_id NOT IN (SELECT id FROM public.roles WHERE category = 'ADMIN');
  GET DIAGNOSTICS v_removed_mappings = ROW_COUNT;

  -- F) Wipe job roles
  DELETE FROM public.roles
  WHERE category = 'JOB';
  GET DIAGNOSTICS v_removed_roles = ROW_COUNT;

  -- G) Wipe non-super-admin profiles (protect admin-mapped users + caller)
  DELETE FROM public.user_profiles
  WHERE is_super_admin = FALSE
    AND id <> auth.uid()
    AND id NOT IN (
      SELECT uoa.user_id
      FROM public.user_org_access uoa
      JOIN public.roles r ON uoa.role_id = r.id
      WHERE r.category = 'ADMIN'
    );
  GET DIAGNOSTICS v_removed_users = ROW_COUNT;

  -- H) Wipe staff_profiles / staff_master not protected
  WITH protected_staff AS (
    SELECT staff_id
    FROM public.user_profiles
    WHERE is_super_admin = TRUE
       OR id = auth.uid()
       OR id IN (
         SELECT uoa.user_id
         FROM public.user_org_access uoa
         JOIN public.roles r ON uoa.role_id = r.id
         WHERE r.category = 'ADMIN'
       )
  )
  DELETE FROM public.staff_master
  WHERE id NOT IN (
    SELECT staff_id FROM protected_staff WHERE staff_id IS NOT NULL
  );
  GET DIAGNOSTICS v_removed_staff = ROW_COUNT;

  -- Audit log
  INSERT INTO public.system_audit_logs (
    user_id, action_type, table_name, reason, new_data
  )
  VALUES (
    auth.uid(),
    'RESET_USER_MANAGEMENT',
    'MULTI_TABLE',
    'Full reset of User Management operational data.',
    jsonb_build_object(
      'removed_staff', v_removed_staff,
      'removed_mappings', v_removed_mappings,
      'removed_roles', v_removed_roles,
      'removed_devices', v_removed_devices,
      'removed_users', v_removed_users
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'User Management reset successfully.',
    'stats', jsonb_build_object(
      'staff', v_removed_staff,
      'mappings', v_removed_mappings,
      'roles', v_removed_roles,
      'devices', v_removed_devices,
      'users', v_removed_users
    )
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', FALSE,
    'message', SQLERRM,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_user_management_v1(TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reset_user_management_v1(TEXT) TO authenticated;

COMMIT;





ALTER TABLE IF EXISTS public.staff_master 
ADD COLUMN IF NOT EXISTS basic_pay numeric(20, 2);

COMMENT ON COLUMN public.staff_master.basic_pay IS 'Basic remuneration amount for the employee';



-- Migration: Add Device Departments
BEGIN;

-- 1. Create Departments Table
CREATE TABLE IF NOT EXISTS public.device_departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Handle single default department constraint
CREATE OR REPLACE FUNCTION public.handle_device_department_default()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default THEN
        UPDATE public.device_departments 
        SET is_default = FALSE 
        WHERE id <> NEW.id AND is_default = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_department_default ON public.device_departments;
CREATE TRIGGER trg_device_department_default
BEFORE INSERT OR UPDATE OF is_default ON public.device_departments
FOR EACH ROW WHEN (NEW.is_default = TRUE)
EXECUTE FUNCTION public.handle_device_department_default();

-- 3. Add department_id to devices
ALTER TABLE public.devices 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.device_departments(id) ON DELETE SET NULL;

-- 4. Audit Triggers
-- Note: handle_updated_at() is assumed to exist from previous migrations (SUPA2.sql)
DROP TRIGGER IF EXISTS trg_device_departments_updated_at ON public.device_departments;
CREATE TRIGGER trg_device_departments_updated_at 
BEFORE UPDATE ON public.device_departments 
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Row Level Security
ALTER TABLE public.device_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_departments: SELECT" ON public.device_departments;
CREATE POLICY "device_departments: SELECT" ON public.device_departments
FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "device_departments: ALL" ON public.device_departments;
CREATE POLICY "device_departments: ALL" ON public.device_departments
FOR ALL TO authenticated 
USING (public.has_permission('device_mgmt', 'manage_devices') OR public.get_is_super_admin())
WITH CHECK (public.has_permission('device_mgmt', 'manage_devices') OR public.get_is_super_admin());

COMMIT;
















-- Migration: Shift Assignment & Roster Versioning (Phase 1)
CREATE EXTENSION IF NOT EXISTS btree_gist;
BEGIN;

-- 1. Enum for Shift Assignment Sources
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_source_type') THEN
        CREATE TYPE shift_source_type AS ENUM ('BASE', 'ROSTER', 'OVERRIDE');
    END IF;
END $$;

-- 2. Shift Assignments Table (Effective-dated Layers)
CREATE TABLE IF NOT EXISTS public.shift_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    shift_group_id UUID NOT NULL REFERENCES public.shift_groups(id),
    source shift_source_type NOT NULL DEFAULT 'BASE',
    effective_from DATE NOT NULL,
    effective_to DATE, -- NULL means until further notice
    status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'LOCKED')),
    reason TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Temporal Overlap Protection
    CONSTRAINT shift_assignment_overlap EXCLUDE USING gist (
        staff_id WITH =,
        source WITH =,
        daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
    )
);

-- 3. Hierarchical Resolver Function
CREATE OR REPLACE FUNCTION public.get_effective_shift(
    p_staff_id UUID,
    p_date DATE
)
RETURNS TABLE (
    shift_group_id UUID,
    source shift_source_type,
    assignment_id UUID
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sa.shift_group_id,
        sa.source,
        sa.id as assignment_id
    FROM public.shift_assignments sa
    WHERE sa.staff_id = p_staff_id
      AND sa.status = 'PUBLISHED'
      AND sa.effective_from <= p_date
      AND (sa.effective_to IS NULL OR sa.effective_to >= p_date)
    ORDER BY 
        CASE 
            WHEN sa.source = 'OVERRIDE' THEN 1
            WHEN sa.source = 'ROSTER' THEN 2
            WHEN sa.source = 'BASE' THEN 3
            ELSE 4
        END ASC,
        sa.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Initial Migration: Sync existing shift assignments from staff_master
-- This populates the 'BASE' layer for everyone who already has a shift group.
INSERT INTO public.shift_assignments (staff_id, shift_group_id, source, effective_from)
SELECT 
    id as staff_id, 
    shift_group_id, 
    'BASE'::shift_source_type, 
    COALESCE(doj, created_at::date, CURRENT_DATE)
FROM public.staff_master
WHERE shift_group_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 5. Updated_at Trigger
DROP TRIGGER IF EXISTS trg_shift_assignments_updated_at ON public.shift_assignments;
CREATE TRIGGER trg_shift_assignments_updated_at 
BEFORE UPDATE ON public.shift_assignments 
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. RLS Policies
ALTER TABLE public.shift_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shift_assignments: SELECT" ON public.shift_assignments;
CREATE POLICY "shift_assignments: SELECT"
ON public.shift_assignments
FOR SELECT TO authenticated
USING (public.has_permission('hr_attendance', 'view'));

DROP POLICY IF EXISTS "shift_assignments: INSERT/UPDATE" ON public.shift_assignments;
CREATE POLICY "shift_assignments: INSERT/UPDATE"
ON public.shift_assignments
FOR ALL TO authenticated
USING (public.has_permission('hr_settings', 'edit') OR public.get_is_super_admin())
WITH CHECK (public.has_permission('hr_settings', 'edit') OR public.get_is_super_admin());

COMMIT;













-- Migration: Fix Temporal Design for Real Operations
BEGIN;

-- 1. Add workday boundary to shift_groups
ALTER TABLE public.shift_groups 
ADD COLUMN IF NOT EXISTS boundary_start_time TIME DEFAULT '06:00:00';

-- 2. Add timezone tracking to system
ALTER TABLE public.system_configurations ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'UTC';

-- 3. Ensure all punch columns are TIMESTAMPTZ (Audit/Hardening)
DO $$
BEGIN
    ALTER TABLE public.attendance_records 
    ALTER COLUMN punch_in TYPE TIMESTAMPTZ,
    ALTER COLUMN break_start TYPE TIMESTAMPTZ,
    ALTER COLUMN break_end TYPE TIMESTAMPTZ,
    ALTER COLUMN punch_out TYPE TIMESTAMPTZ;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Punch columns already hardened or conversion failed.';
END $$;

COMMIT;











-- Migration: Add Device Departments
BEGIN;

-- 1. Create Departments Table
CREATE TABLE IF NOT EXISTS public.device_departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Handle single default department constraint
CREATE OR REPLACE FUNCTION public.handle_device_department_default()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default THEN
        UPDATE public.device_departments 
        SET is_default = FALSE 
        WHERE id <> NEW.id AND is_default = TRUE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_department_default ON public.device_departments;
CREATE TRIGGER trg_device_department_default
BEFORE INSERT OR UPDATE OF is_default ON public.device_departments
FOR EACH ROW WHEN (NEW.is_default = TRUE)
EXECUTE FUNCTION public.handle_device_department_default();

-- 3. Add department_id to devices
ALTER TABLE public.devices 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.device_departments(id) ON DELETE SET NULL;

-- 4. Audit Trigger
DROP TRIGGER IF EXISTS trg_device_departments_updated_at ON public.device_departments;
CREATE TRIGGER trg_device_departments_updated_at 
BEFORE UPDATE ON public.device_departments 
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 5. Row Level Security
ALTER TABLE public.device_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_departments: SELECT" ON public.device_departments;
CREATE POLICY "device_departments: SELECT" ON public.device_departments
FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "device_departments: ALL" ON public.device_departments;
CREATE POLICY "device_departments: ALL" ON public.device_departments
FOR ALL TO authenticated 
USING (public.has_permission('device_mgmt', 'manage_devices') OR public.get_is_super_admin())
WITH CHECK (public.has_permission('device_mgmt', 'manage_devices') OR public.get_is_super_admin());

COMMIT;


























-- Migration: Deterministic Attendance Pipeline (Phase 1-6)
-- Target: Ingestion, Normalization, Pairing, and Computing logic
BEGIN;

-- 1. Raw Attendance Events (Stage 1: Immutable Ingestion)
CREATE TABLE IF NOT EXISTS public.raw_attendance_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    event_timestamp TIMESTAMPTZ NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('PUNCH_IN', 'PUNCH_OUT', 'BREAK_START', 'BREAK_END', 'MANUAL_CORRECTION', 'AUTO_JOB')),
    source TEXT NOT NULL DEFAULT 'DEVICE', -- e.g., 'DEVICE', 'WEB_UI', 'MOBILE', 'SYSTEM'
    idempotency_key TEXT UNIQUE, -- Prevents duplicate ingestion of the same event
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_events_staff_time ON public.raw_attendance_events(staff_id, event_timestamp);

-- 2. Attendance Summaries (Stage 9: Persistence)
CREATE TABLE IF NOT EXISTS public.attendance_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    
    -- Computed Metrics
    primary_status TEXT NOT NULL DEFAULT 'ABSENT',
    worked_minutes_gross INTEGER DEFAULT 0,
    worked_minutes_net INTEGER DEFAULT 0,
    late_minutes INTEGER DEFAULT 0,
    early_out_minutes INTEGER DEFAULT 0,
    overtime_minutes INTEGER DEFAULT 0,
    
    -- Context Snapshot (For Determinism)
    shift_id UUID REFERENCES public.shift_groups(id),
    policy_id UUID REFERENCES public.leave_policies(id),
    assignment_id UUID REFERENCES public.shift_assignments(id),
    
    -- Audit & Integrity
    raw_punch_in TIMESTAMPTZ,
    raw_punch_out TIMESTAMPTZ,
    anomaly_flags TEXT[] DEFAULT '{}',
    compute_metadata JSONB DEFAULT '{}'::jsonb, -- Stores compute versions, hashes, etc.
    is_locked BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES public.user_profiles(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_summaries_date ON public.attendance_summaries(attendance_date);

-- 3. Stage 1 & 2 logic: Normalized Events Resolver
CREATE OR REPLACE FUNCTION public.get_normalized_events(
    p_staff_id UUID,
    p_date DATE,
    p_boundary_start TIME DEFAULT '06:00:00'
)
RETURNS TABLE (
    event_id UUID,
    event_timestamp TIMESTAMPTZ,
    event_type TEXT,
    event_rank BIGINT
) AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_timezone TEXT;
BEGIN
    -- Resolve timezone
    SELECT timezone INTO v_timezone FROM public.system_configurations LIMIT 1;
    v_timezone := COALESCE(v_timezone, 'UTC');

    -- Calculate the attendance window
    v_window_start := (p_date + p_boundary_start)::TIMESTAMP AT TIME ZONE v_timezone;
    v_window_end := v_window_start + INTERVAL '24 hours';

    RETURN QUERY
    WITH raw_ordered AS (
        SELECT 
            id, 
            event_timestamp, 
            event_type,
            ROW_NUMBER() OVER (PARTITION BY event_timestamp, event_type ORDER BY created_at ASC) as tie_breaker
        FROM public.raw_attendance_events
        WHERE staff_id = p_staff_id
          AND event_timestamp >= v_window_start
          AND event_timestamp < v_window_end
    )
    SELECT 
        id as event_id,
        raw_ordered.event_timestamp,
        raw_ordered.event_type,
        ROW_NUMBER() OVER (ORDER BY raw_ordered.event_timestamp ASC, raw_ordered.event_type ASC) as event_rank
    FROM raw_ordered
    WHERE tie_breaker = 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 4. Stage 3 & 4 logic: Session Pairing Engine
CREATE OR REPLACE FUNCTION public.get_attendance_sessions(
    p_staff_id UUID,
    p_date DATE,
    p_boundary_start TIME DEFAULT '06:00:00'
)
RETURNS TABLE (
    session_index INTEGER,
    in_timestamp TIMESTAMPTZ,
    out_timestamp TIMESTAMPTZ,
    duration_minutes INTEGER,
    is_anomaly BOOLEAN,
    anomaly_reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH normalized AS (
        SELECT * FROM public.get_normalized_events(p_staff_id, p_date, p_boundary_start)
    ),
    paired AS (
        SELECT 
            e.event_timestamp as tin,
            e.event_type as type_in,
            LEAD(e.event_timestamp) OVER (ORDER BY e.event_timestamp) as tout,
            LEAD(e.event_type) OVER (ORDER BY e.event_timestamp) as type_out
        FROM normalized e
    ),
    refined AS (
        SELECT 
            tin as session_in,
            tout as session_out,
            CASE 
                WHEN type_in = 'PUNCH_IN' AND type_out = 'PUNCH_OUT' THEN FALSE
                ELSE TRUE
            END as anomaly,
            CASE
                WHEN type_in = 'PUNCH_IN' AND type_out IS NULL THEN 'MISSING_OUT'
                WHEN type_in = 'PUNCH_IN' AND type_out <> 'PUNCH_OUT' THEN 'DOUBLE_IN_OR_MISMATCH'
                ELSE NULL
            END as reason
        FROM paired
        WHERE type_in = 'PUNCH_IN'
    )
    SELECT 
        ROW_NUMBER() OVER (ORDER BY r.session_in ASC)::INTEGER,
        r.session_in,
        r.session_out,
        COALESCE(EXTRACT(EPOCH FROM (r.session_out - r.session_in)) / 60, 0)::INTEGER,
        r.anomaly,
        r.reason
    FROM refined r;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 5. Stage 5-8 logic: Shift Rules & Primary Status Resolver
DROP FUNCTION IF EXISTS public.resolve_primary_attendance_v1(UUID, DATE) CASCADE;

CREATE OR REPLACE FUNCTION public.resolve_primary_attendance_v1(
    p_staff_id UUID,
    p_date DATE
)
RETURNS TABLE (
    primary_status TEXT,
    worked_gross INTEGER,
    worked_net INTEGER,
    late_mins INTEGER,
    early_out_mins INTEGER,
    out_shift_id UUID,
    out_assignment_id UUID,
    out_anomaly_flags TEXT[],
    out_raw_in TIMESTAMPTZ,
    out_raw_out TIMESTAMPTZ
) AS $$
DECLARE
    v_context RECORD;
    v_shift RECORD;
    v_timezone TEXT;
    v_boundary TIME;
    v_shift_start TIMESTAMPTZ;
    v_shift_end TIMESTAMPTZ;
    v_total_gross INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_anomalies TEXT[] := '{}';
    v_net_minutes INTEGER := 0;
BEGIN
    -- 1. Resolve Context (Shift & Assignment)
    SELECT * INTO v_context FROM public.get_effective_shift(p_staff_id, p_date);
    
    IF v_context.shift_group_id IS NULL THEN
        RETURN QUERY SELECT 'ABSENT'::TEXT, 0, 0, 0, 0, NULL::UUID, NULL::UUID, ARRAY['NO_SHIFT_ASSIGNED'], NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    -- Fetch Shift Group details
    SELECT * INTO v_shift FROM public.shift_groups WHERE id = v_context.shift_group_id;
    
    -- Resolve Timezone
    SELECT timezone INTO v_timezone FROM public.system_configurations LIMIT 1;
    v_timezone := COALESCE(v_timezone, 'UTC');
    v_boundary := COALESCE(v_shift.boundary_start_time, '06:00:00');

    -- Calculate Shift Anchors
    v_shift_start := (p_date + v_shift.start_time)::TIMESTAMP AT TIME ZONE v_timezone;
    v_shift_end := (p_date + v_shift.end_time)::TIMESTAMP AT TIME ZONE v_timezone;
    
    IF v_shift.end_time <= v_shift.start_time THEN
        v_shift_end := v_shift_end + INTERVAL '24 hours';
    END IF;

    -- 2. Fetch Sessions
    SELECT 
        SUM(duration_minutes),
        MIN(in_timestamp),
        MAX(out_timestamp),
        ARRAY_AGG(anomaly_reason) FILTER (WHERE is_anomaly)
    INTO v_total_gross, v_first_in, v_last_out, v_anomalies
    FROM public.get_attendance_sessions(p_staff_id, p_date, v_boundary);

    v_total_gross := COALESCE(v_total_gross, 0);
    v_anomalies := COALESCE(v_anomalies, '{}');

    -- 3. Metrics
    late_mins := 0;
    IF v_first_in IS NOT NULL AND v_first_in > (v_shift_start + (v_shift.grace_in_minutes || ' minutes')::INTERVAL) THEN
        late_mins := EXTRACT(EPOCH FROM (v_first_in - (v_shift_start + (v_shift.grace_in_minutes || ' minutes')::INTERVAL))) / 60;
    END IF;

    early_out_mins := 0;
    IF v_last_out IS NOT NULL AND v_last_out < (v_shift_end - (v_shift.grace_out_minutes || ' minutes')::INTERVAL) THEN
        early_out_mins := EXTRACT(EPOCH FROM ((v_shift_end - (v_shift.grace_out_minutes || ' minutes')::INTERVAL) - v_last_out)) / 60;
    END IF;

    v_net_minutes := GREATEST(0, v_total_gross - COALESCE(v_shift.break_duration_minutes, 0));

    -- 4. Status Mapping
    IF COALESCE(array_length(v_anomalies, 1), 0) > 0 AND ('MISSING_OUT' = ANY(v_anomalies) OR 'DOUBLE_IN_OR_MISMATCH' = ANY(v_anomalies)) THEN
        primary_status := 'MISS_PUNCH';
    ELSIF v_total_gross = 0 THEN
        primary_status := 'ABSENT';
    ELSIF v_net_minutes >= (v_shift.min_hours_present * 60) THEN
        IF late_mins > 0 THEN primary_status := 'LATE_PRESENT';
        ELSIF early_out_mins > 0 THEN primary_status := 'EARLY_OUT';
        ELSE primary_status := 'PRESENT';
        END IF;
    ELSIF v_net_minutes >= (v_shift.min_hours_half_day * 60) THEN
        primary_status := 'HALF_DAY';
    ELSE
        primary_status := 'ABSENT';
    END IF;

    RETURN QUERY SELECT 
        primary_status, 
        v_total_gross, 
        v_net_minutes, 
        late_mins, 
        early_out_mins, 
        v_shift.id,
        v_context.assignment_id,
        v_anomalies,
        v_first_in,
        v_last_out;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 6. Stage 9 & 10: Master Orchestration RPC
CREATE OR REPLACE FUNCTION public.compute_attendance_day_v1(
    p_staff_id UUID,
    p_date DATE,
    p_force_recompute BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    v_summary_id UUID;
    v_primary_res RECORD;
    v_final_status TEXT;
    v_leave_exists BOOLEAN;
    v_holiday_exists BOOLEAN;
    v_manual_exists BOOLEAN;
    v_manual_status TEXT;
    v_existing_summary RECORD;
    v_anomalies TEXT[] := '{}';
BEGIN
    -- 0. Check for existing locked summary
    SELECT * INTO v_existing_summary 
    FROM public.attendance_summaries 
    WHERE staff_id = p_staff_id AND attendance_date = p_date;

    IF v_existing_summary.is_locked AND NOT p_force_recompute THEN
        RETURN v_existing_summary.id;
    END IF;

    -- 1. Run Stages 1-8
    SELECT * INTO v_primary_res FROM public.resolve_primary_attendance_v1(p_staff_id, p_date);
    v_final_status := v_primary_res.primary_status;
    v_anomalies := v_primary_res.out_anomaly_flags;

    -- 2. Stage 9: Hierarchy Overlay
    SELECT EXISTS (
        SELECT 1 FROM public.leave_days ld
        JOIN public.leave_requests lr ON lr.id = ld.request_id
        WHERE ld.staff_id = p_staff_id 
          AND ld.leave_date = p_date
          AND lr.status = 'APPROVED'
    ) INTO v_leave_exists;

    v_holiday_exists := FALSE; 

    SELECT status INTO v_manual_status 
    FROM public.attendance_records 
    WHERE staff_id = p_staff_id AND attendance_date = p_date AND is_verified = TRUE;
    
    v_manual_exists := (v_manual_status IS NOT NULL);

    IF v_manual_exists THEN
        v_final_status := v_manual_status;
        v_anomalies := v_anomalies || 'MANUAL_OVERRIDE';
    ELSIF v_leave_exists THEN
        v_final_status := 'LEAVE';
        v_anomalies := v_anomalies || 'LEAVE_OVERLAY';
    ELSIF v_holiday_exists THEN
        v_final_status := 'HOLIDAY';
        v_anomalies := v_anomalies || 'HOLIDAY_OVERLAY';
    END IF;

    -- 3. Stage 10: Persistence
    INSERT INTO public.attendance_summaries (
        staff_id,
        attendance_date,
        primary_status,
        worked_minutes_gross,
        worked_minutes_net,
        late_minutes,
        early_out_minutes,
        shift_id,
        assignment_id,
        anomaly_flags,
        raw_punch_in,
        raw_punch_out,
        compute_metadata
    ) VALUES (
        p_staff_id,
        p_date,
        v_final_status,
        v_primary_res.worked_gross,
        v_primary_res.worked_net,
        v_primary_res.late_mins,
        v_primary_res.early_out_mins,
        v_primary_res.out_shift_id,
        v_primary_res.out_assignment_id,
        v_anomalies,
        v_primary_res.out_raw_in,
        v_primary_res.out_raw_out,
        jsonb_build_object('version', '1.0.0', 'computed_at', NOW(), 'recompute', p_force_recompute)
    )
    ON CONFLICT (staff_id, attendance_date) DO UPDATE
    SET
        primary_status = EXCLUDED.primary_status,
        worked_minutes_gross = EXCLUDED.worked_minutes_gross,
        worked_minutes_net = EXCLUDED.worked_minutes_net,
        late_minutes = EXCLUDED.late_minutes,
        early_out_minutes = EXCLUDED.early_out_minutes,
        shift_id = EXCLUDED.shift_id,
        assignment_id = EXCLUDED.assignment_id,
        anomaly_flags = EXCLUDED.anomaly_flags,
        raw_punch_in = EXCLUDED.raw_punch_in,
        raw_punch_out = EXCLUDED.raw_punch_out,
        compute_metadata = EXCLUDED.compute_metadata,
        updated_at = NOW()
    RETURNING id INTO v_summary_id;

    RETURN v_summary_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Stage 5: Recompute & Lifecycle Management
CREATE OR REPLACE FUNCTION public.recompute_attendance_scope(
    p_start_date DATE,
    p_end_date DATE,
    p_staff_ids UUID[] DEFAULT NULL,
    p_force_recompute BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    recomputed_count INTEGER,
    errors_count INTEGER
) AS $$
DECLARE
    v_staff_id UUID;
    v_curr_date DATE;
    v_recomp_count INTEGER := 0;
    v_err_count INTEGER := 0;
BEGIN
    IF NOT (public.has_permission('hr_attendance', 'manage_attendance')) THEN
        RAISE EXCEPTION 'Unauthorized: Permission hr_attendance:manage_attendance required.';
    END IF;

    IF p_staff_ids IS NULL THEN
        SELECT ARRAY_AGG(id) INTO p_staff_ids FROM public.staff_master WHERE is_active = TRUE;
    END IF;

    FOR v_staff_id IN SELECT UNNEST(p_staff_ids)
    LOOP
        FOR v_curr_date IN SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date
        LOOP
            BEGIN
                PERFORM public.compute_attendance_day_v1(v_staff_id, v_curr_date, p_force_recompute);
                v_recomp_count := v_recomp_count + 1;
            EXCEPTION WHEN OTHERS THEN
                v_err_count := v_err_count + 1;
            END;
        END LOOP;
    END LOOP;

    RETURN QUERY SELECT v_recomp_count, v_err_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.lock_attendance_period(
    p_start_date DATE,
    p_end_date DATE,
    p_staff_ids UUID[] DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    IF NOT (public.get_is_super_admin() OR public.has_permission('hr_payroll', 'manage_payroll')) THEN
        RAISE EXCEPTION 'Unauthorized: Super admin or hr_payroll:manage_payroll required to lock periods.';
    END IF;

    UPDATE public.attendance_summaries
    SET is_locked = TRUE, updated_at = NOW()
    WHERE attendance_date >= p_start_date 
      AND attendance_date <= p_end_date
      AND (p_staff_ids IS NULL OR staff_id = ANY(p_staff_ids));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.unlock_attendance_period(
    p_start_date DATE,
    p_end_date DATE,
    p_staff_ids UUID[] DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    IF NOT public.get_is_super_admin() THEN
        RAISE EXCEPTION 'Unauthorized: Super admin required to unlock periods.';
    END IF;

    UPDATE public.attendance_summaries
    SET is_locked = FALSE, updated_at = NOW()
    WHERE attendance_date >= p_start_date 
      AND attendance_date <= p_end_date
      AND (p_staff_ids IS NULL OR staff_id = ANY(p_staff_ids));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissions
REVOKE ALL ON FUNCTION public.recompute_attendance_scope(DATE, DATE, UUID[], BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_attendance_scope(DATE, DATE, UUID[], BOOLEAN) TO authenticated;

REVOKE ALL ON FUNCTION public.lock_attendance_period(DATE, DATE, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_attendance_period(DATE, DATE, UUID[]) TO authenticated;

REVOKE ALL ON FUNCTION public.unlock_attendance_period(DATE, DATE, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unlock_attendance_period(DATE, DATE, UUID[]) TO authenticated;

-- 8. Phase 6: Quality Gates & Monitoring Dashboard
CREATE OR REPLACE VIEW public.view_attendance_anomalies_v1 AS
SELECT 
    asum.id,
    asum.attendance_date,
    asum.staff_id,
    sm.full_name,
    sm.staff_code,
    asum.primary_status,
    asum.anomaly_flags,
    asum.worked_minutes_net,
    asum.compute_metadata->>'version' as pipeline_version,
    asum.updated_at as last_computed
FROM public.attendance_summaries asum
JOIN public.staff_master sm ON sm.id = asum.staff_id
WHERE cardinality(asum.anomaly_flags) > 0;

CREATE OR REPLACE VIEW public.view_pipeline_health_v1 AS
SELECT 
    pipeline_version,
    COUNT(*) as total_records,
    SUM(CASE WHEN is_locked THEN 1 ELSE 0 END) as locked_records,
    SUM(CASE WHEN cardinality(anomaly_flags) > 0 THEN 1 ELSE 0 END) as anomaly_count,
    ROUND(AVG(worked_minutes_net), 2) as avg_work_minutes
FROM (
    SELECT 
        compute_metadata->>'version' as pipeline_version,
        is_locked,
        anomaly_flags,
        worked_minutes_net
    FROM public.attendance_summaries
) sub
GROUP BY pipeline_version;

GRANT SELECT ON public.view_attendance_anomalies_v1 TO authenticated;
GRANT SELECT ON public.view_pipeline_health_v1 TO authenticated;

-- 9. Triggers
DROP TRIGGER IF EXISTS trg_attendance_summaries_updated_at ON public.attendance_summaries;
CREATE TRIGGER trg_attendance_summaries_updated_at 
BEFORE UPDATE ON public.attendance_summaries 
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 10. RLS Policies
ALTER TABLE public.raw_attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "raw_attendance_events: SELECT" ON public.raw_attendance_events;
CREATE POLICY "raw_attendance_events: SELECT" ON public.raw_attendance_events
FOR SELECT TO authenticated USING (public.has_permission('hr_attendance', 'view'));

DROP POLICY IF EXISTS "attendance_summaries: SELECT" ON public.attendance_summaries;
CREATE POLICY "attendance_summaries: SELECT" ON public.attendance_summaries
FOR SELECT TO authenticated USING (public.has_permission('hr_attendance', 'view'));

COMMIT;











-- ================================================================
-- CONSOLIDATED MIGRATION (DEDUPED) - Attendance Pipeline + Incidents +
-- Corrections + Payroll Snapshot (Phase 1)
-- Notes / Assumptions:
--   - Assumes these already exist:
--     public.staff_master, public.user_profiles, public.shift_groups,
--     public.shift_assignments, public.leave_policies,
--     public.leave_days, public.leave_requests, public.attendance_records,
--     public.system_configurations (with timezone column),
--     public.handle_updated_at() trigger function,
--     public.has_permission(module, action), public.get_is_super_admin(),
--     auth.uid() (Supabase).
--   - Uses uuid_generate_v4() -> requires uuid-ossp extension.
-- ================================================================

BEGIN;

-- 0) EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================
-- 1) ENUMS
-- ================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'incident_state') THEN
        CREATE TYPE incident_state AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'REVOKED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_incident_type') THEN
        CREATE TYPE attendance_incident_type AS ENUM ('LATE', 'EARLY_OUT', 'MISS_PUNCH', 'ABSENT_COVER', 'OT_APPROVAL', 'GENERIC_EXCEPTION');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_correction_type') THEN
        CREATE TYPE attendance_correction_type AS ENUM ('MISSING_PUNCH', 'STATUS_DISPUTE', 'SHIFT_CORRECTION', 'PENALTY_WAIVER', 'OTHER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_correction_state') THEN
        CREATE TYPE attendance_correction_state AS ENUM ('DRAFT', 'SUBMITTED', 'MANAGER_REVIEW', 'HR_REVIEW', 'APPROVED', 'REJECTED', 'APPLIED');
    END IF;
END $$;

-- ================================================================
-- 2) CORE TABLES (RAW EVENTS + SUMMARIES)
-- ================================================================

-- 2.1 Raw Attendance Events (Immutable Ingestion)
CREATE TABLE IF NOT EXISTS public.raw_attendance_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    event_timestamp TIMESTAMPTZ NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('PUNCH_IN', 'PUNCH_OUT', 'BREAK_START', 'BREAK_END', 'MANUAL_CORRECTION', 'AUTO_JOB')),
    source TEXT NOT NULL DEFAULT 'DEVICE', -- e.g., DEVICE/WEB_UI/MOBILE/SYSTEM
    idempotency_key TEXT UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_events_staff_time ON public.raw_attendance_events(staff_id, event_timestamp);

-- 2.2 Attendance Summaries (Daily Persistence) - FINAL SHAPE (includes incidents/corrections/payroll metrics)
CREATE TABLE IF NOT EXISTS public.attendance_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,

    -- Computed Metrics
    primary_status TEXT NOT NULL DEFAULT 'ABSENT',
    worked_minutes_gross INTEGER DEFAULT 0,
    worked_minutes_net INTEGER DEFAULT 0,
    late_minutes INTEGER DEFAULT 0,
    early_out_minutes INTEGER DEFAULT 0,
    overtime_minutes INTEGER DEFAULT 0,

    -- Context Snapshot (Determinism)
    shift_id UUID REFERENCES public.shift_groups(id),
    policy_id UUID REFERENCES public.leave_policies(id),
    assignment_id UUID REFERENCES public.shift_assignments(id),

    -- Audit & Integrity
    anomaly_flags TEXT[] DEFAULT '{}',
    compute_metadata JSONB DEFAULT '{}'::jsonb,
    is_locked BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES public.user_profiles(id),

    -- Incident Impact Tracking
    applied_incident_id UUID REFERENCES public.attendance_incidents(id) ON DELETE SET NULL,
    excused_late_minutes INTEGER DEFAULT 0,
    excused_early_out_minutes INTEGER DEFAULT 0,
    impact_metadata JSONB DEFAULT '{}'::jsonb,

    -- Correction Tracking
    applied_correction_id UUID REFERENCES public.attendance_corrections(id) ON DELETE SET NULL,
    has_pending_correction BOOLEAN DEFAULT FALSE,
    correction_metadata JSONB DEFAULT '{}'::jsonb,

    -- Payroll Metrics (Phase 1)
    payable_fraction NUMERIC(3,2) DEFAULT 0,         -- 1.00, 0.50, 0.00
    penalty_amount  NUMERIC(12,2) DEFAULT 0,
    overtime_approved_minutes INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (staff_id, attendance_date)
);

-- NOTE: attendance_summaries references incidents/corrections, so we create the tables below
-- and then add FK columns safely if this table already existed earlier without them.
-- If your DB already has attendance_summaries, the CREATE TABLE won't run; so we still ensure columns exist via ALTERs later.

CREATE INDEX IF NOT EXISTS idx_summaries_date ON public.attendance_summaries(attendance_date);

-- ================================================================
-- 3) INCIDENTS (REQUEST-BASED MODIFIERS)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.attendance_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    incident_type attendance_incident_type NOT NULL,
    status incident_state NOT NULL DEFAULT 'PENDING',

    -- Request Data
    staff_reason TEXT,
    staff_attachment_url TEXT,

    -- Impact Data
    impact_data JSONB DEFAULT '{}'::jsonb,

    -- Approval Data
    resolved_by UUID REFERENCES public.user_profiles(id),
    resolved_at TIMESTAMPTZ,
    resolution_reason TEXT,

    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (staff_id, attendance_date, incident_type)
);

CREATE INDEX IF NOT EXISTS idx_incidents_staff_date ON public.attendance_incidents(staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.attendance_incidents(status);

-- ================================================================
-- 4) CORRECTIONS (DISPUTE / MANUAL ADJUSTMENT WORKFLOW)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.attendance_corrections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    type attendance_correction_type NOT NULL,
    status attendance_correction_state NOT NULL DEFAULT 'DRAFT',

    -- Request Evidence
    reason TEXT NOT NULL,
    evidence_metadata JSONB DEFAULT '{}'::jsonb,

    -- Proposed Overrides
    proposed_impact JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Review Hierarchy
    manager_id UUID REFERENCES public.user_profiles(id),
    manager_reason TEXT,
    manager_resolved_at TIMESTAMPTZ,

    hr_id UUID REFERENCES public.user_profiles(id),
    hr_reason TEXT,
    hr_resolved_at TIMESTAMPTZ,

    -- Audit
    applied_at TIMESTAMPTZ,
    applied_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (staff_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS idx_corrections_staff_date ON public.attendance_corrections(staff_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_corrections_status ON public.attendance_corrections(status);

-- ================================================================
-- 5) BACKFILL / HARDEN attendance_summaries COLUMNS (idempotent)
-- ================================================================
ALTER TABLE public.attendance_summaries
    ADD COLUMN IF NOT EXISTS applied_incident_id UUID REFERENCES public.attendance_incidents(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS excused_late_minutes INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS excused_early_out_minutes INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS impact_metadata JSONB DEFAULT '{}'::jsonb,

    ADD COLUMN IF NOT EXISTS applied_correction_id UUID REFERENCES public.attendance_corrections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS has_pending_correction BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS correction_metadata JSONB DEFAULT '{}'::jsonb,

    ADD COLUMN IF NOT EXISTS payable_fraction NUMERIC(3,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS overtime_approved_minutes INTEGER DEFAULT 0;

-- ================================================================
-- 6) PIPELINE FUNCTIONS (NORMALIZE -> SESSIONS -> RESOLVE -> COMPUTE)
-- ================================================================

-- 6.1 Stage 1-2: Normalized Events Resolver
CREATE OR REPLACE FUNCTION public.get_normalized_events(
    p_staff_id UUID,
    p_date DATE,
    p_boundary_start TIME DEFAULT '06:00:00'
)
RETURNS TABLE (
    event_id UUID,
    event_timestamp TIMESTAMPTZ,
    event_type TEXT,
    event_rank BIGINT
) AS $$
DECLARE
    v_window_start TIMESTAMPTZ;
    v_window_end TIMESTAMPTZ;
    v_timezone TEXT;
BEGIN
    SELECT timezone INTO v_timezone FROM public.system_configurations LIMIT 1;
    v_timezone := COALESCE(v_timezone, 'UTC');

    v_window_start := (p_date + p_boundary_start)::TIMESTAMP AT TIME ZONE v_timezone;
    v_window_end := v_window_start + INTERVAL '24 hours';

    RETURN QUERY
    WITH raw_ordered AS (
        SELECT
            id,
            event_timestamp,
            event_type,
            ROW_NUMBER() OVER (PARTITION BY event_timestamp, event_type ORDER BY created_at ASC) AS tie_breaker
        FROM public.raw_attendance_events
        WHERE staff_id = p_staff_id
          AND event_timestamp >= v_window_start
          AND event_timestamp < v_window_end
    )
    SELECT
        id AS event_id,
        raw_ordered.event_timestamp,
        raw_ordered.event_type,
        ROW_NUMBER() OVER (ORDER BY raw_ordered.event_timestamp ASC, raw_ordered.event_type ASC) AS event_rank
    FROM raw_ordered
    WHERE tie_breaker = 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 6.2 Stage 3-4: Session Pairing Engine
CREATE OR REPLACE FUNCTION public.get_attendance_sessions(
    p_staff_id UUID,
    p_date DATE,
    p_boundary_start TIME DEFAULT '06:00:00'
)
RETURNS TABLE (
    session_index INTEGER,
    in_timestamp TIMESTAMPTZ,
    out_timestamp TIMESTAMPTZ,
    duration_minutes INTEGER,
    is_anomaly BOOLEAN,
    anomaly_reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH normalized AS (
        SELECT * FROM public.get_normalized_events(p_staff_id, p_date, p_boundary_start)
    ),
    paired AS (
        SELECT
            e.event_timestamp AS tin,
            e.event_type AS type_in,
            -- Look for the next event of ANY type
            LEAD(e.event_timestamp) OVER (ORDER BY e.event_timestamp) AS tnext,
            LEAD(e.event_type) OVER (ORDER BY e.event_timestamp) AS typenext
        FROM normalized e
        -- We only pair starting from PUNCH_IN or unexpected starters
        WHERE e.event_type IN ('PUNCH_IN', 'PUNCH_OUT', 'BREAK_START', 'BREAK_END')
    ),
    sessions AS (
        SELECT
            tin AS session_in,
            tnext AS session_out,
            CASE
                WHEN type_in = 'PUNCH_IN' AND typenext = 'PUNCH_OUT' THEN FALSE
                WHEN type_in = 'PUNCH_IN' AND typenext IS NULL THEN TRUE -- Missing out
                WHEN type_in = 'PUNCH_IN' AND typenext IN ('BREAK_START', 'BREAK_END') THEN FALSE -- Internal events are OK now
                ELSE TRUE
            END AS is_anomaly,
            CASE
                WHEN type_in = 'PUNCH_IN' AND typenext IS NULL THEN 'MISSING_OUT'
                WHEN type_in = 'PUNCH_IN' AND typenext IN ('PUNCH_IN') THEN 'DOUBLE_IN'
                WHEN type_in = 'PUNCH_OUT' AND (typenext IS NULL OR typenext = 'PUNCH_IN') THEN NULL -- Valid end
                ELSE NULL
            END AS reason
        FROM paired
        WHERE type_in = 'PUNCH_IN'
    ),
    -- Grouping logic to skip internal breaks and find final out
    final_sessions AS (
        SELECT
            s.session_in,
            -- For a PUNCH_IN, find its corresponding PUNCH_OUT by skipping breaks
            COALESCE(
                (SELECT n.event_timestamp FROM normalized n 
                 WHERE n.event_timestamp > s.session_in AND n.event_type = 'PUNCH_OUT' 
                 ORDER BY n.event_timestamp ASC LIMIT 1),
                s.session_out -- Fallback to next event if no PUNCH_OUT found
            ) AS session_out,
            EXISTS (
                SELECT 1 FROM paired p 
                WHERE p.tin > s.session_in 
                  AND p.tin < COALESCE((SELECT n.event_timestamp FROM normalized n WHERE n.event_timestamp > s.session_in AND n.event_type = 'PUNCH_OUT' ORDER BY n.event_timestamp ASC LIMIT 1), '9999-12-31'::timestamptz)
                  AND p.type_in = 'PUNCH_IN'
            ) AS has_intervening_in
        FROM sessions s
    )
    SELECT
        ROW_NUMBER() OVER (ORDER BY f.session_in ASC)::INTEGER,
        f.session_in,
        f.session_out,
        COALESCE(EXTRACT(EPOCH FROM (f.session_out - f.session_in)) / 60, 0)::INTEGER,
        f.has_intervening_in OR (f.session_out IS NULL) AS is_anomaly,
        CASE 
            WHEN f.session_out IS NULL THEN 'MISSING_OUT'
            WHEN f.has_intervening_in THEN 'DOUBLE_IN_OR_MISMATCH'
            ELSE NULL
        END AS anomaly_reason
    FROM final_sessions f;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 7) INCIDENT RPCs
-- ================================================================
CREATE OR REPLACE FUNCTION public.request_attendance_incident(
    p_staff_id UUID,
    p_date DATE,
    p_type attendance_incident_type,
    p_reason TEXT,
    p_impact_request JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    v_incident_id UUID;
    v_is_admin BOOLEAN;
    v_is_self BOOLEAN;
BEGIN
    v_is_admin := public.has_permission('hr_attendance', 'manage_attendance');
    SELECT (user_id = auth.uid()) INTO v_is_self FROM public.staff_master WHERE id = p_staff_id;

    IF NOT (v_is_admin OR v_is_self) THEN
        RAISE EXCEPTION 'Unauthorized: You can only request incidents for yourself.';
    END IF;

    INSERT INTO public.attendance_incidents (
        staff_id,
        attendance_date,
        incident_type,
        staff_reason,
        impact_data,
        status
    )
    VALUES (
        p_staff_id,
        p_date,
        p_type,
        p_reason,
        p_impact_request,
        'PENDING'
    )
    ON CONFLICT (staff_id, attendance_date, incident_type) DO UPDATE
    SET
        staff_reason = EXCLUDED.staff_reason,
        impact_data = EXCLUDED.impact_data,
        status = 'PENDING',
        updated_at = NOW()
    RETURNING id INTO v_incident_id;

    RETURN v_incident_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.resolve_attendance_incident(
    p_incident_id UUID,
    p_status incident_state,
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_incident RECORD;
BEGIN
    IF NOT public.has_permission('hr_attendance', 'manage_attendance') THEN
        RAISE EXCEPTION 'Unauthorized: Permission hr_attendance:manage_attendance required.';
    END IF;

    IF p_status NOT IN ('APPROVED', 'REJECTED') THEN
        RAISE EXCEPTION 'Invalid resolution status. Use APPROVED or REJECTED.';
    END IF;

    UPDATE public.attendance_incidents
    SET
        status = p_status,
        resolved_by = auth.uid(),
        resolved_at = NOW(),
        resolution_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_incident_id
    RETURNING * INTO v_incident;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Incident not found.';
    END IF;

    IF p_status = 'APPROVED' THEN
        PERFORM public.compute_attendance_day_v1(v_incident.staff_id, v_incident.attendance_date, TRUE);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- 8) CORRECTION RPCs
-- ================================================================
CREATE OR REPLACE FUNCTION public.request_attendance_correction(
    p_staff_id UUID,
    p_date DATE,
    p_type attendance_correction_type,
    p_reason TEXT,
    p_proposed_impact JSONB,
    p_evidence_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
    v_correction_id UUID;
    v_is_admin BOOLEAN;
    v_is_self BOOLEAN;
BEGIN
    v_is_admin := public.has_permission('hr_attendance', 'manage_attendance');
    SELECT (user_id = auth.uid()) INTO v_is_self FROM public.staff_master WHERE id = p_staff_id;

    IF NOT (v_is_admin OR v_is_self) THEN
        RAISE EXCEPTION 'Unauthorized: You can only request corrections for yourself.';
    END IF;

    INSERT INTO public.attendance_corrections (
        staff_id,
        attendance_date,
        type,
        reason,
        proposed_impact,
        evidence_metadata,
        status
    )
    VALUES (
        p_staff_id,
        p_date,
        p_type,
        p_reason,
        p_proposed_impact,
        p_evidence_metadata,
        'SUBMITTED'
    )
    ON CONFLICT (staff_id, attendance_date) DO UPDATE
    SET
        reason = EXCLUDED.reason,
        proposed_impact = EXCLUDED.proposed_impact,
        evidence_metadata = EXCLUDED.evidence_metadata,
        status = 'SUBMITTED',
        updated_at = NOW()
    RETURNING id INTO v_correction_id;

    UPDATE public.attendance_summaries
    SET has_pending_correction = TRUE
    WHERE staff_id = p_staff_id AND attendance_date = p_date;

    RETURN v_correction_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.resolve_attendance_correction(
    p_correction_id UUID,
    p_action TEXT, -- MANAGER_APPROVE / MANAGER_REJECT / HR_APPROVE / HR_REJECT
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_corr RECORD;
    v_new_status attendance_correction_state;
    v_is_hr BOOLEAN;
    v_is_manager BOOLEAN;
BEGIN
    SELECT * INTO v_corr FROM public.attendance_corrections WHERE id = p_correction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction not found.';
    END IF;

    v_is_hr := public.has_permission('hr_attendance', 'manage_attendance');
    
    IF NOT v_is_hr THEN
        SELECT EXISTS (
            SELECT 1 FROM public.staff_master 
            WHERE id = v_corr.staff_id AND manager_id = auth.uid()
        ) INTO v_is_manager;

        IF NOT v_is_manager THEN
            RAISE EXCEPTION 'Unauthorized: Manager or HR permissions required for resolution.';
        END IF;
    END IF;

    CASE p_action
        WHEN 'MANAGER_APPROVE' THEN
            v_new_status := 'MANAGER_REVIEW';
            UPDATE public.attendance_corrections
            SET status = v_new_status, manager_id = auth.uid(), manager_reason = p_reason, manager_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'MANAGER_REJECT' THEN
            v_new_status := 'REJECTED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, manager_id = auth.uid(), manager_reason = p_reason, manager_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'HR_APPROVE' THEN
            IF NOT v_is_hr THEN RAISE EXCEPTION 'Unauthorized: HR permissions required.'; END IF;
            v_new_status := 'APPROVED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, hr_id = auth.uid(), hr_reason = p_reason, hr_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'HR_REJECT' THEN
            IF NOT v_is_hr THEN RAISE EXCEPTION 'Unauthorized: HR permissions required.'; END IF;
            v_new_status := 'REJECTED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, hr_id = auth.uid(), hr_reason = p_reason, hr_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        ELSE
            RAISE EXCEPTION 'Invalid action: %', p_action;
    END CASE;

    IF v_new_status = 'APPROVED' THEN
        PERFORM public.compute_attendance_day_v1(v_corr.staff_id, v_corr.attendance_date, TRUE);
    END IF;

    IF v_new_status = 'REJECTED' THEN
        UPDATE public.attendance_summaries
        SET has_pending_correction = FALSE
        WHERE staff_id = v_corr.staff_id AND attendance_date = v_corr.attendance_date;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.request_attendance_incident(UUID, DATE, attendance_incident_type, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_attendance_incident(UUID, DATE, attendance_incident_type, TEXT, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_attendance_incident(UUID, incident_state, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_attendance_incident(UUID, incident_state, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.request_attendance_correction(UUID, DATE, attendance_correction_type, TEXT, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_attendance_correction(UUID, DATE, attendance_correction_type, TEXT, JSONB, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_attendance_correction(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_attendance_correction(UUID, TEXT, TEXT) TO authenticated;

-- ================================================================
-- 9) REPORTING VIEWS (QUALITY GATES)
-- ================================================================
CREATE OR REPLACE VIEW public.view_attendance_anomalies_v1 AS
SELECT
    asum.id,
    asum.attendance_date,
    asum.staff_id,
    sm.full_name,
    sm.staff_code,
    asum.primary_status,
    asum.anomaly_flags,
    asum.worked_minutes_net,
    asum.compute_metadata->>'version' AS pipeline_version,
    asum.updated_at AS last_computed
FROM public.attendance_summaries asum
JOIN public.staff_master sm ON sm.id = asum.staff_id
WHERE cardinality(asum.anomaly_flags) > 0;

CREATE OR REPLACE VIEW public.view_pipeline_health_v1 AS
SELECT
    pipeline_version,
    COUNT(*) AS total_records,
    SUM(CASE WHEN is_locked THEN 1 ELSE 0 END) AS locked_records,
    SUM(CASE WHEN cardinality(anomaly_flags) > 0 THEN 1 ELSE 0 END) AS anomaly_count,
    ROUND(AVG(worked_minutes_net), 2) AS avg_work_minutes
FROM (
    SELECT
        compute_metadata->>'version' AS pipeline_version,
        is_locked,
        anomaly_flags,
        worked_minutes_net
    FROM public.attendance_summaries
) sub
GROUP BY pipeline_version;

GRANT SELECT ON public.view_attendance_anomalies_v1 TO authenticated;
GRANT SELECT ON public.view_pipeline_health_v1 TO authenticated;

-- ================================================================
-- 10) PAYROLL COMPATIBILITY (MONTHLY SNAPSHOTS + EXPORT BATCHES)
-- ================================================================
-- Redundant Block Removed













-- =========================================================
-- ATTENDANCE MANAGEMENT + INCIDENTS + REPORTING (CONSOLIDATED)
-- Goal: single re-runnable script, no duplicates, minimal errors
-- Assumes these already exist:
--   public.staff_master, public.user_profiles, public.leave_days
--   public.has_permission(module, action)
-- =========================================================
-- Removed nested BEGIN; (Transaction already opened at line 4920)

-- -----------------------------
-- 0) EXTENSIONS
-- -----------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------
-- 1) CORE TABLES
-- -----------------------------

-- 1.1 Shift Groups
CREATE TABLE IF NOT EXISTS public.shift_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration_minutes INTEGER DEFAULT 60,
    grace_in_minutes INTEGER DEFAULT 10,
    grace_out_minutes INTEGER DEFAULT 10,
    min_hours_present DECIMAL(4,2) DEFAULT 8.0,
    min_hours_half_day DECIMAL(4,2) DEFAULT 4.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- used by reports/history
    weekly_off INTEGER[] DEFAULT '{0}',               -- 0=Sunday ... 6=Saturday
    penalty_per_minute NUMERIC(10,2) DEFAULT 0,
    max_monthly_penalty_pct NUMERIC(5,2) DEFAULT 10.0
);

-- 1.2 Staff shift assignment
ALTER TABLE public.staff_master
ADD COLUMN IF NOT EXISTS shift_group_id UUID REFERENCES public.shift_groups(id);

-- 1.3 Attendance Records (single source of truth)
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.staff_master(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,

    punch_in TIME,
    break_start TIME,
    break_end TIME,
    punch_out TIME,

    -- Derived/Calculated status (PRESENT, ABSENT, LEAVE, MISS_PUNCH, etc.)
    status TEXT NOT NULL DEFAULT 'ABSENT',

    -- Tracking & Audit
    is_verified BOOLEAN DEFAULT FALSE,
    verified_by UUID REFERENCES public.user_profiles(id),
    notes TEXT,

    -- Incident linking & effects
    incident_id UUID,
    excused_late_minutes INTEGER DEFAULT 0,

    -- Mandatory reason for manual overrides (kept nullable at DB level)
    correction_reason TEXT,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    UNIQUE (staff_id, attendance_date)
);

-- 1.5 Holidays
CREATE TABLE IF NOT EXISTS public.holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    holiday_date DATE NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1.4 Delay Incidents
CREATE TABLE IF NOT EXISTS public.delay_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_date DATE NOT NULL,
    shift_group_id UUID REFERENCES public.shift_groups(id),
    reason TEXT NOT NULL,
    responsible_staff_ids UUID[] NOT NULL DEFAULT '{}',
    excuse_minutes INTEGER NOT NULL,

    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    approved_by UUID REFERENCES public.user_profiles(id),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1.5 Holidays
CREATE TABLE IF NOT EXISTS public.attendance_corrections_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    attendance_record_id UUID NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    edited_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 1.7 Salary deductions (for incident penalty reallocations)
CREATE TABLE IF NOT EXISTS public.attendance_salary_deductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID NOT NULL REFERENCES public.staff_master(id) ON DELETE CASCADE,
    incident_id UUID REFERENCES public.delay_incidents(id) ON DELETE SET NULL,
    amount NUMERIC(15,2) NOT NULL,
    deduction_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'POSTED', 'CANCELLED')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    applied_at TIMESTAMPTZ
);

-- -----------------------------
-- 2) INDEXES
-- -----------------------------
CREATE INDEX IF NOT EXISTS idx_attendance_date ON public.attendance_records(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_staff ON public.attendance_records(staff_id);
CREATE INDEX IF NOT EXISTS idx_delay_incidents_date ON public.delay_incidents(incident_date);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(holiday_date);

-- Ensure punch/break time columns are TIMESTAMPTZ (upgraded from TIME in earlier migrations).
-- If already TIMESTAMPTZ this block does nothing.
DO $$
DECLARE
    col_type TEXT;
BEGIN
    -- punch_in
    SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'punch_in';
    IF col_type = 'time without time zone' THEN
        ALTER TABLE public.attendance_records
            ALTER COLUMN punch_in TYPE TIMESTAMPTZ USING (attendance_date + punch_in::time)::TIMESTAMPTZ;
    END IF;

    -- punch_out
    SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'punch_out';
    IF col_type = 'time without time zone' THEN
        ALTER TABLE public.attendance_records
            ALTER COLUMN punch_out TYPE TIMESTAMPTZ USING (attendance_date + punch_out::time)::TIMESTAMPTZ;
    END IF;

    -- break_start
    SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'break_start';
    IF col_type = 'time without time zone' THEN
        ALTER TABLE public.attendance_records
            ALTER COLUMN break_start TYPE TIMESTAMPTZ USING (attendance_date + break_start::time)::TIMESTAMPTZ;
    END IF;

    -- break_end
    SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'break_end';
    IF col_type = 'time without time zone' THEN
        ALTER TABLE public.attendance_records
            ALTER COLUMN break_end TYPE TIMESTAMPTZ USING (attendance_date + break_end::time)::TIMESTAMPTZ;
    END IF;

    -- lunch_in (optional column, may not exist)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'lunch_in') THEN
        SELECT data_type INTO col_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'lunch_in';
        IF col_type = 'time without time zone' THEN
            ALTER TABLE public.attendance_records
                ALTER COLUMN lunch_in TYPE TIMESTAMPTZ USING (attendance_date + lunch_in::time)::TIMESTAMPTZ;
        END IF;
    ELSE
        ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS lunch_in TIMESTAMPTZ;
    END IF;

    -- lunch_out (optional column, may not exist)
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'lunch_out') THEN
        SELECT data_type INTO col_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'lunch_out';
        IF col_type = 'time without time zone' THEN
            ALTER TABLE public.attendance_records
                ALTER COLUMN lunch_out TYPE TIMESTAMPTZ USING (attendance_date + lunch_out::time)::TIMESTAMPTZ;
        END IF;
    ELSE
        ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS lunch_out TIMESTAMPTZ;
    END IF;
END $$;


-- -----------------------------
-- 3) RLS (Secure Policies)
-- -----------------------------
ALTER TABLE public.shift_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delay_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_corrections_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_salary_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin All Access" ON public.shift_groups;
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_records;
DROP POLICY IF EXISTS "Admin All Access" ON public.delay_incidents;
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_incidents;
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_corrections;
DROP POLICY IF EXISTS "Admin All Access" ON public.holidays;
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_corrections_log;
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_salary_deductions;
DROP POLICY IF EXISTS "Employee Select" ON public.shift_groups;
DROP POLICY IF EXISTS "Employee Select" ON public.holidays;
DROP POLICY IF EXISTS "Employee Select" ON public.attendance_records;

DROP POLICY IF EXISTS "Admin All Access" ON public.shift_groups;
CREATE POLICY "Admin All Access" ON public.shift_groups                 FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_settings') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_records;
CREATE POLICY "Admin All Access" ON public.attendance_records           FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.delay_incidents;
CREATE POLICY "Admin All Access" ON public.delay_incidents              FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_incidents;
CREATE POLICY "Admin All Access" ON public.attendance_incidents         FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_corrections;
CREATE POLICY "Admin All Access" ON public.attendance_corrections       FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.holidays;
CREATE POLICY "Admin All Access" ON public.holidays                     FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_settings') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_corrections_log;
CREATE POLICY "Admin All Access" ON public.attendance_corrections_log   FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "Admin All Access" ON public.attendance_salary_deductions;
CREATE POLICY "Admin All Access" ON public.attendance_salary_deductions FOR ALL TO authenticated USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());

-- Employee Allowances (Read-only for self and open data)
DROP POLICY IF EXISTS "Employee Select" ON public.shift_groups;
CREATE POLICY "Employee Select" ON public.shift_groups FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Employee Select" ON public.holidays;
CREATE POLICY "Employee Select" ON public.holidays FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Employee Select" ON public.attendance_records;
CREATE POLICY "Employee Select" ON public.attendance_records FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id));


-- Legacy Delay Incidents
DROP POLICY IF EXISTS "attendance_incidents: SELECT" ON public.delay_incidents;
CREATE POLICY "attendance_incidents: SELECT" ON public.delay_incidents
FOR SELECT TO authenticated
USING (auth.uid() = ANY(responsible_staff_ids) OR public.has_permission('hr_attendance', 'view') OR public.get_is_super_admin());


-- 3.1 Granular: Attendance Incidents
DROP POLICY IF EXISTS "attendance_incidents: SELECT" ON public.attendance_incidents;
CREATE POLICY "attendance_incidents: SELECT" ON public.attendance_incidents
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'view') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "attendance_incidents: INSERT" ON public.attendance_incidents;
CREATE POLICY "attendance_incidents: INSERT" ON public.attendance_incidents
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "attendance_incidents: UPDATE (HR)" ON public.attendance_incidents;
CREATE POLICY "attendance_incidents: UPDATE (HR)" ON public.attendance_incidents
FOR UPDATE TO authenticated
USING (public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());


-- 3.2 Granular: Attendance Corrections
DROP POLICY IF EXISTS "attendance_corrections: SELECT" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections: SELECT" ON public.attendance_corrections
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'view') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "attendance_corrections: INSERT" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections: INSERT" ON public.attendance_corrections
FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());

DROP POLICY IF EXISTS "attendance_corrections: UPDATE" ON public.attendance_corrections;
CREATE POLICY "attendance_corrections: UPDATE" ON public.attendance_corrections
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'manage_attendance') OR public.get_is_super_admin());
DROP POLICY IF EXISTS "attendance_summaries: SELECT" ON public.attendance_summaries;
CREATE POLICY "attendance_summaries: SELECT" ON public.attendance_summaries
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_profiles UP WHERE UP.id = auth.uid() AND UP.staff_id = staff_id) OR public.has_permission('hr_attendance', 'view') OR public.get_is_super_admin());

-- -----------------------------
-- 4) DROP/RECREATE VIEW + RPCs (single source of truth)
-- -----------------------------
DROP VIEW IF EXISTS public.attendance_audit_logs_view CASCADE;

DROP FUNCTION IF EXISTS public.get_attendance_history_v2(UUID, DATE, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.create_delay_incident_v1(DATE, TEXT, UUID[], INTEGER, UUID, TIME, TIME) CASCADE;
DROP FUNCTION IF EXISTS public.resolve_delay_incident_v1(UUID, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_daily_muster_summary_v1(DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_daily_muster_summary_v1(DATE, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_late_report_v1(DATE, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_late_report_v1(DATE, DATE, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.verify_day_v1(DATE, UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.verify_day_v1(DATE, UUID, UUID, UUID) CASCADE;

-- Duplicate intermediate reporting RPCs removed.

COMMIT;


-- ================================================================
-- HR / ATTENDANCE CONSOLIDATED PATCH (DEDUPED + ERROR-SAFE)
-- Includes:
--  1) Extensions
--  2) shift_groups table + RLS + policies + audit trigger
--  3) attendance_records: add lunch_out/lunch_in (idempotent)
--  4) leave_requests: add start_day_type/end_day_type + constraints
--  5) RPCs: get_attendance_history_v2, create_delay_incident_v1,
--           resolve_delay_incident_v1, get_daily_muster_summary_v1,
--           get_late_report_v1, verify_day_v1
--  6) View: attendance_audit_logs_view
-- Notes:
--  - Assumes these already exist: staff_master, attendance_records,
--    leave_days, leave_requests, holidays, delay_incidents,
--    attendance_salary_deductions, attendance_corrections_log,
--    public.has_permission(), public.log_table_changes()
-- ================================================================

BEGIN;

-- -----------------------------
-- 0) EXTENSIONS
-- -----------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------
-- 1) SHIFT GROUPS (table + RLS + policies + audit)
-- -----------------------------
CREATE TABLE IF NOT EXISTS public.shift_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration_minutes INTEGER DEFAULT 60,
    grace_in_minutes INTEGER DEFAULT 15,
    grace_out_minutes INTEGER DEFAULT 15,
    min_hours_present DECIMAL(4,2) DEFAULT 8.0,
    min_hours_half_day DECIMAL(4,2) DEFAULT 4.0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.shift_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.shift_groups;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.shift_groups;
DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.shift_groups;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.shift_groups;
CREATE POLICY "Enable read access for all users" ON public.shift_groups
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.shift_groups;
CREATE POLICY "Enable insert for authenticated users" ON public.shift_groups
    FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Enable update for authenticated users" ON public.shift_groups;
CREATE POLICY "Enable update for authenticated users" ON public.shift_groups
    FOR UPDATE USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS audit_shift_groups ON public.shift_groups;
CREATE TRIGGER audit_shift_groups
AFTER INSERT OR UPDATE OR DELETE ON public.shift_groups
FOR EACH ROW EXECUTE FUNCTION public.log_table_changes();

-- -----------------------------
-- 2) attendance_records: add lunch columns (idempotent)
-- -----------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_records'
          AND column_name = 'lunch_out'
    ) THEN
        ALTER TABLE public.attendance_records ADD COLUMN lunch_out TIME;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'attendance_records'
          AND column_name = 'lunch_in'
    ) THEN
        ALTER TABLE public.attendance_records ADD COLUMN lunch_in TIME;
    END IF;
END $$;

-- -----------------------------
-- 3) leave_requests: start/end day types + constraints (idempotent)
-- -----------------------------
ALTER TABLE public.leave_requests
    ADD COLUMN IF NOT EXISTS start_day_type VARCHAR(10) DEFAULT 'FULL',
    ADD COLUMN IF NOT EXISTS end_day_type   VARCHAR(10) DEFAULT 'FULL';

UPDATE public.leave_requests
SET start_day_type = COALESCE(start_day_type, 'FULL'),
    end_day_type   = COALESCE(end_day_type, 'FULL')
WHERE start_day_type IS NULL OR end_day_type IS NULL;

ALTER TABLE public.leave_requests
    DROP CONSTRAINT IF EXISTS check_start_day_type,
    DROP CONSTRAINT IF EXISTS check_end_day_type;

ALTER TABLE public.leave_requests
    ADD CONSTRAINT check_start_day_type CHECK (start_day_type IN ('FULL', 'HALF')),
    ADD CONSTRAINT check_end_day_type   CHECK (end_day_type   IN ('FULL', 'HALF'));

-- -----------------------------
-- 4) RPC: Attendance History (full series + absences)
-- -----------------------------
CREATE OR REPLACE FUNCTION public.get_attendance_history_v2(
    p_staff_id UUID,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    attendance_date DATE,
    id UUID,
    staff_id UUID,
    staff_name TEXT,
    shift_name TEXT,
    punch_in TIME,
    break_start TIME,
    break_end TIME,
    lunch_in TIME,
    lunch_out TIME,
    punch_out TIME,
    status TEXT,
    is_verified BOOLEAN,
    verified_by UUID,
    notes TEXT,
    excused_late_minutes INTEGER,
    incident_id UUID,
    incident_status TEXT,
    conflict_flag BOOLEAN,
    holiday_name TEXT,
    leave_request_id UUID
) AS $$
BEGIN
    RETURN QUERY
    WITH date_series AS (
        SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date AS d
    )
    SELECT
        ds.d AS attendance_date,
        ar.id,
        COALESCE(ar.staff_id, p_staff_id) AS staff_id,
        sm.full_name::text AS staff_name,
        sg.name::text AS shift_name,
        ar.punch_in::time,
        ar.break_start::time,
        ar.break_end::time,
        ar.lunch_in::time,
        ar.lunch_out::time,
        ar.punch_out::time,
        CASE
            WHEN h.id IS NOT NULL THEN 'HOLIDAY'
            WHEN asu.primary_status IS NOT NULL THEN asu.primary_status
            WHEN ar.status IS NOT NULL THEN ar.status
            WHEN ld.id IS NOT NULL THEN 'LEAVE'
            WHEN sg.weekly_off IS NOT NULL AND EXTRACT(DOW FROM ds.d) = ANY(sg.weekly_off) THEN 'WEEKLY_OFF'
            ELSE 'ABSENT'
        END AS status,
        COALESCE(ar.is_verified, false) AS is_verified,
        ar.verified_by,
        ar.notes,
        COALESCE(ar.excused_late_minutes, (ai.impact_data->>'excuse_minutes')::integer, di.excuse_minutes, 0) AS excused_late_minutes,
        COALESCE(ar.incident_id, asu.applied_incident_id) AS incident_id,
        COALESCE(di.status::text, ai.status::text) AS incident_status,
        (ld.id IS NOT NULL AND ar.punch_in IS NOT NULL) AS conflict_flag,
        h.name AS holiday_name,
        ld.request_id AS leave_request_id
    FROM date_series ds
    CROSS JOIN staff_master sm
    LEFT JOIN shift_groups sg ON sg.id = sm.shift_group_id
    LEFT JOIN attendance_records ar ON ar.attendance_date = ds.d AND ar.staff_id = sm.id
    LEFT JOIN attendance_summaries asu ON asu.attendance_date = ds.d AND asu.staff_id = sm.id
    LEFT JOIN leave_days ld ON ld.leave_date = ds.d AND ld.staff_id = sm.id
    LEFT JOIN delay_incidents di ON di.id = COALESCE(ar.incident_id, asu.applied_incident_id)
    LEFT JOIN attendance_incidents ai ON ai.id = COALESCE(ar.incident_id, asu.applied_incident_id)
    LEFT JOIN holidays h ON h.holiday_date = ds.d
    WHERE sm.id = p_staff_id
      AND ds.d >= COALESCE(sm.doj, DATE '1900-01-01')
      /* 
         Removed restrictive series filter to allow full date series including 
         plain absences and weekly offs 
      */
    ORDER BY ds.d DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.get_attendance_history_v2(UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attendance_history_v2(UUID, DATE, DATE) TO authenticated;

-- [Legacy Delay Incident Functions Removed for Unification and Replayability]
-- See Section 'PATCH: Attendance Workflows (Round 3)' for the final unified implementation.


-- -----------------------------
-- 7) REPORT: Daily Muster Summary
-- -----------------------------
DROP FUNCTION IF EXISTS public.get_daily_muster_summary_v1(DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_daily_muster_summary_v1(DATE, UUID) CASCADE;
CREATE OR REPLACE FUNCTION public.get_daily_muster_summary_v1(
    p_date DATE
)
RETURNS TABLE (
    total_staff BIGINT,
    present BIGINT,
    absent BIGINT,
    on_leave BIGINT,
    miss_punch BIGINT,
    late_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE ar.status IN ('PRESENT', 'LATE_PRESENT', 'EARLY_OUT')),
        COUNT(*) FILTER (WHERE ar.status = 'ABSENT'),
        COUNT(*) FILTER (WHERE ar.status = 'LEAVE'),
        COUNT(*) FILTER (WHERE ar.status = 'MISS_PUNCH'),
        COUNT(*) FILTER (
            WHERE ar.punch_in IS NOT NULL
              AND sg.start_time IS NOT NULL
              AND ar.punch_in::time > (sg.start_time::time + (sg.grace_in_minutes || ' minutes')::interval)
        )
    FROM staff_master sm
    LEFT JOIN attendance_records ar ON ar.staff_id = sm.id AND ar.attendance_date = p_date
    LEFT JOIN shift_groups sg ON sg.id = sm.shift_group_id
    WHERE sm.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------
-- 8) REPORT: Late Report
-- -----------------------------
DROP FUNCTION IF EXISTS public.get_late_report_v1(DATE, DATE, UUID);
CREATE OR REPLACE FUNCTION public.get_late_report_v1(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    staff_id UUID,
    full_name TEXT,
    staff_code TEXT,
    total_late_days BIGINT,
    total_late_minutes NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sm.id,
        sm.full_name::text,
        sm.staff_code::text,
        COUNT(*) AS total_late_days,
        COALESCE(SUM(EXTRACT(EPOCH FROM (ar.punch_in::time - sg.start_time::time)::interval) / 60), 0) AS total_late_minutes
    FROM staff_master sm
    JOIN attendance_records ar ON ar.staff_id = sm.id
    JOIN shift_groups sg ON sg.id = sm.shift_group_id
    WHERE ar.attendance_date BETWEEN p_start_date AND p_end_date
      AND ar.punch_in IS NOT NULL
      AND sg.start_time IS NOT NULL
      AND ar.punch_in::time > (sg.start_time::time + (sg.grace_in_minutes || ' minutes')::interval)
    GROUP BY sm.id, sm.full_name, sm.staff_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- [Legacy verify_day_v1 Removed for Unification and Replayability]

-- -----------------------------
-- 10) VIEW: Attendance Audit Logs
-- -----------------------------
CREATE OR REPLACE VIEW public.attendance_audit_logs_view AS
SELECT
    acl.*,
    u.email AS editor_email
FROM public.attendance_corrections_log acl
JOIN auth.users u ON acl.edited_by = u.id;

GRANT SELECT ON public.attendance_audit_logs_view TO authenticated;

COMMIT;

-- ================================================================
-- PHASE 3: REPORTING AND PAYROLL COMPATIBILITY
-- Includes: Monthly Snapshots, Delta Adjustments, Reconciliation View
-- ================================================================

BEGIN;

-- 1) Attendance Monthly Snapshots (Frozen Truth)
CREATE TABLE IF NOT EXISTS public.attendance_monthly_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.staff_master(id) ON DELETE CASCADE,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    
    total_days_in_month INTEGER NOT NULL,
    payable_days NUMERIC(5,2) DEFAULT 0,
    present_days NUMERIC(5,2) DEFAULT 0,
    half_days NUMERIC(5,2) DEFAULT 0,
    absent_days NUMERIC(5,2) DEFAULT 0,
    leave_days NUMERIC(5,2) DEFAULT 0,
    
    total_late_minutes INTEGER DEFAULT 0,
    total_early_out_minutes INTEGER DEFAULT 0,
    total_overtime_minutes INTEGER DEFAULT 0,
    total_penalty_amount NUMERIC(12,2) DEFAULT 0,
    
    is_locked BOOLEAN DEFAULT false,
    locked_at TIMESTAMPTZ,
    locked_by UUID REFERENCES public.user_profiles(id),
    
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(staff_id, year, month)
);

-- Patch existing table if it exists from previous turns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'present_days') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN present_days NUMERIC(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'absent_days') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN absent_days NUMERIC(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'half_days') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN half_days NUMERIC(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'leave_days') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN leave_days NUMERIC(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'payable_days') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN payable_days NUMERIC(5,2) DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'is_locked') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN is_locked BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'locked_at') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN locked_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'locked_by') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN locked_by UUID REFERENCES public.user_profiles(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'total_days_in_month') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN total_days_in_month INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'metadata') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_monthly_snapshots' AND column_name = 'updated_at') THEN
        ALTER TABLE public.attendance_monthly_snapshots ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- 2) Attendance Delta Adjustments (Post-Lock Governed Deltas)
CREATE TABLE IF NOT EXISTS public.attendance_delta_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    staff_id UUID REFERENCES public.staff_master(id) ON DELETE CASCADE,
    target_year INTEGER NOT NULL,
    target_month INTEGER NOT NULL,
    
    adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('PAYABLE_DAYS', 'OVERTIME_HOURS', 'PENALTY_AMOUNT', 'BONUS_ADJUSTMENT')),
    delta_value NUMERIC(12,2) NOT NULL,
    reason TEXT NOT NULL,
    
    applied_in_year INTEGER NOT NULL,
    applied_in_month INTEGER NOT NULL,
    
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 3) VIEW: Payroll Reconciliation (Live vs Snapshot)
CREATE OR REPLACE VIEW public.view_payroll_reconciliation AS
WITH live_agg AS (
    SELECT 
        staff_id,
        EXTRACT(YEAR FROM attendance_date)::int as year,
        EXTRACT(MONTH FROM attendance_date)::int as month,
        COUNT(*) FILTER (WHERE primary_status IN ('PRESENT', 'LATE_PRESENT', 'EARLY_OUT')) as live_present,
        COUNT(*) FILTER (WHERE primary_status = 'ABSENT') as live_absent,
        COUNT(*) FILTER (WHERE primary_status = 'HALF_DAY') as live_half_day,
        COUNT(*) FILTER (WHERE primary_status = 'LEAVE') as live_leave
    FROM public.attendance_summaries
    GROUP BY staff_id, EXTRACT(YEAR FROM attendance_date), EXTRACT(MONTH FROM attendance_date)
)
SELECT 
    s.staff_id,
    sm.full_name,
    sm.staff_code,
    s.year,
    s.month,
    s.present_days as snapshot_present,
    la.live_present as live_present,
    s.absent_days as snapshot_absent,
    la.live_absent as live_absent,
    s.is_locked,
    (s.present_days != la.live_present OR s.absent_days != la.live_absent) as has_drift
FROM public.attendance_monthly_snapshots s
JOIN public.staff_master sm ON s.staff_id = sm.id
LEFT JOIN live_agg la ON s.staff_id = la.staff_id AND s.year = la.year AND s.month = la.month;

-- 4) RPC: Compute Attendance Month Summary
DROP FUNCTION IF EXISTS public.compute_attendance_month_summary_v1(UUID, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.compute_attendance_month_summary_v1(
    p_staff_id UUID,
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_start_date DATE := (p_year || '-' || p_month || '-01')::DATE;
    v_end_date DATE := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'staff_id', p_staff_id,
        'year', p_year,
        'month', p_month,
        'total_days_in_month', EXTRACT(DAY FROM v_end_date),
        'present_days', COUNT(*) FILTER (WHERE primary_status IN ('PRESENT', 'LATE_PRESENT', 'EARLY_OUT')),
        'absent_days', COUNT(*) FILTER (WHERE primary_status = 'ABSENT'),
        'half_days', COUNT(*) FILTER (WHERE primary_status = 'HALF_DAY'),
        'leave_days', COUNT(*) FILTER (WHERE primary_status = 'LEAVE'),
        'total_late_minutes', COALESCE(SUM(late_minutes), 0),
        'total_overtime_minutes', COALESCE(SUM(overtime_minutes), 0)
    ) INTO v_result
    FROM public.attendance_summaries
    WHERE staff_id = p_staff_id 
      AND attendance_date BETWEEN v_start_date AND v_end_date;
      
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5) RPC: Generate Monthly Snapshot
-- Drop BOTH possible overloads to avoid ambiguity errors
DROP FUNCTION IF EXISTS public.generate_monthly_snapshot(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.generate_monthly_snapshot(INTEGER, INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.generate_monthly_snapshot(
    p_year INTEGER,
    p_month INTEGER,
    p_staff_id UUID
)
RETURNS TEXT AS $$
DECLARE
    v_summary JSONB;
BEGIN
    -- Check lock
    IF EXISTS (SELECT 1 FROM public.attendance_monthly_snapshots WHERE staff_id = p_staff_id AND year = p_year AND month = p_month AND is_locked = true) THEN
        RAISE EXCEPTION 'Payroll period is locked for this staff/month';
    END IF;

    v_summary := public.compute_attendance_month_summary_v1(p_staff_id, p_year, p_month);

    INSERT INTO public.attendance_monthly_snapshots (
        staff_id, year, month, total_days_in_month, present_days, absent_days, half_days, leave_days,
        total_late_minutes, total_overtime_minutes
    ) VALUES (
        p_staff_id, p_year, p_month,
        (v_summary->>'total_days_in_month')::integer,
        (v_summary->>'present_days')::numeric,
        (v_summary->>'absent_days')::numeric,
        (v_summary->>'half_days')::numeric,
        (v_summary->>'leave_days')::numeric,
        (v_summary->>'total_late_minutes')::int,
        (v_summary->>'total_overtime_minutes')::int
    )
    ON CONFLICT (staff_id, year, month) DO UPDATE SET
        total_days_in_month = EXCLUDED.total_days_in_month,
        present_days = EXCLUDED.present_days,
        absent_days = EXCLUDED.absent_days,
        half_days = EXCLUDED.half_days,
        leave_days = EXCLUDED.leave_days,
        total_late_minutes = EXCLUDED.total_late_minutes,
        total_overtime_minutes = EXCLUDED.total_overtime_minutes;

    RETURN 'SUCCESS';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6) RPC: Recompute Monthly Snapshots
DROP FUNCTION IF EXISTS public.recompute_monthly_snapshots(INTEGER, INTEGER, UUID[]);
CREATE OR REPLACE FUNCTION public.recompute_monthly_snapshots(
    p_year INTEGER,
    p_month INTEGER,
    p_staff_ids UUID[] DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_staff_id UUID;
    v_count INTEGER := 0;
BEGIN
    FOR v_staff_id IN 
        SELECT id FROM public.staff_master 
        WHERE is_active = true 
          AND (p_staff_ids IS NULL OR id = ANY(p_staff_ids))
    LOOP
        PERFORM public.generate_monthly_snapshot(p_year, p_month, v_staff_id);
        v_count := v_count + 1;
    END LOOP;
    
    RETURN jsonb_build_object('total_processed', v_count, 'success_count', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) RPC: Lock Payroll Period
DROP FUNCTION IF EXISTS public.lock_payroll_period(INTEGER, INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.lock_payroll_period(
    p_year INTEGER,
    p_month INTEGER,
    p_locked_by UUID
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.attendance_monthly_snapshots
    SET is_locked = true,
        locked_at = NOW(),
        locked_by = p_locked_by,
        updated_at = NOW()
    WHERE year = p_year AND month = p_month AND is_locked = false
      AND (p_staff_id IS NULL OR staff_id = p_staff_id);
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8) RPC: Record Payroll Adjustment
DROP FUNCTION IF EXISTS public.record_payroll_adjustment(UUID, INTEGER, INTEGER, TEXT, NUMERIC, TEXT, INTEGER, INTEGER, UUID);
CREATE OR REPLACE FUNCTION public.record_payroll_adjustment(
    p_staff_id UUID,
    p_target_year INTEGER,
    p_target_month INTEGER,
    p_adj_type TEXT,
    p_delta NUMERIC,
    p_reason TEXT,
    p_cur_year INTEGER,
    p_cur_month INTEGER,
    p_created_by UUID
)
RETURNS TEXT AS $$
BEGIN
    INSERT INTO public.attendance_delta_adjustments (
        staff_id, target_year, target_month, adjustment_type, delta_value, reason,
        applied_in_year, applied_in_month, created_by
    ) VALUES (
        p_staff_id, p_target_year, p_target_month, p_adj_type, p_delta, p_reason,
        p_cur_year, p_cur_month, p_created_by
    );
    
    RETURN 'SUCCESS';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS
ALTER TABLE public.attendance_monthly_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_delta_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin All Access Snapshots" ON public.attendance_monthly_snapshots;
DROP POLICY IF EXISTS "Admin All Access Deltas" ON public.attendance_delta_adjustments;

CREATE POLICY "Admin All Access Snapshots" ON public.attendance_monthly_snapshots FOR ALL TO authenticated USING (public.get_is_super_admin() OR public.has_permission('hr_payroll', 'manage_payroll')) WITH CHECK (public.get_is_super_admin() OR public.has_permission('hr_payroll', 'manage_payroll'));
CREATE POLICY "Admin All Access Deltas" ON public.attendance_delta_adjustments FOR ALL TO authenticated USING (public.get_is_super_admin() OR public.has_permission('hr_payroll', 'manage_payroll')) WITH CHECK (public.get_is_super_admin() OR public.has_permission('hr_payroll', 'manage_payroll'));

-- 9) TRIGGER: Enforce Payroll Lock
CREATE OR REPLACE FUNCTION public.check_payroll_lock_v1()
RETURNS TRIGGER AS $$
DECLARE
    v_date DATE;
    v_year INTEGER;
    v_month INTEGER;
    v_staff_id UUID;
    v_locked BOOLEAN := false;
BEGIN
    -- 1) Skip for Super Admins
    IF public.get_is_super_admin() THEN
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END IF;

    -- 2) Resolve date and staff_id
    IF TG_TABLE_NAME = 'attendance_records' THEN
        v_date := COALESCE(NEW.attendance_date, OLD.attendance_date);
        v_staff_id := COALESCE(NEW.staff_id, OLD.staff_id);
    ELSIF TG_TABLE_NAME = 'attendance_summaries' THEN
        v_date := COALESCE(NEW.attendance_date, OLD.attendance_date);
        v_staff_id := COALESCE(NEW.staff_id, OLD.staff_id);
    ELSIF TG_TABLE_NAME = 'raw_attendance_events' THEN
        v_date := COALESCE(NEW.event_timestamp, OLD.event_timestamp)::date;
        v_staff_id := COALESCE(NEW.staff_id, OLD.staff_id);
    ELSIF TG_TABLE_NAME = 'attendance_incidents' THEN
        v_date := COALESCE(NEW.attendance_date, OLD.attendance_date);
        v_staff_id := COALESCE(NEW.staff_id, OLD.staff_id);
    ELSIF TG_TABLE_NAME = 'attendance_corrections' THEN
        v_date := COALESCE(NEW.attendance_date, OLD.attendance_date);
        v_staff_id := COALESCE(NEW.staff_id, OLD.staff_id);
    ELSIF TG_TABLE_NAME = 'delay_incidents' THEN
        v_date := COALESCE(NEW.incident_date, OLD.incident_date);
    END IF;

    v_year := EXTRACT(YEAR FROM v_date)::int;
    v_month := EXTRACT(MONTH FROM v_date)::int;

    -- 3) Check if period is locked for this specific staff
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_monthly_snapshots
        WHERE year = v_year AND month = v_month AND is_locked = true
          AND (v_staff_id IS NULL OR staff_id = v_staff_id)
    ) INTO v_locked;

    IF v_locked = true THEN
        RAISE EXCEPTION 'Payroll period %/% is locked for staff %. Operational data is immutable.', v_month, v_year, v_staff_id;
    END IF;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply triggers
DROP TRIGGER IF EXISTS trg_lock_attendance_records ON public.attendance_records;
CREATE TRIGGER trg_lock_attendance_records
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_records
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

DROP TRIGGER IF EXISTS trg_lock_delay_incidents ON public.delay_incidents;
CREATE TRIGGER trg_lock_delay_incidents
BEFORE INSERT OR UPDATE OR DELETE ON public.delay_incidents
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

DROP TRIGGER IF EXISTS trg_lock_attendance_incidents ON public.attendance_incidents;
CREATE TRIGGER trg_lock_attendance_incidents
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_incidents
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

DROP TRIGGER IF EXISTS trg_lock_attendance_summaries ON public.attendance_summaries;
CREATE TRIGGER trg_lock_attendance_summaries
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_summaries
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

DROP TRIGGER IF EXISTS trg_lock_attendance_corrections ON public.attendance_corrections;
CREATE TRIGGER trg_lock_attendance_corrections
BEFORE INSERT OR UPDATE OR DELETE ON public.attendance_corrections
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

DROP TRIGGER IF EXISTS trg_lock_raw_events ON public.raw_attendance_events;
CREATE TRIGGER trg_lock_raw_events
BEFORE INSERT OR UPDATE OR DELETE ON public.raw_attendance_events
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_lock_v1();

-- Patch for Device Department Assignment
ALTER TABLE IF EXISTS public.staff_master 
  ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.device_departments(id) ON DELETE SET NULL;

-- ================================================================
-- SESSION STAFF: Links staff members on duty to a posted session
-- ================================================================
CREATE TABLE IF NOT EXISTS public.session_staff (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.transaction_sessions(id) ON DELETE CASCADE NOT NULL,
    staff_id UUID REFERENCES public.staff_master(id) ON DELETE CASCADE NOT NULL,
    is_responsible BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, staff_id)
);

ALTER TABLE public.session_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "RLS: session_staff" ON public.session_staff;
CREATE POLICY "RLS: session_staff" ON public.session_staff
    FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_session_staff_session_id ON public.session_staff(session_id);
CREATE INDEX IF NOT EXISTS idx_session_staff_staff_id ON public.session_staff(staff_id);

-- Add is_responsible column to session_staff if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'session_staff'
          AND column_name = 'is_responsible'
    ) THEN
        ALTER TABLE public.session_staff ADD COLUMN is_responsible BOOLEAN DEFAULT false;
    END IF;
END $$;

-- ================================================================
-- PHASE 1 GOVERNANCE: ELIGIBILITY & AUDIT EXCEPTION
-- ================================================================
ALTER TABLE public.device_departments ADD COLUMN IF NOT EXISTS eligible_for_session_posting BOOLEAN DEFAULT false;
ALTER TABLE public.staff_master ADD COLUMN IF NOT EXISTS allow_session_posting_override BOOLEAN DEFAULT false;
ALTER TABLE public.transaction_sessions ADD COLUMN IF NOT EXISTS audit_exception_reason TEXT;

ALTER TABLE public.session_staff ADD COLUMN IF NOT EXISTS selected_by UUID;
ALTER TABLE public.session_staff ADD COLUMN IF NOT EXISTS selected_at TIMESTAMPTZ DEFAULT NOW();

-- Fix created_at default for session_staff if it's missing (it was in the CREATE TABLE but for robustness)
ALTER TABLE public.session_staff ALTER COLUMN created_at SET DEFAULT NOW();

-- ================================================================
-- PHASE 2 & 3: POSTING ELIGIBILITY RESOLVER
-- ================================================================

-- ================================================================
-- PHASE 8: DEEP VISIBILITY FIX (RLS BYPASS)
-- ================================================================

-- Security-definer function to check eligibility WITHOUT RLS circularity
CREATE OR REPLACE FUNCTION public.is_staff_posting_eligible(p_staff_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.staff_master s
        LEFT JOIN public.device_departments d ON s.department_id = d.id
        WHERE s.id = p_staff_id
          AND s.is_active = true 
          AND s.is_deleted = false
          AND (
              d.eligible_for_session_posting = true 
              OR s.allow_session_posting_override = true
          )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update VIEW to use the function for consistency
CREATE OR REPLACE VIEW public.posting_eligible_staff_view AS
SELECT 
    s.id,
    s.staff_code,
    s.full_name,
    s.department_id,
    d.name as department_name,
    d.is_default as department_is_default,
    s.allow_session_posting_override,
    d.eligible_for_session_posting
FROM public.staff_master s
LEFT JOIN public.device_departments d ON s.department_id = d.id
WHERE public.is_staff_posting_eligible(s.id);

-- Update RLS POLICY to use the function (Breaking circular dependency)
DROP POLICY IF EXISTS "RLS: staff_master ALL" ON public.staff_master;
CREATE POLICY "RLS: staff_master ALL"
ON public.staff_master
FOR ALL TO authenticated
USING (
    public.has_permission('staff_mgmt','view') 
    OR public.is_staff_posting_eligible(id)
)
WITH CHECK (public.has_permission('staff_mgmt','manage_staff') OR public.get_is_super_admin());

-- Refactor Phase 5 validation to use the same function
CREATE OR REPLACE FUNCTION public.validate_staff_eligibility()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT public.is_staff_posting_eligible(NEW.staff_id) THEN
        RAISE EXCEPTION 'PERSONNEL_INELIGIBLE: Staff member (%) is not eligible for session posting.', NEW.staff_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_validate_staff_eligibility ON public.session_staff;
CREATE TRIGGER trg_validate_staff_eligibility
BEFORE INSERT OR UPDATE ON public.session_staff
FOR EACH ROW EXECUTE FUNCTION public.validate_staff_eligibility();

-- ================================================================
-- BANK RECONCILIATION (Phase 2/3/4)
-- ================================================================

-- (reconcile_locks table and RLS moved up to resolve bootstrapping ordering issues)

CREATE OR REPLACE FUNCTION public.reconcile_bank_txn(
    p_book_line_ids UUID[],
    p_statement_item_id UUID,
    p_recon_date DATE
)
RETURNS BOOLEAN AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_bank_item RECORD;
    v_book_total DECIMAL(15,2);
    v_lock_date DATE;
    v_incorrect_side_count INTEGER;
    v_incorrect_ledger_count INTEGER;
    v_found_books_count INTEGER;
    v_unreconciled_count INTEGER;
BEGIN
    -- 0. Permission check
    IF NOT (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin()) THEN
        RAISE EXCEPTION 'ACCESS_DENIED: You do not have permission to reconcile bank transactions';
    END IF;

    -- 1. Fetch Bank Statement Item details WITH locking
    SELECT * INTO v_bank_item 
    FROM public.bank_statement_items 
    WHERE id = p_statement_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BANK_ITEM_NOT_FOUND: Bank statement item (%) does not exist', p_statement_item_id;
    END IF;

    -- 1a. Verify current status
    IF v_bank_item.match_status != 'UNMATCHED' THEN
        RAISE EXCEPTION 'ALREADY_MATCHED: Bank statement item is already %', v_bank_item.match_status;
    END IF;

    -- 2. Validate Ledger Lock
    SELECT lock_date INTO v_lock_date 
    FROM public.reconcile_locks 
    WHERE ledger_id = v_bank_item.ledger_id;

    IF v_lock_date IS NOT NULL THEN
        -- Check p_recon_date
        IF p_recon_date <= v_lock_date THEN
            RAISE EXCEPTION 'PERIOD_LOCKED: Reconciliation date (%) is on or before the locked date (%)', p_recon_date, v_lock_date;
        END IF;

        -- Check bank item date
        IF v_bank_item.txn_date <= v_lock_date THEN
            RAISE EXCEPTION 'PERIOD_LOCKED: Bank transaction date (%) is on or before the locked date (%)', v_bank_item.txn_date, v_lock_date;
        END IF;
    END IF;

    -- 3. Fetch and Lock Book Lines
    IF p_book_line_ids IS NULL OR array_length(p_book_line_ids, 1) = 0 THEN
        RAISE EXCEPTION 'INVALID_INPUT: No book lines provided for reconciliation';
    END IF;

    -- Verify all lines exist and are unreconciled
    -- Step 1: Lock the rows first (no aggregates allowed with FOR UPDATE)
    PERFORM id FROM public.voucher_lines
    WHERE id = ANY(p_book_line_ids)
    FOR UPDATE;

    -- Step 2: Count and validate separately
    SELECT count(*), count(*) FILTER (WHERE recon_status = 'UNRECONCILED')
    INTO v_found_books_count, v_unreconciled_count
    FROM public.voucher_lines
    WHERE id = ANY(p_book_line_ids);

    IF v_found_books_count != array_length(p_book_line_ids, 1) THEN
        RAISE EXCEPTION 'BOOKS_NOT_FOUND: One or more book line IDs are invalid';
    END IF;

    IF v_unreconciled_count != v_found_books_count THEN
        RAISE EXCEPTION 'ALREADY_RECONCILED: One or more selected book lines are already reconciled';
    END IF;

    -- Step 3: Validate lock date against voucher dates
    IF v_lock_date IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.voucher_lines vl
        JOIN public.vouchers v ON vl.voucher_id = v.id
        WHERE vl.id = ANY(p_book_line_ids) AND v.voucher_date <= v_lock_date
    ) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: One or more selected vouchers are on or before the locked date (%)', v_lock_date;
    END IF;

    -- 4. Validate Ledger Consistency (all book lines must match bank item ledger)
    SELECT count(*) INTO v_incorrect_ledger_count
    FROM public.voucher_lines
    WHERE id = ANY(p_book_line_ids) AND ledger_id != v_bank_item.ledger_id;

    IF v_incorrect_ledger_count > 0 THEN
        RAISE EXCEPTION 'LEDGER_MISMATCH: One or more selected book lines belong to a different ledger than the bank statement';
    END IF;

    -- 4.5 Validate Voucher Status (Must be POSTED)
    IF EXISTS (
        SELECT 1 FROM public.voucher_lines vl
        JOIN public.vouchers v ON vl.voucher_id = v.id
        WHERE vl.id = ANY(p_book_line_ids) AND v.status != 'POSTED'
    ) THEN
        RAISE EXCEPTION 'NOT_POSTED: One or more selected book lines belong to a voucher that is not POSTED.';
    END IF;

    -- 5. Validate Amount Equality (COALESCE handles empty/NULL case)
    SELECT COALESCE(SUM(amount), 0) INTO v_book_total
    FROM public.voucher_lines
    WHERE id = ANY(p_book_line_ids);

    -- Tolerance: 1 paisa (0.01) to handle minor rounding differences
    IF ABS(v_book_total - v_bank_item.amount) > 0.01 THEN
        RAISE EXCEPTION 'AMOUNT_MISMATCH: Book total (%) does not match bank statement amount (%)', v_book_total, v_bank_item.amount;
    END IF;

    -- 6. Validate Side Compatibility
    -- Bank CR (Deposit) -> Book DR (Receipt)
    -- Bank DR (Withdrawal) -> Book CR (Payment)
    SELECT count(*) INTO v_incorrect_side_count
    FROM public.voucher_lines
    WHERE id = ANY(p_book_line_ids)
    AND (
        (v_bank_item.direction = 'CR' AND side != 'DR') OR
        (v_bank_item.direction = 'DR' AND side != 'CR')
    );

    IF v_incorrect_side_count > 0 THEN
        RAISE EXCEPTION 'SIDE_MISMATCH: Book line entries must be on the opposite side of the bank statement direction';
    END IF;

    -- 7. Perform Reconciliation updates
    -- Update Books
    UPDATE public.voucher_lines
    SET 
        recon_status = 'RECONCILED',
        recon_date = p_recon_date,
        matched_statement_id = p_statement_item_id,
        recon_audit = jsonb_build_object(
            'reconciled_by', v_user_id,
            'reconciled_at', now()
        )
    WHERE id = ANY(p_book_line_ids);

    -- Update Bank Side
    UPDATE public.bank_statement_items
    SET 
        match_status = 'MATCHED',
        matched_book_line_id = p_book_line_ids[1] -- We link to the first one for reference
    WHERE id = p_statement_item_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.unreconcile_bank_txn(
    p_statement_item_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_ledger_id UUID;
    v_lock_date DATE;
    v_recon_date DATE;
    v_match_status VARCHAR(20);
    v_rows INTEGER;
BEGIN
    -- 0. Permission check
    IF NOT (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin()) THEN
        RAISE EXCEPTION 'ACCESS_DENIED: You do not have permission to unreconcile bank transactions';
    END IF;

    -- 1) Get recon info and check lock WITH locking
    SELECT ledger_id, txn_date, match_status INTO v_ledger_id, v_recon_date, v_match_status
    FROM public.bank_statement_items 
    WHERE id = p_statement_item_id
    FOR UPDATE;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'BANK_ITEM_NOT_FOUND: Bank statement item (%) does not exist', p_statement_item_id;
    END IF;

    IF v_match_status != 'MATCHED' THEN
        RAISE EXCEPTION 'NOT_MATCHED: Bank statement item is not in MATCHED state (%)', v_match_status;
    END IF;

    SELECT lock_date INTO v_lock_date FROM public.reconcile_locks WHERE ledger_id = v_ledger_id;

    IF v_lock_date IS NOT NULL AND v_recon_date <= v_lock_date THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Cannot unreconcile or modify historical data before %', v_lock_date;
    END IF;

    -- 2) Reset Books linked to this statement item (Lock them first)
    PERFORM id FROM public.voucher_lines 
    WHERE matched_statement_id = p_statement_item_id 
    FOR UPDATE;

    UPDATE public.voucher_lines
    SET 
        recon_status = 'UNRECONCILED',
        recon_date = NULL,
        matched_statement_id = NULL,
        recon_audit = NULL
    WHERE matched_statement_id = p_statement_item_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;

    -- 3) Reset Bank Side
    UPDATE public.bank_statement_items
    SET 
        match_status = 'UNMATCHED',
        matched_book_line_id = NULL
    WHERE id = p_statement_item_id;

    -- 4. Verification: If no rows were updated, and we expected them, it might be a drift
    IF v_rows = 0 THEN
        -- This should be theoretically impossible with the new CHECK constraints 
        -- but provides an extra layer of visibility if something is wrong.
        RAISE EXCEPTION 'UNRECONCILE_FAILED: Could not find or reset associated book lines';
    END IF;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- Atomic "Record & Auto-Match": creates voucher + reconciles
-- in a single transaction so failure in either step rolls back.
-- ============================================================
DROP FUNCTION IF EXISTS public.record_and_reconcile_v1(UUID, UUID, UUID, DATE, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.record_and_reconcile_v1(
    p_voucher_type_id   UUID,
    p_bank_ledger_id    UUID,
    p_statement_item_id UUID,
    p_voucher_date      DATE,
    p_narration         TEXT,
    p_contra_ledger_id  UUID,
    -- lines: [{ledger_id, side, amount}]
    p_lines             JSONB
)
RETURNS UUID AS $$
DECLARE
    v_user_id          UUID := auth.uid();
    v_voucher_no       VARCHAR;
    v_voucher_id       UUID;
    v_total_dr         DECIMAL(15,2);
    v_total_cr         DECIMAL(15,2);
    v_bank_item        RECORD;
    v_bank_line_ids    UUID[] := '{}';
    v_book_total       DECIMAL(15,2);
    v_lock_date        DATE;
    v_line             RECORD;
    v_index            INTEGER := 1;
    v_inserted_line_id UUID;
BEGIN
    -- 0. Permission check
    IF NOT (public.has_permission('bank_recon', 'reconcile') OR public.get_is_super_admin()) THEN
        RAISE EXCEPTION 'ACCESS_DENIED: You do not have permission to record and reconcile bank transactions';
    END IF;

    -- 1. Fetch, lock, and verify bank statement item
    SELECT * INTO v_bank_item
    FROM public.bank_statement_items
    WHERE id = p_statement_item_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'BANK_ITEM_NOT_FOUND: Statement item % does not exist', p_statement_item_id;
    END IF;

    IF v_bank_item.match_status != 'UNMATCHED' THEN
        RAISE EXCEPTION 'ALREADY_MATCHED: This statement item is already %', v_bank_item.match_status;
    END IF;

    -- 1b. Integrity: Verify statement ledger equals passed bank ledger
    IF v_bank_item.ledger_id != p_bank_ledger_id THEN
        RAISE EXCEPTION 'LEDGER_MISMATCH: Provided bank ledger does not match the ledger of the statement item';
    END IF;

    -- 2. Check period lock
    SELECT lock_date INTO v_lock_date
    FROM public.reconcile_locks
    WHERE ledger_id = p_bank_ledger_id;

    IF v_lock_date IS NOT NULL THEN
        IF p_voucher_date <= v_lock_date THEN
            RAISE EXCEPTION 'PERIOD_LOCKED: Cannot post on or before the locked date (%)', v_lock_date;
        END IF;

        IF v_bank_item.txn_date <= v_lock_date THEN
            RAISE EXCEPTION 'PERIOD_LOCKED: Bank transaction date (%) is on or before the locked date (%)', v_bank_item.txn_date, v_lock_date;
        END IF;
    END IF;

    -- 3. Validate lines total equals bank item amount
    SELECT SUM((line->>'amount')::DECIMAL) INTO v_book_total FROM jsonb_array_elements(p_lines) AS line
    WHERE (line->>'ledger_id')::UUID = p_bank_ledger_id;

    IF v_book_total IS NULL OR ABS(v_book_total - v_bank_item.amount) > 0.01 THEN
        RAISE EXCEPTION 'AMOUNT_MISMATCH: Bank line total (%) does not match statement amount (%)', v_book_total, v_bank_item.amount;
    END IF;

    -- 3.5 Validate DB/CR Balancing
    SELECT 
        COALESCE(SUM(CASE WHEN side = 'DR' THEN (line->>'amount')::DECIMAL ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN side = 'CR' THEN (line->>'amount')::DECIMAL ELSE 0 END), 0)
    INTO v_total_dr, v_total_cr
    FROM jsonb_array_elements(p_lines) AS line,
         jsonb_to_record(line) AS x(side VARCHAR);

    IF ABS(v_total_dr - v_total_cr) > 0.01 THEN
        RAISE EXCEPTION 'UNBALANCED_VOUCHER: Total Debits (%) do not equal Total Credits (%)', v_total_dr, v_total_cr;
    END IF;

    -- 4. Create voucher
    v_voucher_no := public.get_next_voucher_number(p_voucher_type_id);

    INSERT INTO public.vouchers (
        voucher_no, voucher_type_id, voucher_date, narration,
        total_debit, total_credit, status, posted_at,
        bank_status, approval_status
    ) VALUES (
        v_voucher_no, p_voucher_type_id, p_voucher_date, p_narration,
        v_bank_item.amount, v_bank_item.amount, 'POSTED', NOW(),
        'NONE', 'NOT_REQUIRED'
    ) RETURNING id INTO v_voucher_id;

    -- 5. Insert voucher lines and capture bank line ids
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
        ledger_id UUID, side VARCHAR, amount DECIMAL, line_narration TEXT
    ) LOOP
        INSERT INTO public.voucher_lines (
            voucher_id, line_number, ledger_id, side, amount, line_narration
        ) VALUES (
            v_voucher_id, v_index, v_line.ledger_id, v_line.side, v_line.amount, v_line.line_narration
        ) RETURNING id INTO v_inserted_line_id;

        IF v_line.ledger_id = p_bank_ledger_id THEN
            v_bank_line_ids := array_append(v_bank_line_ids, v_inserted_line_id);
        END IF;

        v_index := v_index + 1;
    END LOOP;

    IF array_length(v_bank_line_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'INVALID_INPUT: No bank-ledger lines found in the payload';
    END IF;

    -- 6. Reconcile — link the bank voucher lines to the statement item
    UPDATE public.voucher_lines
    SET
        recon_status        = 'RECONCILED',
        recon_date          = p_voucher_date,
        matched_statement_id = p_statement_item_id,
        recon_audit         = jsonb_build_object(
            'reconciled_by', v_user_id,
            'reconciled_at', now()
        )
    WHERE id = ANY(v_bank_line_ids);

    UPDATE public.bank_statement_items
    SET
        match_status           = 'MATCHED',
        matched_book_line_id   = v_bank_line_ids[1] -- Primary reference
    WHERE id = p_statement_item_id;

    RETURN v_voucher_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ================================================================
-- SYSTEM MASTER PROTECTION (For Factory Reset Integrity)
-- ================================================================
DO $$
BEGIN
    -- Add is_system to core master tables to allow protected factory reset
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ledger_groups' AND column_name = 'is_system') THEN
        ALTER TABLE public.ledger_groups ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voucher_groups' AND column_name = 'is_system') THEN
        ALTER TABLE public.voucher_groups ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'voucher_types' AND column_name = 'is_system') THEN
        ALTER TABLE public.voucher_types ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'uoms' AND column_name = 'is_system') THEN
        ALTER TABLE public.uoms ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reference_prefixes' AND column_name = 'is_system') THEN
        ALTER TABLE public.reference_prefixes ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'device_departments' AND column_name = 'is_system') THEN
        ALTER TABLE public.device_departments ADD COLUMN is_system BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Mark existing seeded data as system protected
UPDATE public.ledger_groups SET is_system = TRUE WHERE group_name IN ('Current Assets', 'Current Liabilities', 'Indirect Income', 'Indirect Expenses', 'Direct Income', 'Direct Expenses', 'Fixed Assets', 'Loans (Liability)', 'Capital Account', 'Suspense Account');
UPDATE public.voucher_groups SET is_system = TRUE WHERE group_name IN ('ACCOUNTING', 'INVENTORY');
UPDATE public.uoms SET is_system = TRUE WHERE code IN ('INT', 'NOS', 'PCS', 'UNT', 'KGS');
UPDATE public.reference_prefixes SET is_system = TRUE WHERE prefix IN ('VCH', 'REC', 'PAY');
UPDATE public.ledgers SET is_system = TRUE WHERE ledger_name IN ('Cash in Hand', 'Customer Receivables', 'Supplier Payables', 'Customer Advances', 'Supplier Advances', 'Round Off +', 'Round off -', 'Discount Allowed');
UPDATE public.voucher_types SET is_system = TRUE WHERE type_code IN ('RECEIPT', 'PAYMENT', 'CONTRA', 'JOURNAL', 'SALE', 'PURCHASE');
UPDATE public.device_departments SET is_system = TRUE WHERE name IN ('Counter', 'Waitstaff', 'Kitchen') OR is_default = TRUE;

COMMIT;


-- Feature visibility table for enable/disable functionality
CREATE TABLE IF NOT EXISTS public.feature_visibility (
    feature_id TEXT PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT TRUE NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Enable RLS
ALTER TABLE public.feature_visibility ENABLE ROW LEVEL SECURITY;

-- Policies
-- Everyone can read
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view feature visibility' AND tablename = 'feature_visibility') THEN
        CREATE POLICY "Anyone can view feature visibility"
        ON public.feature_visibility FOR SELECT
        USING (true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can manage feature visibility' AND tablename = 'feature_visibility') THEN
        CREATE POLICY "Admins can manage feature visibility"
        ON public.feature_visibility FOR ALL
        TO authenticated
        USING (
            EXISTS (
                SELECT 1 FROM public.user_profiles
                WHERE id = auth.uid() AND is_super_admin = true
            )
        );
    END IF;
END $$;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.set_feature_visibility_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    NEW.updated_by = auth.uid();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_feature_visibility_updated_at ON public.feature_visibility;
CREATE TRIGGER tr_feature_visibility_updated_at
BEFORE INSERT OR UPDATE ON public.feature_visibility
FOR EACH ROW EXECUTE FUNCTION public.set_feature_visibility_updated_at();


















-- Apply fixes to the CORRECT project (qgoqminjgrwzukscdaez)

-- 1. Add missing columns to voucher_lines
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_status VARCHAR(20) DEFAULT 'UNRECONCILED' CHECK (recon_status IN ('UNRECONCILED', 'RECONCILED'));
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_date DATE;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS statement_ref TEXT;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS matched_statement_id UUID;
ALTER TABLE public.voucher_lines ADD COLUMN IF NOT EXISTS recon_audit JSONB;

-- 2. Ensure reconciliation locks table exists
CREATE TABLE IF NOT EXISTS public.reconcile_locks (
    ledger_id UUID PRIMARY KEY REFERENCES public.ledgers(id),
    lock_date DATE NOT NULL,
    locked_by UUID REFERENCES auth.users(id),
    locked_at TIMESTAMPTZ DEFAULT now()
);

-- (Optional: only if you still see errors after running the above)
-- I recommend just running the whole 'reconcile_bank_txn' definition from supbase.sql again.

-- ================================================================
-- SYSTEM LOG RETENTION SYSTEM
-- ================================================================

-- Function to cleanup audit logs older than specified days
CREATE OR REPLACE FUNCTION public.cleanup_audit_logs(p_days_to_keep INTEGER DEFAULT 30)
RETURNS VOID AS $$
BEGIN
    DELETE FROM public.system_audit_logs
    WHERE created_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the cleanup job to run every night at midnight
-- Supabase uses 'cron' schema for pg_cron
-- We use DO block to handle scheduling safely
DO $$
BEGIN
    -- Only attempt to schedule if cron schema exists
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Schedule or update the job
        PERFORM cron.schedule(
            'nightly-audit-log-cleanup',
            '0 0 * * *',
            $cron$ SELECT public.cleanup_audit_logs(30); $cron$
        );
    END IF;
END $$;

-- ================================================================
-- PATCH: verify_day_v1 — Fix Bug 1 (False Absences)
-- Problem: The previous version inserted ABSENT rows for ALL active
--   staff with no attendance_record, including staff on approved leave
--   or on a weekly-off day. This caused the history RPC (which prefers
--   attendance_records.status before LEAVE / WEEKLY_OFF) to surface
--   ABSENT instead of the correct status in profiles and reporting.
-- Fix: The ABSENT-insert step now skips:
--   (a) Staff with an approved or taken leave_day for p_date.
--   (b) Staff whose shift group's weekly_off array includes the
--       day-of-week of p_date (0=Sun…6=Sat, PostgreSQL DOW).
-- The verify/mark-verified UPDATE is unchanged.
-- ================================================================

DROP FUNCTION IF EXISTS public.verify_day_v1(DATE, UUID, UUID);
CREATE OR REPLACE FUNCTION public.verify_day_v1(
    p_date           DATE,
    p_verified_by    UUID,
    p_shift_group_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_staff_id UUID;
BEGIN
    IF NOT public.has_permission('hr_attendance', 'manage_attendance') THEN
        RAISE EXCEPTION 'Unauthorized: Permission manage_attendance required.';
    END IF;

    -- Enforcement: Auto-absence verification only applies to historical (completed) days.
    IF p_date >= CURRENT_DATE THEN
        RETURN;
    END IF;

    -- Step 1: Insert ABSENT only for staff who:
    --   • are active and in scope
    --   • have NO existing attendance_record for this date
    --   • have NO raw events in the pipeline for this date
    --   • have NO computed summary for this date
    --   • are NOT on an approved/taken leave for this date
    --   • are NOT on a weekly-off day for their shift
    --   • NOT a holiday
    INSERT INTO attendance_records (staff_id, attendance_date, status, notes)
    SELECT sm.id, p_date, 'ABSENT', 'Auto-generated during verification'
    FROM staff_master sm
    LEFT JOIN shift_groups sg ON sg.id = sm.shift_group_id
    WHERE sm.is_active = true
      AND (p_shift_group_id IS NULL OR sm.shift_group_id = p_shift_group_id)
      -- no row yet
      AND NOT EXISTS (
          SELECT 1 FROM attendance_records ar
          WHERE ar.staff_id = sm.id AND ar.attendance_date = p_date
      )
      -- no raw events (intelligent check)
      AND NOT EXISTS (
          SELECT 1 FROM raw_attendance_events rae
          WHERE rae.staff_id = sm.id AND rae.event_timestamp::date = p_date
      )
      -- no summary yet
      AND NOT EXISTS (
          SELECT 1 FROM attendance_summaries asu
          WHERE asu.staff_id = sm.id AND asu.attendance_date = p_date
      )
      -- not a holiday
      AND NOT EXISTS (
          SELECT 1 FROM holidays h WHERE h.holiday_date = p_date
      )
      -- not on approved / taken leave
      AND NOT EXISTS (
          SELECT 1
          FROM leave_days ld
          JOIN leave_requests lr ON lr.id = ld.request_id
          WHERE ld.staff_id = sm.id
            AND ld.leave_date = p_date
            AND lr.status IN ('APPROVED', 'TAKEN')
      )
      -- not a weekly-off day for their shift
      AND NOT (
          sg.weekly_off IS NOT NULL
          AND EXTRACT(DOW FROM p_date)::int = ANY(sg.weekly_off)
      )
    ON CONFLICT (staff_id, attendance_date) DO NOTHING;

    -- Step 2: Mark all in-scope rows as verified
    UPDATE attendance_records ar
    SET is_verified = TRUE,
        verified_by = p_verified_by,
        updated_at  = NOW()
    FROM staff_master sm
    WHERE ar.attendance_date = p_date
      AND ar.staff_id = sm.id
      AND (p_shift_group_id IS NULL OR sm.shift_group_id = p_shift_group_id)
      AND COALESCE(ar.is_verified, false) = false;

    -- Step 3: Trigger re-compute for all impacted staff to sync summaries
    FOR v_staff_id IN (
        SELECT sm.id FROM staff_master sm
        WHERE sm.is_active = true
          AND (p_shift_group_id IS NULL OR sm.shift_group_id = p_shift_group_id)
    ) LOOP
        PERFORM public.compute_attendance_day_v1(v_staff_id, p_date, TRUE);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.verify_day_v1(DATE, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_day_v1(DATE, UUID, UUID) TO authenticated;

-- ================================================================
-- PATCH: Attendance Workflows (Round 3)
-- Bug 8: Unify Incidents (delay_incidents <-> attendance_incidents)
-- Bug 9: Apply Logic (Corrections & Incidents in compute_day)
-- ================================================================

-- 1. Corrected Incident Creation: Fans out group delays to individuals
DROP FUNCTION IF EXISTS public.create_delay_incident_v1(DATE, TEXT, UUID[], INTEGER, UUID, TIME, TIME);
CREATE OR REPLACE FUNCTION public.create_delay_incident_v1(
    p_incident_date DATE,
    p_reason TEXT,
    p_responsible_staff_ids UUID[],
    p_excuse_minutes INTEGER,
    p_shift_group_id UUID DEFAULT NULL,
    p_start_time TIME DEFAULT NULL,
    p_end_time TIME DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_group_id UUID;
    v_affected_staff_ids UUID[] := '{}';
    v_staff_id UUID;
BEGIN
    IF NOT (public.has_permission('hr_attendance', 'manage_attendance')) THEN
        RAISE EXCEPTION 'Unauthorized: Permission manage_attendance required.';
    END IF;

    -- Store Group Record
    INSERT INTO public.delay_incidents (
        incident_date, reason, responsible_staff_ids, excuse_minutes, shift_group_id, status
    )
    VALUES (p_incident_date, p_reason, p_responsible_staff_ids, p_excuse_minutes, p_shift_group_id, 'PENDING')
    RETURNING id INTO v_group_id;

    -- Auto-scope impacted staff (late staff)
    SELECT array_agg(DISTINCT ar.staff_id) INTO v_affected_staff_ids
    FROM public.attendance_records ar
    JOIN public.staff_master sm ON sm.id = ar.staff_id
    JOIN public.shift_groups sg ON sg.id = sm.shift_group_id
    WHERE ar.attendance_date = p_incident_date
      AND (p_shift_group_id IS NULL OR sm.shift_group_id = p_shift_group_id)
      AND ar.punch_in IS NOT NULL
      AND (
          (p_start_time IS NOT NULL AND p_end_time IS NOT NULL AND ar.punch_in::time BETWEEN p_start_time AND p_end_time)
          OR (p_start_time IS NULL AND ar.punch_in::time > (sg.start_time + (sg.grace_in_minutes || ' minutes')::interval))
      );

    -- 1. Create Individual Incidents for LATE staff
    IF v_affected_staff_ids IS NOT NULL THEN
        FOREACH v_staff_id IN ARRAY v_affected_staff_ids LOOP
            INSERT INTO public.attendance_incidents (staff_id, attendance_date, incident_type, staff_reason, impact_data, status)
            VALUES (
                v_staff_id, 
                p_incident_date, 
                'LATE', 
                'Group Delay: ' || p_reason, 
                jsonb_build_object('excuse_minutes', p_excuse_minutes, 'group_id', v_group_id), 
                'PENDING'
            ) ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    -- 2. Create Individual Incidents for RESPONSIBLE staff (e.g. for reallocating penalty)
    IF p_responsible_staff_ids IS NOT NULL THEN
        FOREACH v_staff_id IN ARRAY p_responsible_staff_ids LOOP
            INSERT INTO public.attendance_incidents (staff_id, attendance_date, incident_type, staff_reason, impact_data, status)
            VALUES (
                v_staff_id, 
                p_incident_date, 
                'GENERIC_EXCEPTION', -- Or specific type for responsibility
                'REALLOCATED RESPONSIBILITY: ' || p_reason, 
                jsonb_build_object('is_responsible', true, 'group_id', v_group_id), 
                'PENDING'
            ) ON CONFLICT DO NOTHING;
        END LOOP;
    END IF;

    RETURN v_group_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Corrected Group Resolution Logic
DROP FUNCTION IF EXISTS public.resolve_delay_incident_v1(UUID, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.resolve_delay_incident_v1(
    p_incident_id UUID,
    p_status TEXT,
    p_approver_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_rec RECORD;
    v_di_rec RECORD;
    v_penalty_rate NUMERIC(12,2) := 0;
    v_staff_id UUID;
BEGIN
    IF NOT public.has_permission('hr_attendance', 'manage_attendance') THEN
        RAISE EXCEPTION 'Unauthorized: Permission manage_attendance required.';
    END IF;

    -- Fetch Group Record Data
    SELECT * INTO v_di_rec FROM public.delay_incidents WHERE id = p_incident_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- Update Group Status
    UPDATE public.delay_incidents
    SET status = p_status, approved_by = p_approver_id, updated_at = NOW()
    WHERE id = p_incident_id;

    -- Update all linked Individual Incidents
    UPDATE public.attendance_incidents
    SET status = CASE WHEN p_status = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END,
        resolved_by = p_approver_id,
        resolved_at = NOW(),
        resolution_reason = 'Group decision',
        updated_at = NOW()
    WHERE impact_data->>'group_id' = p_incident_id::text;

    -- NEW: Handle Financial Penalty Reallocation for Responsible Staff
    IF p_status = 'APPROVED' AND v_di_rec.responsible_staff_ids IS NOT NULL THEN
        -- Resolve penalty rate for the shift group
        SELECT penalty_per_minute INTO v_penalty_rate
        FROM public.shift_groups WHERE id = v_di_rec.shift_group_id;

        IF v_penalty_rate > 0 THEN
            FOREACH v_staff_id IN ARRAY v_di_rec.responsible_staff_ids LOOP
                INSERT INTO public.attendance_salary_deductions (
                    staff_id, incident_id, amount, deduction_type, notes, status
                ) VALUES (
                    v_staff_id, 
                    p_incident_id, 
                    COALESCE(v_di_rec.excuse_minutes, 0) * v_penalty_rate, 
                    'DELAY_RESPONSIBILITY',
                    'Liability reallocated from group delay incident #' || p_incident_id,
                    'PENDING'
                );
            END LOOP;
        END IF;
    END IF;

    -- Trigger re-compute for everyone in the group
    FOR v_rec IN (
        SELECT staff_id, attendance_date FROM public.attendance_incidents
        WHERE impact_data->>'group_id' = p_incident_id::text
    ) LOOP
        PERFORM public.compute_attendance_day_v1(v_rec.staff_id, v_rec.attendance_date, TRUE);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Core Compute Update: Apply Corrections & Incidents
CREATE OR REPLACE FUNCTION public.compute_attendance_day_v1(
    p_staff_id UUID,
    p_date DATE,
    p_force_recompute BOOLEAN DEFAULT FALSE
)
RETURNS UUID AS $$
DECLARE
    v_summary_id UUID;
    v_primary_res RECORD;
    v_final_status TEXT;
    v_leave_exists BOOLEAN;
    v_holiday_exists BOOLEAN;
    v_manual_exists BOOLEAN;
    v_manual_status TEXT;
    v_existing_summary RECORD;
    v_anomalies TEXT[] := '{}';
    -- Impact hooks
    v_corr RECORD;
    v_inc RECORD;
    v_late_mins INTEGER;
    v_early_mins INTEGER;
    v_net_mins INTEGER;
    v_applied_corr_id UUID := NULL;
    v_applied_inc_id UUID := NULL;
    v_has_pending BOOLEAN := FALSE;
BEGIN
    -- 0. Check for existing locked summary
    SELECT * INTO v_existing_summary 
    FROM public.attendance_summaries 
    WHERE staff_id = p_staff_id AND attendance_date = p_date;

    IF v_existing_summary.is_locked AND NOT p_force_recompute THEN
        RETURN v_existing_summary.id;
    END IF;

    -- 1. Run Stages 1-8 (Primary Resolver)
    SELECT * INTO v_primary_res FROM public.resolve_primary_attendance_v1(p_staff_id, p_date);
    v_final_status := v_primary_res.primary_status;
    v_anomalies := v_primary_res.out_anomaly_flags;
    v_late_mins := v_primary_res.late_mins;
    v_early_mins := v_primary_res.early_out_mins;
    v_net_mins := v_primary_res.worked_net;

    -- 2. Stage 9: Hierarchy Overlay (Manual/Leave/Holiday)
    SELECT EXISTS (
        SELECT 1 FROM public.leave_days ld
        JOIN public.leave_requests lr ON lr.id = ld.request_id
        WHERE ld.staff_id = p_staff_id AND ld.leave_date = p_date AND lr.status IN ('APPROVED', 'TAKEN')
    ) INTO v_leave_exists;

    -- Resolve Holiday
    SELECT EXISTS (SELECT 1 FROM public.holidays WHERE holiday_date = p_date) INTO v_holiday_exists; 

    SELECT status INTO v_manual_status 
    FROM public.attendance_records 
    WHERE staff_id = p_staff_id AND attendance_date = p_date AND is_verified = TRUE;
    
    v_manual_exists := (v_manual_status IS NOT NULL);

    IF v_manual_exists THEN
        v_final_status := v_manual_status;
        v_anomalies := v_anomalies || 'MANUAL_OVERRIDE';
    ELSIF v_leave_exists THEN
        v_final_status := 'LEAVE';
        v_anomalies := v_anomalies || 'LEAVE_OVERLAY';
    ELSIF v_holiday_exists THEN
        v_final_status := 'HOLIDAY';
        v_anomalies := v_anomalies || 'HOLIDAY_OVERLAY';
    END IF;

    -- NEW: Stage 11: Correction Impact Override
    SELECT * INTO v_corr FROM public.attendance_corrections 
    WHERE staff_id = p_staff_id AND attendance_date = p_date AND status = 'APPROVED';

    IF v_corr.id IS NOT NULL THEN
        v_applied_corr_id := v_corr.id;
        IF v_corr.proposed_impact ? 'status' THEN
            v_final_status := v_corr.proposed_impact->>'status';
        END IF;
        
        -- Support overriding specific metrics from correction
        IF v_corr.proposed_impact ? 'worked_minutes_net' THEN
            v_net_mins := (v_corr.proposed_impact->>'worked_minutes_net')::integer;
        END IF;
        
        v_anomalies := v_anomalies || 'WORKFLOW_CORRECTION_APPLIED';
    END IF;

    -- NEW: Stage 12: Incident Impact Override (e.g. Excused Late)
    SELECT * INTO v_inc FROM public.attendance_incidents 
    WHERE staff_id = p_staff_id AND attendance_date = p_date AND status = 'APPROVED'
    ORDER BY created_at DESC LIMIT 1;

    IF v_inc.id IS NOT NULL THEN
        v_applied_inc_id := v_inc.id;
        IF v_inc.impact_data ? 'excuse_minutes' THEN
            v_late_mins := GREATEST(0, v_late_mins - (v_inc.impact_data->>'excuse_minutes')::integer);
            -- If late is now 0, status might need promotion (check early-out too)
            IF v_late_mins = 0 AND v_final_status = 'LATE_PRESENT' THEN
                IF v_early_mins > 0 THEN
                    v_final_status := 'EARLY_OUT';
                ELSE
                    v_final_status := 'PRESENT';
                END IF;
            END IF;
        END IF;
        v_anomalies := v_anomalies || 'WORKFLOW_INCIDENT_APPLIED';
    END IF;

    -- Check if any correction is still pending for the badge
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_corrections 
        WHERE staff_id = p_staff_id AND attendance_date = p_date AND status IN ('SUBMITTED', 'MANAGER_REVIEW', 'HR_REVIEW')
    ) INTO v_has_pending;

    -- 3. Stage 10: Persistence
    INSERT INTO public.attendance_summaries (
        staff_id,
        attendance_date,
        primary_status,
        worked_minutes_gross,
        worked_minutes_net,
        late_minutes,
        early_out_minutes,
        shift_id,
        assignment_id,
        anomaly_flags,
        raw_punch_in,
        raw_punch_out,
        applied_correction_id,
        applied_incident_id,
        has_pending_correction,
        compute_metadata
    ) VALUES (
        p_staff_id,
        p_date,
        v_final_status,
        v_primary_res.worked_gross,
        v_net_mins,
        v_late_mins,
        v_early_mins,
        v_primary_res.out_shift_id,
        v_primary_res.out_assignment_id,
        v_anomalies,
        v_primary_res.out_raw_in,
        v_primary_res.out_raw_out,
        v_applied_corr_id,
        v_applied_inc_id,
        v_has_pending,
        jsonb_build_object('version', '2.0.0', 'computed_at', NOW(), 'recompute', p_force_recompute)
    )
    ON CONFLICT (staff_id, attendance_date) DO UPDATE
    SET
        primary_status = EXCLUDED.primary_status,
        worked_minutes_gross = EXCLUDED.worked_minutes_gross,
        worked_minutes_net = EXCLUDED.worked_minutes_net,
        late_minutes = EXCLUDED.late_minutes,
        early_out_minutes = EXCLUDED.early_out_minutes,
        shift_id = EXCLUDED.shift_id,
        assignment_id = EXCLUDED.assignment_id,
        anomaly_flags = EXCLUDED.anomaly_flags,
        raw_punch_in = EXCLUDED.raw_punch_in,
        raw_punch_out = EXCLUDED.raw_punch_out,
        applied_correction_id = EXCLUDED.applied_correction_id,
        applied_incident_id = EXCLUDED.applied_incident_id,
        has_pending_correction = EXCLUDED.has_pending_correction,
        compute_metadata = EXCLUDED.compute_metadata,
        updated_at = NOW()
    RETURNING id INTO v_summary_id;

    RETURN v_summary_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- PATCH: Attendance Workflows & Reporting (Round 4)
-- Bug 10: Clear pending flag consistently
-- Bug 11: Align report data shapes with UI
-- Bug 12: Correct leave counting in daily summary
-- ================================================================

-- 1. Corrected Correction Resolution: Clear pending flag on terminal status
CREATE OR REPLACE FUNCTION public.resolve_attendance_correction(
    p_correction_id UUID,
    p_action TEXT, -- MANAGER_APPROVE / MANAGER_REJECT / HR_APPROVE / HR_REJECT
    p_reason TEXT
)
RETURNS VOID AS $$
DECLARE
    v_corr RECORD;
    v_new_status attendance_correction_state;
    v_is_hr BOOLEAN;
    v_is_manager BOOLEAN;
BEGIN
    SELECT * INTO v_corr FROM public.attendance_corrections WHERE id = p_correction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Correction not found.';
    END IF;

    v_is_hr := public.has_permission('hr_attendance', 'manage_attendance');
    
    -- Manager check: HR can resolve anything, otherwise check if auth.uid() is the manager for v_corr.staff_id
    IF NOT v_is_hr THEN
        -- Check if current user is the manager for this staff member
        -- (Assuming manager_id column exists on staff_master as per security audit requirements)
        SELECT EXISTS (
            SELECT 1 FROM public.staff_master 
            WHERE id = v_corr.staff_id AND manager_id = auth.uid()
        ) INTO v_is_manager;

        IF NOT v_is_manager THEN
            RAISE EXCEPTION 'Unauthorized: Manager or HR permissions required for resolution.';
        END IF;
    END IF;

    CASE p_action
        WHEN 'MANAGER_APPROVE' THEN
            v_new_status := 'MANAGER_REVIEW';
            UPDATE public.attendance_corrections
            SET status = v_new_status, manager_id = auth.uid(), manager_reason = p_reason, manager_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'MANAGER_REJECT' THEN
            v_new_status := 'REJECTED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, manager_id = auth.uid(), manager_reason = p_reason, manager_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'HR_APPROVE' THEN
            IF NOT v_is_hr THEN RAISE EXCEPTION 'Unauthorized: HR permissions required.'; END IF;
            v_new_status := 'APPROVED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, hr_id = auth.uid(), hr_reason = p_reason, hr_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        WHEN 'HR_REJECT' THEN
            IF NOT v_is_hr THEN RAISE EXCEPTION 'Unauthorized: HR permissions required.'; END IF;
            v_new_status := 'REJECTED';
            UPDATE public.attendance_corrections
            SET status = v_new_status, hr_id = auth.uid(), hr_reason = p_reason, hr_resolved_at = NOW(), updated_at = NOW()
            WHERE id = p_correction_id;

        ELSE
            RAISE EXCEPTION 'Invalid action: %', p_action;
    END CASE;

    -- Clear pending flag for terminal statuses (APPROVED / REJECTED)
    IF v_new_status IN ('APPROVED', 'REJECTED') THEN
        UPDATE public.attendance_summaries
        SET has_pending_correction = FALSE
        WHERE staff_id = v_corr.staff_id AND attendance_date = v_corr.attendance_date;
    END IF;

    -- Recompute if approved
    IF v_new_status = 'APPROVED' THEN
        PERFORM public.compute_attendance_day_v1(v_corr.staff_id, v_corr.attendance_date, TRUE);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Corrected Daily Summary: Align field names and fix leave count
DROP FUNCTION IF EXISTS public.get_daily_muster_summary_v1(DATE) CASCADE;
DROP FUNCTION IF EXISTS get_daily_muster_summary_v1(DATE) CASCADE;
CREATE OR REPLACE FUNCTION public.get_daily_muster_summary_v1(
    p_date DATE
)
RETURNS TABLE (
    total_staff BIGINT,
    present_count BIGINT,
    absent_count BIGINT,
    leave_count BIGINT,
    miss_punch BIGINT,
    late_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH staff_on_leave AS (
        SELECT DISTINCT ld.staff_id
        FROM public.leave_days ld
        JOIN public.leave_requests lr ON lr.id = ld.request_id
        WHERE ld.leave_date = p_date AND lr.status IN ('APPROVED', 'TAKEN')
    )
    SELECT
        COUNT(sm.id),
        COUNT(asum.id) FILTER (WHERE asum.primary_status IN ('PRESENT', 'LATE_PRESENT', 'EARLY_OUT')),
        COUNT(sm.id) FILTER (WHERE asum.primary_status = 'ABSENT' AND sol.staff_id IS NULL),
        COUNT(sol.staff_id),
        COUNT(asum.id) FILTER (WHERE asum.primary_status = 'MISS_PUNCH'),
        COUNT(asum.id) FILTER (
            WHERE asum.late_minutes > 0
        )
    FROM public.staff_master sm
    LEFT JOIN LATERAL public.get_effective_shift(sm.id, p_date) es ON TRUE
    LEFT JOIN public.attendance_summaries asum ON asum.staff_id = sm.id AND asum.attendance_date = p_date
    LEFT JOIN staff_on_leave sol ON sol.staff_id = sm.id
    WHERE sm.is_active = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Corrected Late Report: Return row-level data for UI table
DROP FUNCTION IF EXISTS public.get_late_report_v1(DATE, DATE);
CREATE OR REPLACE FUNCTION public.get_late_report_v1(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    staff_id UUID,
    full_name TEXT,
    staff_code TEXT,
    attendance_date DATE,
    late_minutes INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sm.id,
        sm.full_name::text,
        sm.staff_code::text,
        asum.attendance_date,
        asum.late_minutes
    FROM public.staff_master sm
    JOIN public.attendance_summaries asum ON asum.staff_id = sm.id
    LEFT JOIN LATERAL public.get_effective_shift(sm.id, asum.attendance_date) es ON TRUE
    WHERE asum.attendance_date BETWEEN p_start_date AND p_end_date
      AND asum.late_minutes > 0
    ORDER BY asum.attendance_date DESC, sm.full_name ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- PATCH: Attendance Metrics & Save Logic (Round 5)
-- Bug 13: missing metric field in records
-- ================================================================

ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS excused_early_out_minutes INTEGER DEFAULT 0;

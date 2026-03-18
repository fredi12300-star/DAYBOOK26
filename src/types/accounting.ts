// ================================================================
// TYPESCRIPT TYPES FOR UNIVERSAL DAY BOOK
// Double-Entry Accounting System
// ================================================================

export type AccountNature = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'EQUITY';
export type Side = 'DR' | 'CR';
export type VoucherStatus = 'DRAFT' | 'POSTED' | 'REVERSED';
export type BankStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT_FOR_APPROVAL' | 'FINAL_APPROVED' | 'NONE';
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REQUIRED';
export type PartyType = 'CUSTOMER' | 'VENDOR' | 'BOTH';
export type AmountRule = 'INPUT' | 'FIXED' | 'CALCULATED';

// Phase 1: Behavioral Types
export type VoucherNature = 'RECEIPT' | 'PAYMENT' | 'CONTRA' | 'JOURNAL' | 'SALE' | 'PURCHASE';
export type CashBankFlow = 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
export type PartyRule = 'MANDATORY' | 'OPTIONAL' | 'NOT_ALLOWED';
export type FYStatus = 'OPEN' | 'CLOSED';


// Removed Region and Branch interfaces

// ================================================================
// DATABASE MODELS
// ================================================================

export interface LedgerGroup {
    id: string;
    group_name: string;
    nature: AccountNature;
    parent_group_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface LedgerTag {
    id: string;
    tag_name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface UOM {
    id: string;
    code: string;
    name: string;
    uom_type: 'CURRENCY' | 'WEIGHT' | 'COUNT';
    precision: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface Ledger {
    id: string;
    ledger_name: string;
    ledger_group_id: string;
    business_tags: string[]; // UUID array stored as string[] in TS
    nature: AccountNature;
    normal_side: Side;
    opening_balance: number;
    opening_balance_side: Side | null;
    is_active: boolean;
    allow_party: boolean;
    is_cash_bank: boolean;
    is_system?: boolean;
    default_uom_id?: string | null;
    allow_quantity: boolean;
    quantity_required: boolean;
    bank_name?: string | null;
    bank_account_no?: string | null;
    bank_ifsc?: string | null;
    bank_branch?: string | null;
    sib_rap_prefix?: string | null;
    created_at: string;
    updated_at: string;

    // Computed/joined fields
    ledger_group?: LedgerGroup;
    current_balance?: number;
    balance_side?: Side;
    default_uom?: UOM;
}

export interface BankAccount {
    id: string;
    bank_name: string;
    bank_account_no: string;
    bank_ifsc: string;
}

export interface PartyGroup {
    id: string;
    group_name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface Party {
    id: string;
    group_id?: string | null; // Added: Grouping for CRM/Segmentation
    party_name: string;
    party_type: PartyType;
    contact_person: string | null;
    phone: string | null;
    phone_country_code?: string | null;
    whatsapp_active?: boolean;
    customer_id?: string | null;
    dob: string | null;
    email: string | null;
    address: string | null;
    pincode?: string | null;
    gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
    religion?: string | null;
    occupation?: string | null;
    aadhar_no?: string | null;
    bank_accounts?: BankAccount[];
    gstin: string | null;
    opening_balance?: number;
    opening_balance_side?: Side | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;

    // Joined fields
    group?: PartyGroup;
}

export interface VoucherGroup {
    id: string;
    group_name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface VoucherType {
    id: string;
    group_id?: string | null; // Grouping for organization
    type_code: string;
    type_name: string;
    prefix: string;
    voucher_nature: VoucherNature;
    cash_bank_flow: CashBankFlow;
    party_rule: PartyRule;
    is_active: boolean;
    created_at: string;
    updated_at: string;

    // Joined fields
    group?: VoucherGroup;
}

export interface VoucherSequence {
    voucher_type_id: string;
    next_number: number;
    updated_at: string;
}

export interface Voucher {
    id: string;
    voucher_no: string;
    voucher_type_id: string;
    voucher_date: string;
    narration: string;
    reference_no: string | null;
    party_id: string | null;
    total_debit: number;
    total_credit: number;
    status: VoucherStatus;
    reversed_voucher_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    posted_at: string | null;
    bank_status: BankStatus;
    approval_status?: ApprovalStatus; // New field for robust gatekeeping
    session_id: string | null; // Linked to TransactionSession
    template_id: string | null; // Added: Link to Template
    session?: {
        id: string;
        session_ref: string | null;
        session_date?: string;
        created_at?: string;
    };
    sender_bank_account_id: string | null;
    bank_validation_status: 'NONE' | 'VALIDATED' | 'REJECTED';

    // Joined fields
    voucher_type?: VoucherType;
    party?: Party;
    lines?: VoucherLine[];
}

export interface TransactionSession {
    id: string;
    party_id: string;
    session_date: string;
    narration: string;
    status: 'DRAFT' | 'POSTED' | 'CANCELLED';
    session_ref: string | null;
    audit_exception_reason?: string | null;
    created_by: string | null;
    created_at: string;

    // Joined fields
    party?: Party;
    vouchers?: Voucher[];
}

export interface VoucherLine {
    id: string;
    voucher_id: string;
    line_number: number;
    ledger_id: string;
    party_id: string | null;
    side: Side;
    amount: number;
    line_narration: string | null;
    external_ref: string | null;
    quantity?: number | null;
    uom_id?: string | null;
    rate?: number | null;
    valuation_ref?: string | null;
    is_from_template?: boolean;
    is_fixed_side?: boolean;
    is_credit_settlement?: boolean;
    is_discount_settlement?: boolean;
    is_round_off_settlement?: boolean;
    // Reconciliation Fields
    recon_status: 'UNRECONCILED' | 'RECONCILED';
    recon_date: string | null;
    statement_ref: string | null;
    matched_statement_id: string | null;
    recon_audit: { reconciled_by: string; reconciled_at: string } | null;

    // Joined fields
    ledger?: Ledger;
    party?: Party;
    uom?: UOM;
}

export interface BankStatementItem {
    id: string;
    ledger_id: string;
    txn_date: string;
    description: string | null;
    amount: number;
    direction: Side; // 'DR' or 'CR'
    reference: string | null;
    match_status: 'UNMATCHED' | 'MATCHED' | 'IGNORED';
    matched_book_line_id: string | null;
    import_batch_id: string | null;
    created_at: string;

    // Joined fields
    ledger?: Ledger;
    book_line?: VoucherLine;
}

export interface ReconcileLock {
    ledger_id: string;
    lock_date: string;
    locked_by?: string;
    locked_at?: string;
}

export interface TemplateGroup {
    id: string;
    group_name: string;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface Template {
    id: string;
    voucher_type_id: string | null; // Deprecated, use voucher_type_ids for multi-assignment
    group_id?: string | null; // New field for grouping
    template_name: string;
    template_code: string;
    description: string | null;
    is_active: boolean;
    rounding_rule?: 'ROUND' | 'UP' | 'DOWN' | 'NONE';
    created_at: string;
    updated_at: string;

    // Joined fields
    voucher_type?: VoucherType;
    group?: TemplateGroup; // Joined group data
    voucher_type_ids?: string[];
    lines?: TemplateLine[];
}

export interface TemplateLine {
    id: string;
    template_id: string;
    line_number: number;
    ledger_id: string;
    default_side: Side;
    is_fixed_side: boolean;
    is_required: boolean;
    amount_rule: AmountRule;
    calc_formula: string | null;
    amount_value?: number;
    input_key?: string;
    link_key?: string;
    line_narration_default?: string;
    external_ref_hint?: string;
    created_at: string;

    // Joined fields
    ledger?: Ledger;
}

export interface AuditLog {
    id: string;
    action: string;
    table_name: string;
    record_id: string;
    user_id: string | null;
    old_values: Record<string, any> | null;
    new_values: Record<string, any> | null;
    reason: string | null;
    ip_address: string | null;
    created_at: string;
}

export interface SystemAuditLog {
    id: string;
    user_id: string | null;
    staff_id: string | null;
    device_id: string | null;
    action_type: string;
    table_name: string;
    record_id: string | null;
    old_data: any | null;
    new_data: any | null;
    reason: string | null;
    created_at: string;
    client_ip: string | null;
    user_agent: string | null;

    // joined fields
    staff_profile?: StaffMaster;
    device?: Device;
}

export interface FinancialYear {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    is_closed: boolean;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

// Phase 3: Enterprise Identity & Org
export interface StaffMaster {
    id: string;
    staff_code: string;
    full_name: string;
    photo_url: string | null;
    gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
    dob: string | null;
    blood_group: string | null;
    marital_status: 'SINGLE' | 'MARRIED' | 'DIVORCED' | 'WIDOWED' | null;
    primary_mobile: string;
    secondary_mobile: string | null;
    email: string | null;
    permanent_address: string | null;
    current_address: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
    department: string | null;
    department_id: string | null;
    reporting_manager_id: string | null;
    doj: string | null;
    employment_type: 'PERMANENT' | 'CONTRACT' | 'INTERN' | 'PART_TIME' | null;
    shift_group_id: string | null; // Unified Shift Group link
    basic_pay: number | null; // Added field
    status: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED' | 'RESIGNED';
    offer_letter_collected: boolean;
    id_proof_collected: boolean;
    address_proof_collected: boolean;
    agreement_signed: boolean;
    bg_check_completed: boolean;
    created_by: string | null;
    updated_by: string | null;
    is_active: boolean;
    is_deleted: boolean;
    allow_session_posting_override?: boolean;
    created_at: string;
    updated_at: string;

    // Joined Relationships
    salary_info?: StaffSalary;
    audit_logs?: StaffAuditLog[];
    exit_cases?: ExitCase[];
    shift_group?: ShiftGroup;
}

export interface StaffSalary {
    id: string;
    staff_id: string;
    basic_salary: number;
    commission_rate: number;
    bonus_eligible: boolean;
    bank_name: string | null;
    account_number: string | null;
    ifsc_code: string | null;
    upi_id: string | null;
    pan_number: string | null;
    aadhaar_number: string | null;
    created_at: string;
    updated_at: string;
}

export interface StaffAuditLog {
    id: string;
    staff_id: string;
    changed_by: string | null;
    action: string;
    old_data: any | null;
    new_data: any | null;
    reason: string | null;
    created_at: string;
}

export interface UserProfile {
    id: string; // auth.users.id
    staff_id: string | null;
    is_super_admin: boolean;
    created_at: string;
    staff?: StaffMaster;
}

// ================================================================
// ATTENDANCE & SHIFT MODELS
// ================================================================

export interface ShiftGroup {
    id: string;
    name: string;
    start_time: string; // "HH:mm"
    end_time: string;   // "HH:mm"
    break_duration_minutes: number;
    grace_in_minutes: number;
    grace_out_minutes: number;
    min_hours_present: number;
    min_hours_half_day: number;
    boundary_start_time: string;
    weekly_off: number[];
    penalty_per_minute: number;
    max_monthly_penalty_pct: number;
    is_active: boolean;
    created_at?: string;
    updated_at?: string;
}

export type ShiftSource = 'BASE' | 'ROSTER' | 'OVERRIDE';
export type IncidentState = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'REVOKED';
export type AttendanceIncidentType = 'LATE' | 'EARLY_OUT' | 'MISS_PUNCH' | 'ABSENT_COVER' | 'OT_APPROVAL' | 'GENERIC_EXCEPTION';
export type AttendanceCorrectionType = 'MISSING_PUNCH' | 'STATUS_DISPUTE' | 'SHIFT_CORRECTION' | 'PENALTY_WAIVER' | 'OTHER';
export type AttendanceCorrectionState = 'DRAFT' | 'SUBMITTED' | 'MANAGER_REVIEW' | 'HR_REVIEW' | 'APPROVED' | 'REJECTED' | 'APPLIED' | 'LOCKED';

export type MonthlySnapshotStatus = 'DRAFT' | 'REVIEW_PENDING' | 'LOCKED' | 'EXPORTED';

export interface AttendanceMonthlySnapshot {
    id: string;
    staff_id: string;
    year: number;
    month: number;
    total_payable_days: number;
    total_worked_hours: number;
    total_late_minutes: number;
    total_early_out_minutes: number;
    total_overtime_minutes: number;
    total_penalty_amount: number;
    count_present: number;
    count_half_day: number;
    count_absent: number;
    count_leave: number;
    count_holiday: number;
    status: MonthlySnapshotStatus;
    compute_version: string;
    computed_at: string;
    locked_at?: string;
    locked_by?: string;
    is_locked: boolean;
    checksum?: string;
    staff?: StaffMaster;
}

export interface AttendancePayrollExport {
    id: string;
    batch_name: string;
    year: number;
    month: number;
    export_type: string;
    staff_count: number;
    total_payable_sum: number;
    created_at: string;
    exported_at?: string;
    exported_by?: string;
    checksum?: string;
}

export type AttendanceAdjustmentType = 'PAYABLE_DAYS' | 'PENALTY' | 'OVERTIME';

export interface AttendanceDeltaAdjustment {
    id: string;
    staff_id: string;
    target_year: number;
    target_month: number;
    adjustment_type: AttendanceAdjustmentType;
    delta_value: number;
    reason: string;
    applied_in_year: number;
    applied_in_month: number;
    is_processed: boolean;
    created_at: string;
    created_by?: string;
    processed_at?: string;
    staff?: StaffMaster;
}

export interface PayrollReconciliation {
    full_name: string;
    staff_code: string;
    year: number;
    month: number;
    status: MonthlySnapshotStatus;
    snapshot_payable_days: number;
    live_payable_days: number;
    payable_drift: number;
    snapshot_penalty: number;
    live_penalty: number;
    pending_corrections_count: number;
    unresolved_anomalies_count: number;
    recon_status: 'DRIFT_DETECTED' | 'PENDING_WORKFLOW' | 'UNRESOLVED_ANOMALIES' | 'RECONCILED';
}

export interface ShiftAssignment {
    id: string;
    staff_id: string;
    shift_group_id: string;
    source: ShiftSource;
    effective_from: string; // YYYY-MM-DD
    effective_to?: string | null; // YYYY-MM-DD
    status: 'DRAFT' | 'PUBLISHED' | 'LOCKED';
    reason?: string | null;
    created_by?: string | null;
    created_at?: string;
    updated_at?: string;
    shift_group?: ShiftGroup;
}

export interface AttendanceRecord {
    id: string;
    staff_id: string;
    attendance_date: string; // YYYY-MM-DD
    punch_in: string | null;
    lunch_out: string | null;
    lunch_in: string | null;
    break_start: string | null;
    break_end: string | null;
    punch_out: string | null;
    status: 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY' | 'LATE_PRESENT' | 'EARLY_OUT' | 'MISS_PUNCH' | 'ON_DUTY';
    primary_status: string; // New deterministic field
    worked_minutes_gross: number;
    worked_minutes_net: number;
    late_minutes: number;
    early_out_minutes: number;
    shift_id: string | null;
    assignment_id: string | null;
    anomaly_flags: string[];
    is_verified: boolean;
    verified_by: string | null;
    notes: string | null;
    applied_incident_id: string | null;
    excused_late_minutes: number;
    excused_early_out_minutes: number;
    impact_metadata?: any;
    applied_correction_id: string | null;
    has_pending_correction: boolean;
    correction_metadata: any;
    is_locked: boolean;
    payable_fraction: number;
    penalty_amount: number;
    overtime_approved_minutes: number;

    // Operational Audit Fields
    raw_punch_in: string | null;
    raw_punch_out: string | null;
    override_punch_in?: string | null;
    override_punch_out?: string | null;
    correction_reason?: string | null;

    created_at?: string;
    updated_at?: string;
    // Joined / RPC Fields
    staff?: StaffMaster;
    incident?: AttendanceIncident;
    correction?: AttendanceCorrection;
    conflict_flag?: boolean;
    holiday_name?: string;
    leave_request_id?: string;
}

export interface AttendanceIncident {
    id: string;
    staff_id: string;
    attendance_date: string;
    incident_type: AttendanceIncidentType;
    status: IncidentState;
    staff_reason: string | null;
    impact_data: any;
    resolved_by: string | null;
    resolved_at: string | null;
    resolution_reason: string | null;
    created_at: string;
    updated_at: string;
}

export interface AttendanceCorrection {
    id: string;
    staff_id: string;
    attendance_date: string;
    type: AttendanceCorrectionType;
    status: AttendanceCorrectionState;
    reason: string;
    evidence_metadata: any;
    proposed_impact: any;
    manager_id?: string;
    manager_reason?: string;
    manager_resolved_at?: string;
    hr_id?: string;
    hr_reason?: string;
    hr_resolved_at?: string;
    applied_at?: string;
    applied_by?: string;
    created_at: string;
    updated_at: string;
}

export interface Role {
    id: string;
    role_name: string;
    description: string | null;
    permissions: Record<string, any>; // Module-Action matrix
    duties?: { id: string, text: string }[];
    category: 'ADMIN' | 'JOB';
    is_system: boolean;
    created_at: string;
    updated_at: string;
}

export interface DeviceDepartment {
    id: string;
    name: string;
    is_active: boolean;
    is_default: boolean;
    eligible_for_session_posting?: boolean;
    created_at: string;
    updated_at: string;
}

export interface UserOrgAccess {
    id: string;
    user_id: string;
    role_id: string;
    scope_type: 'GLOBAL';
    scope_id: string | null;
    is_active: boolean;
    created_at: string;
}

export interface Device {
    id: string;
    device_name: string;
    device_fingerprint: string;
    is_authorized: boolean;
    last_seen: string | null;
    user_id?: string | null;
    email?: string | null;
    department_id?: string | null;
    created_at: string;
    permissions?: Record<string, string[]> | null;
    department?: DeviceDepartment | null;
}

export interface Department {
    id: string;
    dept_code: string;
    dept_name: string;
    description: string | null;
    head_name: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface ApprovalRequest {
    id: string;
    request_type: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    payload: any;
    reason: string | null;
    requested_by: string;
    target_scope_id: string | null;
    approved_by: string | null;
    decision_reason: string | null;
    created_at: string;
    closed_at: string | null;

    // View Joined Fields
    requested_by_name?: string;
    approved_by_name?: string;
}

export interface SystemConfiguration {
    id: string;
    current_financial_year_id: string | null;
    allow_backdated_posting: boolean;
    backdate_limit_days: number;
    allow_cross_fy_reports: boolean;
    updated_at: string;

    // Joined fields
    current_fy?: FinancialYear;

    // Business Profile (Persisted in system_configurations)
    business_name?: string;
    business_address?: string;
    business_gstin?: string;
    business_phone?: string;
    business_email?: string;
    customer_id_prefix?: string;
    customer_id_start_number?: number;
    enable_txn_approvals?: boolean;

    // System Date Override
    business_date?: string | null;
    business_logo_url?: string | null;
    timezone?: string;
}

export interface SystemDateLog {
    id: string;
    old_date: string | null;
    new_date: string | null;
    changed_by: string;
    reason: string | null;
    action: 'SET' | 'CLEAR';
    changed_at: string;
}

export interface VoucherAttachment {
    id: string;
    voucher_id: string;
    file_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
    uploaded_by: string | null;
    uploaded_at: string;
}

// ================================================================
// UI STATE MODELS
// ================================================================

export interface VoucherLineInput {
    id: string;
    line_number: number;
    ledger_id: string;
    ledger_name?: string;
    party_id: string | null;
    party_name?: string;
    side: Side;
    amount: number | null;
    line_narration: string;
    external_ref: string;
    is_fixed_side?: boolean;
    is_side_manual?: boolean;
    is_from_template?: boolean;
    quantity?: number;
    uom_id?: string;
    rate?: number;
    valuation_ref?: string;
    ledger_allow_party?: boolean;
    ledger_is_cash?: boolean;
    ledger_is_bank?: boolean;
    is_credit_settlement?: boolean;
    is_discount_settlement?: boolean;
    is_round_off_settlement?: boolean;
}

export interface VoucherFormData {
    ui_key: string; // Unique transient key for React reconciliation
    draft_id?: string | null; // ID of the draft this voucher was loaded from
    updated_at?: string; // For optimistic locking
    voucher_type_id: string;
    voucher_type_name?: string; // For UI labeling in sessions
    voucher_date: string;
    narration: string;
    reference_no: string;
    party_id: string | null;
    template_id: string | null;
    lines: VoucherLineInput[];
    status?: VoucherStatus;
    bank_status?: BankStatus;
    approval_status?: ApprovalStatus;
}

export interface SessionFormData {
    party_id: string | null;
    session_date: string;
    narration: string;
    session_ref: string;
    vouchers: VoucherFormData[];
    audit_exception_reason?: string | null;
}

// ================================================================
// VALIDATION RESULT
// ================================================================

export interface ValidationError {
    field: string;
    message: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
}

// ================================================================
// BANK EXPORT MODELS
// ================================================================

export interface ReferencePrefix {
    id: string;
    prefix: string;
    description: string | null;
    is_active: boolean;
    is_default: boolean;
    created_at: string;
    updated_at: string;
}

export interface ReferenceCounter {
    id: string;
    prefix_id: string;
    counter_date: string;
    last_number: number;
    updated_at: string;
}

export interface BankTxnExport {
    id: string;
    voucher_ids: string[];
    prefix_id: string;
    reference_no: string;
    file_name: string;
    sender_bank_account_id: string;
    payment_method: 'NEFT' | 'IMPS' | 'RTGS' | 'SIB';
    payload_json: any;
    generated_by: string | null;
    generated_at: string;

    // Joined fields
    prefix?: ReferencePrefix;
    sender_bank?: Ledger;
}

// ================================================================
// REPORT MODELS
// ================================================================

export interface LedgerStatementRow {
    date: string;
    voucher_no: string;
    narration: string;
    debit: number;
    credit: number;
    balance: number;
    balance_side: Side;
    quantity?: number | null;
    uom_code?: string | null;
    // Enterprise enhancements
    party_name?: string | null;
    customer_id?: string | null;
    ledger_name?: string | null;
    ledger_nature?: AccountNature | null;
    is_opening?: boolean;
    is_reversed?: boolean;
    reversed_voucher_id?: string | null;
    effect_direction?: 'increase' | 'decrease' | 'neutral';
    quantity_balance?: number | null;
}

export interface TrialBalanceRow {
    node_id: string;
    node_name: string;
    node_type: 'GROUP' | 'LEDGER';
    nature: AccountNature;
    parent_id: string | null;
    depth: number;
    opening_dr: number;
    opening_cr: number;
    period_dr: number;
    period_cr: number;
    closing_dr: number;
    closing_cr: number;
    is_leaf: boolean;
    allow_party: boolean;
    sub_ledger_total: number;
    reconciliation_gap: number;
}

export interface ProfitLossRow {
    head: string;
    amount: number;
    type: 'INCOME' | 'EXPENSE';
}

export interface BalanceSheetRow {
    head: string;
    amount: number;
    type: 'ASSET' | 'LIABILITY' | 'EQUITY';
}

export interface DayBookRow {
    voucher_id: string;
    voucher_no: string;
    date: string;
    voucher_type: string;
    narration: string;
    total_amount: number;
    status: VoucherStatus;
}

// ================================================================
// LEAVE MANAGEMENT MODELS
// ================================================================

export interface LeavePolicy {
    id: string;
    annual_paid_days: number;
    annual_unpaid_days: number;
    monthly_paid_cap: number;
    cap_type: 'SOFT' | 'HARD';
    half_day_allowed: boolean;
    penalty_slab1_limit: number;
    penalty_slab1_mult: number;
    penalty_slab2_limit: number;
    penalty_slab2_mult: number;
    penalty_slab3_mult: number;
    incentive_enabled: boolean;
    incentive_full_limit: number;
    incentive_half_limit: number;
    incentive_type: 'BONUS' | 'EXTRA_LEAVES' | 'FESTIVAL';
    incentive_bonus_amount: number;

    // Penalties
    unpaid_buffer_days: number;
    penalty_slabs: any;

    // Operational Rules
    same_day_rule: 'AUTO_UPL' | 'REQUIRE_APPROVAL';
    consecutive_limit: number;

    // Cancellation & Reversal Rules
    cancel_future_days_notice: number;
    cancel_same_day_allowed: boolean;
    revoke_past_allowed: boolean;
    payroll_lock_protection: boolean;

    effective_from: string;
    effective_to: string | null;
    status: 'ACTIVE' | 'INACTIVE';

    // Audit
    created_at?: string;
    updated_at?: string;
}

export interface LeaveBalance {
    id: string;
    staff_id: string;
    year: number;
    paid_balance: number;
    unpaid_balance: number;
    penalty_count: number;
    total_leaves_taken: number;
    incentive_status: 'ELIGIBLE' | 'HALF' | 'NOT_ELIGIBLE' | 'NOT_EVALUATED';
    updated_at: string;
    // Joined
    staff?: StaffMaster;
}

export interface LeaveRequest {
    id: string;
    staff_id: string;
    from_date: string;
    to_date: string;
    days_count: number;
    start_day_type?: 'FULL' | 'HALF';
    end_day_type?: 'FULL' | 'HALF';
    leave_type: 'PAID' | 'UNPAID' | 'PENALTY';
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'TAKEN' | 'LAPSED' | 'REVOKED';
    approved_by?: string;
    approved_at?: string;
    created_at?: string;
    updated_at?: string;
    // Joined
    staff?: StaffMaster;
    days?: LeaveDay[];
}

export interface LeaveDay {
    id: string;
    request_id: string;
    staff_id: string;
    leave_date: string;
    day_count: number;
    allocation_type: 'PAID' | 'UNPAID' | 'PENALTY';
    deduction_multiplier: number;
    policy_version_id: string;
    payroll_locked: boolean;
    created_at: string;
}

export interface LeaveMonthlyTracking {
    id: string;
    staff_id: string;
    year: number;
    month: number;
    paid_used: number;
    updated_at: string;
}

// ================================================================
// UTILITY TYPES
// ================================================================

export interface SelectOption {
    value: string;
    label: string;
}

export interface Toast {
    id: string;
    type: 'success' | 'error' | 'warning' | 'info';
    message: string;
    duration?: number;
}

// ================================================================
// RELIEVING & EXIT MANAGEMENT MODELS
// ================================================================

export interface ExitPolicy {
    id: string;
    notice_period_days: number;
    allow_withdrawal: boolean;
    withdrawal_cutoff_days: number;
    encash_leave_enabled: boolean;
    encash_leave_max_days: number;
    absconding_unpaid_rule: boolean;
    effective_from: string;
    effective_to: string | null;
    status: 'ACTIVE' | 'INACTIVE';
    created_at?: string;
}

export type ExitType = 'RESIGNATION' | 'TERMINATION' | 'ABSCONDING' | 'CONTRACT_END' | 'DEATH' | 'TRANSFER';
export type ExitCaseStatus = 'INITIATED' | 'MANAGER_APPROVED' | 'EXIT_SCHEDULED' | 'CLEARANCE_IN_PROGRESS' | 'CLOSED';
export type ClearanceCategory = 'ASSETS' | 'SECURITY' | 'MONEY' | 'HANDOVER' | 'OTHER';
export type ClearanceOwnerRole = 'MANAGER' | 'HR' | 'FINANCE' | 'IT';
export type ClearanceTaskStatus = 'PENDING' | 'COMPLETED' | 'NOT_APPLICABLE';
export type SettlementStatus = 'DRAFT' | 'APPROVED' | 'PAID';

export interface ExitCase {
    id: string;
    staff_id: string;
    exit_type: ExitType;
    reason_category?: string;
    notes?: string;

    initiated_date: string;
    proposed_lwd?: string;
    final_lwd?: string;

    status: ExitCaseStatus;

    manager_id?: string;
    hr_admin_id?: string;

    is_withdrawn: boolean;
    payroll_locked: boolean;

    created_at?: string;
    updated_at?: string;

    // Joined
    staff?: StaffMaster;
}

export interface ExitChecklistTemplate {
    id: string;
    name: string;
    description?: string;
    created_at?: string;
}

export interface ExitChecklistItem {
    id: string;
    template_id: string;
    category: ClearanceCategory;
    task_name: string;
    owner_role: ClearanceOwnerRole;
    created_at?: string;
}

export interface ExitClearanceTask {
    id: string;
    exit_case_id: string;
    category: ClearanceCategory;
    task_name: string;
    owner_role: ClearanceOwnerRole;

    status: ClearanceTaskStatus;
    completed_by?: string;
    remarks?: string;

    created_at?: string;
    updated_at?: string;
}

export interface ExitFnfSettlement {
    id: string;
    exit_case_id: string;

    earnings_total: number;
    leave_encashment_total: number;
    deductions_total: number;
    net_payable: number;

    status: SettlementStatus;

    approved_by?: string;
    paid_by?: string;
    paid_date?: string;

    remarks?: string;

    created_at?: string;
    updated_at?: string;
}

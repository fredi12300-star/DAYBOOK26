import { createClient } from '@supabase/supabase-js';
import {
    Ledger, LedgerTag, Voucher, VoucherType, VoucherGroup,
    Template, TemplateGroup, Party, PartyGroup,
    TransactionSession, SessionFormData, UOM,
    FinancialYear, SystemConfiguration, SystemDateLog, BankStatus, ApprovalStatus, ReferencePrefix, BankTxnExport,
    StaffMaster, Role, UserOrgAccess, ApprovalRequest, Device, DeviceDepartment,
    AccountNature, Side, TrialBalanceRow,
    LeavePolicy, LeaveBalance, LeaveRequest,
    ExitPolicy, ExitCase, ExitChecklistTemplate, ExitChecklistItem, ExitClearanceTask, ExitFnfSettlement,
    ShiftGroup, AttendanceRecord, ShiftAssignment, ShiftSource,
    AttendanceIncidentType, IncidentState,
    AttendanceCorrectionType, AttendanceCorrection,
    AttendanceMonthlySnapshot, AttendanceDeltaAdjustment, PayrollReconciliation,
    VoucherLine, BankStatementItem, ReconcileLock
} from '../types/accounting';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Robust retry helper for transient network/Supabase errors
 */
export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
    try {
        return await fn();
    } catch (error: any) {
        if (retries <= 0) throw error;

        // Retry on network errors or transient Supabase errors
        const isNetworkError = error instanceof TypeError || (error.message && error.message.toLowerCase().includes('fetch'));

        // PGRST116: maybeSingle() found no rows (transient in some high-concurrency cases)
        // 5xx: Server/Supabase outage
        // 429: Rate limit
        // We EXCLUDE 42xxx (syntax/schema) and P0001 (custom business logic raised exception)
        const isPermanentDBError = error.code && (error.code.startsWith('42') || error.code === 'P0001');
        const isTransientError = !isPermanentDBError && (error.code === 'PGRST116' || !error.status || error.status >= 500 || error.status === 429);

        if (isNetworkError || isTransientError) {
            console.warn(`Transient error detected, retrying in ${delay}ms... (${retries} left)`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
            return withRetry(fn, retries - 1, delay * 2);
        }
        throw error;
    }
}

// ================================================================
// UOM OPERATIONS
// ================================================================

export async function fetchUOMs(activeOnly = true) {
    return withRetry(async () => {
        let query = supabase
            .from('uoms')
            .select('*')
            .order('name');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as UOM[];
    });
}

// ================================================================
// LEDGER & GROUP OPERATIONS
// ================================================================

export async function fetchLedgerGroups() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('ledger_groups')
            .select('*')
            .order('group_name');
        if (error) throw error;
        return data as any[];
    });
}

export async function fetchLedgers(activeOnly = true) {
    return withRetry(async () => {
        let query = supabase
            .from('ledgers')
            .select('*, ledger_group:ledger_groups(*), default_uom:uoms(*)')
            .order('ledger_name');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as Ledger[];
    });
}

export async function upsertLedger(ledger: Partial<Ledger>) {
    const cleanedLedger = { ...ledger };

    // Comprehensive field cleanup to avoid database errors/constraints
    const transientFields = [
        'ledger_group',
        'default_uom',
        'group',
        'rapid_templates',
        'lines',
        'created_at' // Primary DB defaults should handle this
    ];
    transientFields.forEach(f => delete (cleanedLedger as any)[f]);

    const { data, error } = await supabase
        .from('ledgers')
        .upsert({
            ...cleanedLedger,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) {
        console.error('[Supabase] upsertLedger Error:', error);
        throw error;
    }
    return data as Ledger;
}

// ================================================================
// LEDGER TAG OPERATIONS (NEW)
// ================================================================

export async function fetchLedgerTags(activeOnly = true) {
    return withRetry(async () => {
        let query = supabase
            .from('ledger_tags')
            .select('*')
            .order('tag_name');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as LedgerTag[];
    });
}

export async function upsertLedgerTag(tag: Partial<LedgerTag>) {
    const { data, error } = await supabase
        .from('ledger_tags')
        .upsert({
            ...tag,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as LedgerTag;
}

export async function deleteLedgerTag(id: string) {
    // Note: This won't automatically remove the ID from ledgers.business_tags array
    // We should probably clean up the arrays in ledgers table too.
    const { error: _cleanupError } = await supabase.rpc('remove_ledger_tag_from_all', { tag_id: id });
    // If RPC doesn't exist, we can do it via a simple query if needed, 
    // but for now let's just delete the tag.

    const { error } = await supabase
        .from('ledger_tags')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

export async function deleteLedger(id: string) {
    return withRetry(async () => {
        // First check if it's a system ledger
        const { data: ledger, error: checkError } = await supabase
            .from('ledgers')
            .select('is_system')
            .eq('id', id)
            .single();

        if (checkError) throw checkError;
        if (ledger?.is_system) {
            throw new Error('System-critical ledgers cannot be deleted.');
        }

        const { error } = await supabase
            .from('ledgers')
            .delete()
            .eq('id', id);
        if (error) throw error;
        return true;
    });
}

export async function deleteVoucher(id: string) {
    const { error } = await supabase
        .from('vouchers')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

export async function fetchLedgerById(id: string): Promise<Ledger> {
    const { data, error } = await supabase
        .from('ledgers')
        .select('*, group:ledger_groups(*), default_uom:uoms(*)')
        .eq('id', id)
        .single();

    if (error) throw error;
    return data as Ledger;
}

// ================================================================
// VOUCHER TYPE OPERATIONS
// ================================================================

export async function fetchVoucherTypes() {
    const { data, error } = await supabase
        .from('voucher_types')
        .select('*, group:voucher_groups(*)')
        .eq('is_active', true)
        .order('type_name');

    if (error) throw error;
    return data as VoucherType[];
}

// ================================================================
// VOUCHER GROUP OPERATIONS
// ================================================================

export async function fetchVoucherGroups(activeOnly = true) {
    let query = supabase
        .from('voucher_groups')
        .select('*')
        .order('group_name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as VoucherGroup[];
}

export async function upsertVoucherGroup(group: Partial<VoucherGroup>) {
    const { data, error } = await supabase
        .from('voucher_groups')
        .upsert({
            ...group,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as VoucherGroup;
}

export async function deleteVoucherGroup(id: string) {
    const { error } = await supabase
        .from('voucher_groups')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

export async function reassignVoucherTypes(fromGroupId: string, toGroupId: string | null) {
    const { error } = await supabase
        .from('voucher_types')
        .update({ group_id: toGroupId })
        .eq('group_id', fromGroupId);

    if (error) throw error;
    return true;
}

export async function upsertVoucherType(voucherType: Partial<VoucherType>) {
    const cleanedType = { ...voucherType };
    delete (cleanedType as any).group;

    const { data, error } = await supabase
        .from('voucher_types')
        .upsert(cleanedType)
        .select()
        .single();

    if (error) throw error;

    // Initialize sequence if it's a new voucher type
    if (!voucherType.id && data.id) {
        await supabase
            .from('voucher_sequences')
            .insert({
                voucher_type_id: data.id,
                next_number: 1
            });
    }

    return data as VoucherType;
}

export async function deleteVoucherType(id: string) {
    const { error } = await supabase
        .from('voucher_types')
        .delete()
        .eq('id', id);

    if (error) throw error;
    return true;
}

// ================================================================
// TEMPLATE GROUP OPERATIONS
// ================================================================

export async function fetchTemplateGroups(activeOnly = true) {
    let query = supabase
        .from('template_groups')
        .select('*')
        .order('group_name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as TemplateGroup[];
}

export async function upsertTemplateGroup(group: Partial<TemplateGroup>) {
    const { data, error } = await supabase
        .from('template_groups')
        .upsert({
            ...group,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as TemplateGroup;
}

export async function deleteTemplateGroup(id: string) {
    const { error } = await supabase
        .from('template_groups')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

export async function reassignTemplates(fromGroupId: string, toGroupId: string | null) {
    const { error } = await supabase
        .from('rapid_templates')
        .update({ group_id: toGroupId })
        .eq('group_id', fromGroupId);

    if (error) throw error;
    return true;
}

// ================================================================
// TEMPLATE OPERATIONS
// ================================================================

export async function fetchTemplatesByVoucherType(voucherTypeId: string) {
    const { data, error } = await supabase
        .from('rapid_templates')
        .select(`
      *,
      voucher_type:voucher_types!voucher_type_id(*),
      group:template_groups(*),
      lines:template_lines(
        *,
        ledger:ledgers(*)
      )
    `)
        .eq('voucher_type_id', voucherTypeId)
        .eq('is_active', true)
        .order('template_name');

    if (error) throw error;
    return data as Template[];
}

export async function fetchAllTemplates(activeOnly = true) {
    let query = supabase
        .from('rapid_templates')
        .select(`
      *,
      voucher_type:voucher_types!voucher_type_id(*),
      group:template_groups(*),
      lines:template_lines(
        *,
        ledger:ledgers(*)
      )
    `)
        .order('template_name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as Template[];
}

export async function fetchTemplateById(id: string) {
    const { data, error } = await supabase
        .from('rapid_templates')
        .select(`
      *,
      voucher_type:voucher_types!voucher_type_id(*),
      group:template_groups(*),
      lines:template_lines(
        *,
        ledger:ledgers(*)
      )
    `)
        .eq('id', id)
        .single();

    if (error) throw error;
    return data as Template;
}

// ================================================================
// PARTY GROUP OPERATIONS
// ================================================================

export async function fetchPartyGroups(activeOnly = true) {
    let query = supabase
        .from('party_groups')
        .select('*')
        .order('group_name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as PartyGroup[];
}

export async function upsertPartyGroup(group: Partial<PartyGroup>) {
    const { data, error } = await supabase
        .from('party_groups')
        .upsert({
            ...group,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as PartyGroup;
}

export async function deletePartyGroup(id: string) {
    const { error } = await supabase
        .from('party_groups')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

export async function reassignParties(fromGroupId: string, toGroupId: string | null) {
    const { error } = await supabase
        .from('parties')
        .update({ group_id: toGroupId })
        .eq('group_id', fromGroupId);

    if (error) throw error;
    return true;
}

// ================================================================
// PARTY OPERATIONS
// ================================================================

export async function fetchParties(activeOnly = true) {
    let query = supabase
        .from('parties')
        .select('*, group:party_groups(*)')
        .order('party_name');

    if (activeOnly) {
        query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as Party[];
}

export async function fetchPartyById(id: string) {
    const { data, error } = await supabase
        .from('parties')
        .select(`
            *,
            group:party_groups(*),
            bank_accounts(*)
        `)
        .eq('id', id)
        .single();

    if (error) throw error;
    return data as Party;
}

/**
 * Batch fetch parties with their bank accounts
 */
export async function fetchPartiesWithBank(partyIds: string[]) {
    if (partyIds.length === 0) return [];
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('parties')
            .select('*, bank_accounts(*)')
            .in('id', partyIds);
        if (error) throw error;
        return data as Party[];
    });
}

export async function fetchPartiesPaginated(options: {
    searchTerm?: string;
    type?: string;
    groupId?: string;
    smartFilters?: {
        whatsapp?: boolean;
        gstin?: boolean;
        active?: boolean;
        withBank?: boolean;
    };
    page?: number;
    pageSize?: number;
}) {
    const { searchTerm, type, groupId, smartFilters, page = 0, pageSize = 50 } = options;

    // Summary mode: only essential fields for the list
    let query = supabase
        .from('parties')
        .select('id, party_name, party_type, phone, phone_country_code, whatsapp_active, customer_id, gstin, is_active, group_id, group:party_groups(group_name)', { count: 'exact' });

    if (searchTerm) {
        const pattern = `%${searchTerm}%`;
        query = query.or(`party_name.ilike."${pattern}",phone.ilike."${pattern}",customer_id.ilike."${pattern}",gstin.ilike."${pattern}"`);
    }

    if (type && type !== 'ALL') {
        query = query.eq('party_type', type);
    }

    if (groupId) {
        query = query.eq('group_id', groupId);
    }

    if (smartFilters) {
        if (smartFilters.whatsapp) query = query.eq('whatsapp_active', true);
        if (smartFilters.gstin) query = query.not('gstin', 'is', null).neq('gstin', '');
        if (smartFilters.active !== undefined) query = query.eq('is_active', smartFilters.active);
        // Note: withBank requires a complex join or subquery if bank_accounts is another table, 
        // but since it's a JSON/array likely, we skip it for performance if it lags.
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await query
        .order('party_name')
        .range(from, to);

    if (error) throw error;

    return {
        data: data as unknown as Party[],
        totalCount: count || 0,
        hasMore: (data?.length || 0) === pageSize
    };
}

export async function getPartyStats() {
    const [
        { count: all },
        { count: customers },
        { count: vendors },
        { count: dual }
    ] = await Promise.all([
        supabase.from('parties').select('*', { count: 'exact', head: true }),
        supabase.from('parties').select('*', { count: 'exact', head: true }).eq('party_type', 'CUSTOMER'),
        supabase.from('parties').select('*', { count: 'exact', head: true }).eq('party_type', 'VENDOR'),
        supabase.from('parties').select('*', { count: 'exact', head: true }).eq('party_type', 'BOTH'),
    ]);

    const { data: groups, error: groupsError } = await supabase
        .from('party_groups')
        .select('id, group_name');

    if (groupsError) throw groupsError;

    // For group counts, we do it in one go if possible or secondary fetches
    // To keep it simple and avoid RPC, we'll just return the base stats first.
    return {
        all: all || 0,
        customers: customers || 0,
        vendors: vendors || 0,
        dual: dual || 0,
        groups: groups || []
    };
}

export async function searchLedgers(searchTerm: string, limit = 50) {
    let query = supabase
        .from('ledgers')
        .select('*, ledger_group:ledger_groups(*), default_uom:uoms(*)')
        .eq('is_active', true)
        .order('ledger_name');

    if (searchTerm) {
        query = query.ilike('ledger_name', `%${searchTerm}%`);
    }

    const { data, error } = await query.limit(limit);
    if (error) throw error;
    return data as Ledger[];
}

export async function searchParties(searchTerm: string, limit = 50) {
    let query = supabase
        .from('parties')
        .select('*')
        .eq('is_active', true)
        .order('party_name');

    if (searchTerm) {
        const pattern = `%${searchTerm}%`;
        query = query.or(`party_name.ilike."${pattern}",phone.ilike."${pattern}",contact_person.ilike."${pattern}",gstin.ilike."${pattern}"`);
    }

    const { data, error } = await query.limit(limit);
    if (error) throw error;
    return data as Party[];
}

export async function upsertParty(party: Partial<Party>) {
    // Clean up empty strings for database compatibility (avoid "invalid input syntax for type date")
    const cleanedParty = { ...party };
    // Rule: Enforce Uppercase for Party Names
    if (cleanedParty.party_name) {
        cleanedParty.party_name = cleanedParty.party_name.toUpperCase();
    }
    if (cleanedParty.dob === '') cleanedParty.dob = null;
    if (cleanedParty.email === '') cleanedParty.email = null;
    if (cleanedParty.customer_id === '') cleanedParty.customer_id = null;
    if (cleanedParty.gstin === '') cleanedParty.gstin = null;
    if (cleanedParty.aadhar_no === '') cleanedParty.aadhar_no = null;
    delete (cleanedParty as any).group;

    // Check for duplicate phone
    if (cleanedParty.phone) {
        let duplicateCheck = supabase
            .from('parties')
            .select('id, party_name')
            .eq('phone', cleanedParty.phone);

        if (cleanedParty.id) {
            duplicateCheck = duplicateCheck.neq('id', cleanedParty.id);
        }

        const { data: existing } = await duplicateCheck.maybeSingle();

        if (existing) {
            throw new Error(`Phone number ${cleanedParty.phone} is already used by "${existing.party_name}"`);
        }
    }

    const { data: savedParty, error } = await supabase
        .from('parties')
        .upsert(cleanedParty)
        .select()
        .single();
    if (error) throw error;

    // Handle bank accounts if provided in the party object
    if ((party as Party).bank_accounts && (party as Party).bank_accounts!.length > 0) {
        const bankAccounts = (party as Party).bank_accounts!.map(acc => ({
            ...acc,
            party_id: savedParty.id
        }));

        const { error: accError } = await supabase
            .from('bank_accounts')
            .upsert(bankAccounts);

        if (accError) {
            console.error('Error saving bank accounts:', accError);
        }
    }

    return savedParty as Party;
}

/**
 * Updates Opening Balance for a Ledger or Party-Ledger combination.
 * Follows a hybrid approach:
 * 1. If no party: Update ledger.opening_balance
 * 2. If party + primary ledger: Update party.opening_balance
 * 3. Else: Create/Update a special "Opening Voucher" dated 2000-01-01
 */
export async function updateOpeningBalance(
    ledgerId: string,
    partyId: string | null,
    amount: number,
    side: Side
) {
    return withRetry(async () => {
        const { data, error } = await supabase.rpc('update_opening_balance_v1', {
            p_ledger_id: ledgerId,
            p_party_id: toUUID(partyId),
            p_amount: amount,
            p_side: side
        });

        if (error) {
            console.error('update_opening_balance_v1 RPC Error:', error);
            throw error;
        }
        return data as boolean;
    });
}

export async function deleteParty(id: string) {
    const { error } = await supabase
        .from('parties')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

export async function getNextReferenceNumber(date: string) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    const prefix = `OMR${day}${month}${year}`;

    const { data, error } = await supabase
        .from('vouchers')
        .select('reference_no')
        .ilike('reference_no', `${prefix}%`)
        .order('reference_no', { ascending: false })
        .limit(1);

    if (error) throw error;

    let nextSeq = 1;
    if (data && data.length > 0 && data[0].reference_no) {
        const lastRef = data[0].reference_no;
        const lastSeq = parseInt(lastRef.slice(-3));
        if (!isNaN(lastSeq)) {
            nextSeq = lastSeq + 1;
        }
    }

    return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export async function getNextCustomerId() {
    // 1. Fetch sequence settings from system_configurations
    const { data: config, error: configError } = await supabase
        .from('system_configurations')
        .select('customer_id_prefix, customer_id_start_number')
        .single();

    if (configError) {
        console.error('Error fetching ID config:', configError);
    }

    const prefix = config?.customer_id_prefix || 'CU';
    const startNum = config?.customer_id_start_number || 1;

    // 2. Find the highest existing ID with this prefix
    const { data, error } = await supabase
        .from('parties')
        .select('customer_id')
        .ilike('customer_id', `${prefix}%`)
        .order('customer_id', { ascending: false })
        .limit(1);

    if (error) throw error;

    let nextSeq = startNum;
    if (data && data.length > 0 && data[0].customer_id) {
        const lastRef = data[0].customer_id;
        // Extract numeric part by removing the prefix
        const lastSeq = parseInt(lastRef.substring(prefix.length));
        if (!isNaN(lastSeq)) {
            nextSeq = lastSeq + 1;
        }
    }

    // Dynamic padding: Use at least 4 digits, or more if the sequence is larger
    const padding = Math.max(4, String(nextSeq).length);
    return `${prefix}${String(nextSeq).padStart(padding, '0')}`;
}

// ================================================================
// VOUCHER OPERATIONS
// ================================================================

export async function fetchVouchers(filters?: {
    startDate?: string;
    endDate?: string;
    voucherTypeId?: string;
    status?: string;
    search?: string;
}) {
    let query = supabase
        .from('vouchers')
        .select(`
      *,
      voucher_type:voucher_types!voucher_type_id(*),
      party:parties(*),
      lines:voucher_lines(
        *,
        ledger:ledgers(*),
        party:parties(*)
      )
    `)
        .order('voucher_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (filters?.startDate) {
        query = query.gte('voucher_date', filters.startDate);
    }
    if (filters?.endDate) {
        query = query.lte('voucher_date', filters.endDate);
    }
    if (filters?.voucherTypeId) {
        query = query.eq('voucher_type_id', filters.voucherTypeId);
    }
    if (filters?.status) {
        query = query.eq('status', filters.status);
    }
    if (filters?.search) {
        query = query.or(`voucher_no.ilike.%${filters.search}%,reference_no.ilike.%${filters.search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as Voucher[];
}

/**
 * High-performance compact fetch for vouchers (no nested lines)
 */
export async function fetchVouchersCompact(queryBuilder: (query: any) => any) {
    return withRetry(async () => {
        let query = supabase
            .from('vouchers')
            .select(`
                id,
                voucher_no,
                voucher_date,
                total_debit,
                total_credit,
                narration,
                status,
                bank_status,
                approval_status,
                bank_validation_status,
                voucher_type_id,
                party_id,
                session_id,
                sender_bank_account_id,
                created_at,
                voucher_type:voucher_types(id, type_code, type_name),
                party:parties(id, party_name, customer_id, phone, bank_accounts(*)),
                session:transaction_sessions(id, session_ref, session_date, created_at)
            `);

        query = queryBuilder(query);

        const { data, error } = await query;
        if (error) throw error;
        return data as unknown as Voucher[];
    });
}

/**
 * Batch fetch voucher lines for a set of vouchers
 */
export async function fetchVoucherLines(voucherIds: string[]) {
    if (voucherIds.length === 0) return [];
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('voucher_lines')
            .select('*, ledger:ledgers(id, ledger_name, is_cash_bank, business_tags, bank_name, bank_account_no, ledger_group:ledger_groups(group_name))')
            .in('voucher_id', voucherIds);
        if (error) throw error;
        return data as any[];
    });
}

export async function fetchVoucherById(id: string) {
    const { data, error } = await supabase
        .from('vouchers')
        .select(`
      *,
      voucher_type:voucher_types(*),
      party:parties(*),
      lines:voucher_lines(
        *,
        ledger:ledgers(*),
        party:parties(*),
        uom:uoms(*)
      )
    `)
        .eq('id', id)
        .single();

    if (error) throw error;
    return data as Voucher;
}

// ================================================================
// CREATE VOUCHER (Complete Transaction)
// ================================================================

// Helper to safely handle UUIDs
export const toUUID = (val?: string | null) => {
    if (!val || val.trim() === '') return null;
    return val;
};

/**
 * Validates a voucher date against Financial Year policies.
 * Returns the FY object if valid, throws an error otherwise.
 */
export async function validateVoucherDate(date: string) {
    const { data: years, error } = await supabase
        .from('financial_years')
        .select('*');

    if (error) throw error;

    const vDate = new Date(date);
    const fy = years.find(y => {
        const start = new Date(y.start_date);
        const end = new Date(y.end_date);
        return vDate >= start && vDate <= end;
    });

    if (!fy) {
        throw new Error(`Date ${date} does not fall within any defined Financial Year.`);
    }

    if (fy.is_closed) {
        throw new Error(`Financial Year ${fy.name} is CLOSED. Posting or editing in a closed year is strictly prohibited. Please post adjustments in the current open year.`);
    }

    // Check system config for active year policy
    const config = await fetchSystemConfig();
    if (config && !config.allow_backdated_posting) {
        if (config.current_financial_year_id !== fy.id) {
            throw new Error(`Backdated posting to ${fy.name} is disabled by system policy. Only ${config.current_fy?.name} is open for entry.`);
        }
    }

    return fy;
}

export async function createVoucher(voucherData: {
    id?: string; // Optional ID for updating existing draft
    voucher_type_id: string;
    template_id?: string | null;
    voucher_date: string;
    narration: string;
    reference_no?: string;
    party_id?: string | null; // Allow null explicitly
    session_id?: string | null;
    lines: {
        ledger_id: string;
        party_id?: string | null;
        side: 'DR' | 'CR';
        amount: number;
        line_narration?: string;
        external_ref?: string;
        quantity?: number;
        uom_id?: string;
        rate?: number;
        valuation_ref?: string;
    }[];
    status?: 'DRAFT' | 'POSTED';
    bank_status?: BankStatus;
    approval_status?: ApprovalStatus;
}) {
    // 1. Audit Policy Check (Frontend)
    if (voucherData.status !== 'DRAFT') {
        await validateVoucherDate(voucherData.voucher_date);
    }

    // 2. Calculate totals
    const totalDebit = voucherData.lines
        .filter(l => l.side === 'DR')
        .reduce((sum, l) => sum + l.amount, 0);

    const totalCredit = voucherData.lines
        .filter(l => l.side === 'CR')
        .reduce((sum, l) => sum + l.amount, 0);

    // 3. Validate Dr = Cr (Skip for Drafts)
    if (voucherData.status !== 'DRAFT' && Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`Debit (${totalDebit}) must equal Credit (${totalCredit})`);
    }

    // 4. Atomic Upsert via RPC
    const { data: voucherId, error: rpcError } = await supabase.rpc('save_voucher_v1', {
        p_voucher_id: toUUID(voucherData.id),
        p_voucher_type_id: voucherData.voucher_type_id,
        p_template_id: toUUID(voucherData.template_id),
        p_voucher_date: voucherData.voucher_date,
        p_narration: voucherData.narration,
        p_reference_no: voucherData.reference_no || null,
        p_party_id: toUUID(voucherData.party_id),
        p_session_id: toUUID(voucherData.session_id),
        p_total_debit: totalDebit,
        p_total_credit: totalCredit,
        p_status: voucherData.status || 'DRAFT',
        p_bank_status: voucherData.bank_status || 'NONE',
        p_approval_status: voucherData.approval_status || 'NOT_REQUIRED',
        p_lines: voucherData.lines.map(l => ({
            ...l,
            party_id: toUUID(l.party_id),
            uom_id: toUUID(l.uom_id),
            line_narration: l.line_narration || null,
            external_ref: l.external_ref || null,
            quantity: l.quantity || null,
            rate: l.rate || null,
            valuation_ref: l.valuation_ref || null
        })),
        p_expected_updated_at: (voucherData as any).updated_at || null
    });

    if (rpcError) {
        console.error('save_voucher_v1 RPC Error:', rpcError);
        throw rpcError;
    }

    // 5. Fetch and return the updated voucher
    return await fetchVoucherById(voucherId);
}

// ================================================================
// REVERSE VOUCHER
// ================================================================

export async function reverseVoucher(voucherId: string, reason: string) {
    const { data: reversalId, error: rpcError } = await supabase.rpc('reverse_voucher_v1', {
        p_voucher_id: voucherId,
        p_reason: reason
    });

    if (rpcError) {
        console.error('reverse_voucher_v1 RPC Error:', rpcError);
        throw rpcError;
    }

    return await fetchVoucherById(reversalId);
}

// ================================================================
// LEDGER STATEMENT (Running Balance)
// ================================================================

/**
 * Calculates current balance for a specific party across all ledgers
 */
export async function fetchPartyBalance(partyId: string) {
    return withRetry(async () => {
        const { data: party, error: pError } = await supabase
            .from('parties')
            .select('opening_balance, opening_balance_side')
            .eq('id', partyId)
            .single();
        if (pError) throw pError;

        let balance = party.opening_balance || 0;
        const startBalance = party.opening_balance_side === 'CR' ? -balance : balance;

        const { data: lines, error: lError } = await supabase
            .from('voucher_lines')
            .select('amount, side')
            .eq('party_id', partyId);
        if (lError) throw lError;

        let txNet = 0;
        (lines || []).forEach(line => {
            if (line.side === 'DR') txNet += (line.amount || 0);
            else txNet -= (line.amount || 0);
        });

        const currentBalance = startBalance + txNet;
        return {
            balance: Math.abs(currentBalance),
            side: currentBalance >= 0 ? 'DR' : 'CR'
        };
    });
}

/**
 * Calculates current balance for a specific party EXCLUDING cash/bank settlements.
 * This represents the "Business Position" (Receivables/Payables).
 */
export async function fetchPartyBusinessBalance(partyId: string) {
    return withRetry(async () => {
        const { data: party, error: pError } = await supabase
            .from('parties')
            .select('opening_balance, opening_balance_side')
            .eq('id', partyId)
            .single();
        if (pError) throw pError;

        let balance = party.opening_balance || 0;
        const startBalance = party.opening_balance_side === 'CR' ? -balance : balance;

        // Fetch lines where ledger is not cash/bank AND voucher is posted
        const { data: lines, error: lError } = await supabase
            .from('voucher_lines')
            .select('amount, side, party_id, ledger:ledgers!inner(is_cash_bank), voucher:vouchers!inner(status, party_id)')
            .eq('ledger.is_cash_bank', false)
            .eq('voucher.status', 'POSTED');

        if (lError) throw lError;

        let txNet = 0;
        (lines || []).forEach(line => {
            // Check if this line belongs to the party (either directly or via voucher header)
            const linePartyId = line.party_id;
            const voucherPartyId = (line.voucher as any)?.party_id;
            if (linePartyId === partyId || voucherPartyId === partyId) {
                if (line.side === 'DR') txNet += (line.amount || 0);
                else txNet -= (line.amount || 0);
            }
        });

        const currentBalance = startBalance + txNet;
        return {
            balance: Math.abs(currentBalance),
            side: currentBalance >= 0 ? 'DR' : 'CR'
        };
    });
}

/**
 * Calculates current balance for a specific party for a SPECIFIC ledger.
 * Respects opening balance ONLY if the ledger is the primary ledger for the party.
 */
export async function fetchPartyBalanceByLedger(partyId: string, ledgerId: string) {
    return withRetry(async () => {
        // 1. Get Party Info (Opening Balance)
        const { data: party, error: pError } = await supabase
            .from('parties')
            .select('opening_balance, opening_balance_side, party_type')
            .eq('id', partyId)
            .single();
        if (pError) throw pError;

        // 2. Get Ledger Info (to check if it matches party type)
        const { data: ledger, error: lInfoError } = await supabase
            .from('ledgers')
            .select('ledger_name')
            .eq('id', ledgerId)
            .single();
        if (lInfoError) throw lInfoError;

        let startBalance = 0;
        // Basic Rule: If it's the standard ledger for the party, include opening balance
        const isCustomerLedger = ledger.ledger_name === 'Customer Receivables';
        const isVendorLedger = ledger.ledger_name === 'Supplier Payables';

        if ((isCustomerLedger && (party.party_type === 'CUSTOMER' || party.party_type === 'BOTH')) ||
            (isVendorLedger && (party.party_type === 'VENDOR' || party.party_type === 'BOTH'))) {
            const ob = party.opening_balance || 0;
            startBalance = party.opening_balance_side === 'CR' ? -ob : ob;
        }

        // 3. Fetch specific ledger transactions
        const { data: lines, error: lError } = await supabase
            .from('voucher_lines')
            .select('amount, side, party_id, voucher:vouchers!inner(status, party_id)')
            .eq('ledger_id', ledgerId)
            .eq('voucher.status', 'POSTED');

        if (lError) throw lError;

        let txNet = 0;
        (lines || []).forEach(line => {
            // Check if this line belongs to the party (either directly or via voucher header)
            const linePartyId = line.party_id;
            const voucherPartyId = (line.voucher as any)?.party_id;
            if (linePartyId === partyId || voucherPartyId === partyId) {
                if (line.side === 'DR') txNet += (line.amount || 0);
                else txNet -= (line.amount || 0);
            }
        });

        const currentBalance = startBalance + txNet;
        return {
            balance: Math.abs(currentBalance),
            side: currentBalance >= 0 ? 'DR' : 'CR'
        };
    });
}

export async function fetchLedgerStatement(
    ledgerId: string | null,
    startDate?: string,
    endDate?: string,
    partyId?: string
) {
    return withRetry(async () => {
        const { data, error } = await supabase.rpc('fetch_ledger_statement_v1', {
            p_ledger_id: toUUID(ledgerId),
            p_party_id: toUUID(partyId),
            p_start_date: startDate || null,
            p_end_date: endDate || null,
            p_limit: 1000 // High limit for reporting
        });

        if (error) {
            console.error('fetch_ledger_statement_v1 RPC Error:', error);
            throw error;
        }

        const result = data as {
            balance_bf: number;
            quantity_bf: number;
            nature: AccountNature;
            lines: any[];
        };

        const isAssetOrExpense = ['ASSET', 'EXPENSE'].includes(result.nature);
        const normalSide: Side = isAssetOrExpense ? 'DR' : 'CR';

        let currentBalance = result.balance_bf;
        let currentQuantityBalance = result.quantity_bf;

        // The RPC returns lines in DESC order (newest first) for UI
        // But we need to calculate running balance CHRONOLOGICALLY
        const chronologicalLines = [...result.lines].reverse();

        const processedLines = chronologicalLines.map(line => {
            const amount = line.amount || 0;
            const qty = line.quantity || 0;

            if (isAssetOrExpense) {
                currentBalance += (line.side === 'DR' ? amount : -amount);
                currentQuantityBalance += (line.side === 'DR' ? qty : -qty);
            } else {
                currentBalance += (line.side === 'CR' ? amount : -amount);
                currentQuantityBalance += (line.side === 'CR' ? qty : -qty);
            }

            return {
                date: line.voucher_date,
                voucher_no: line.voucher_no,
                narration: line.voucher_narration,
                debit: line.side === 'DR' ? amount : 0,
                credit: line.side === 'CR' ? amount : 0,
                balance: currentBalance,
                balance_side: currentBalance >= 0 ? normalSide : (normalSide === 'DR' ? 'CR' : 'DR'),
                quantity: qty,
                uom_code: line.uom_code,
                party_name: line.party_name,
                customer_id: line.customer_id,
                ledger_name: line.ledger_name,
                ledger_nature: line.ledger_nature,
                is_opening: false,
                is_reversed: false,
                effect_direction: (isAssetOrExpense
                    ? (line.side === 'DR' ? 'increase' : 'decrease')
                    : (line.side === 'CR' ? 'increase' : 'decrease')
                ) as 'increase' | 'decrease' | 'neutral',
                quantity_balance: currentQuantityBalance
            };
        });

        // Final UI Sort: Newest at Top
        const displayRows = processedLines.reverse();

        // Add B/F Row at Bottom
        displayRows.push({
            date: 'â€”',
            voucher_no: 'â€”',
            narration: 'Balance Brought Forward',
            debit: 0,
            credit: 0,
            balance: result.balance_bf,
            balance_side: result.balance_bf >= 0 ? normalSide : (normalSide === 'DR' ? 'CR' : 'DR'),
            quantity: null,
            uom_code: null,
            party_name: null,
            customer_id: null,
            ledger_name: null,
            ledger_nature: null,
            is_opening: true,
            is_reversed: false,
            effect_direction: 'neutral',
            quantity_balance: result.quantity_bf
        });

        return displayRows;
    });
}

// ================================================================
// TRIAL BALANCE
// ================================================================

export async function fetchTrialBalance(startDate: string, endDate: string, includeDrafts: boolean = false) {
    return withRetry(async () => {
        const { data, error } = await supabase.rpc('fetch_trial_balance_tally_v1', {
            p_start_date: startDate,
            p_end_date: endDate,
            p_include_drafts: includeDrafts
        });

        if (error) {
            console.error('fetch_trial_balance_tally_v1 RPC Error:', error);
            throw error;
        }
        return data as TrialBalanceRow[];
    });
}

// ================================================================
// FINANCIAL STATEMENTS (Aggregated)
// ================================================================

export async function fetchProfitLoss(startDate: string, endDate: string) {
    return withRetry(async () => {
        // Fetch TB for the specific period movement
        const tb = await fetchTrialBalance(startDate, endDate, false);

        // Profit & Loss only cares about Period Movement of Ledgers
        const ledgers = tb.filter(r => r.node_type === 'LEDGER');

        const income = ledgers.filter(r => r.nature === 'INCOME')
            .map(r => ({ head: r.node_name, amount: r.period_cr - r.period_dr }));

        const expense = ledgers.filter(r => r.nature === 'EXPENSE')
            .map(r => ({ head: r.node_name, amount: r.period_dr - r.period_cr }));

        const totalIncome = income.reduce((sum, i) => sum + i.amount, 0);
        const totalExpense = expense.reduce((sum, e) => sum + e.amount, 0);
        const netProfit = totalIncome - totalExpense;

        return { income, expense, netProfit };
    });
}

export async function fetchBalanceSheet(asOfDate: string) {
    return withRetry(async () => {
        // Balance Sheet is "as of" date, so we use closing balances (BF + all movements)
        // We pass a very old start date or rely on opening balances
        const tb = await fetchTrialBalance('1900-01-01', asOfDate, false);

        const ledgers = tb.filter(r => r.node_type === 'LEDGER');

        const assets = ledgers.filter(r => r.nature === 'ASSET')
            .map(r => ({ head: r.node_name, amount: r.closing_dr - r.closing_cr }));

        const liabilities = ledgers.filter(r => r.nature === 'LIABILITY')
            .map(r => ({ head: r.node_name, amount: r.closing_cr - r.closing_dr }));

        const equity = ledgers.filter(r => r.nature === 'EQUITY')
            .map(r => ({ head: r.node_name, amount: r.closing_cr - r.closing_dr }));

        // Calculate Life-to-Date Net Profit (Retained Earnings)
        const periodIncome = ledgers.filter(r => r.nature === 'INCOME')
            .map(r => r.closing_cr - r.closing_dr)
            .reduce((sum, a) => sum + a, 0);

        const periodExpense = ledgers.filter(r => r.nature === 'EXPENSE')
            .map(r => r.closing_dr - r.closing_cr)
            .reduce((sum, a) => sum + a, 0);

        const retainedEarnings = periodIncome - periodExpense;

        return { assets, liabilities, equity, retainedEarnings };
    });
}

// ================================================================
// ATTACHMENT OPERATIONS
// ================================================================

export async function uploadAttachment(
    voucherId: string,
    file: File
) {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `voucher/${voucherId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from('voucher-attachments')
        .upload(filePath, file);

    if (uploadError) throw uploadError;

    const { data, error: dbError } = await supabase
        .from('voucher_attachments')
        .insert({
            voucher_id: voucherId,
            file_path: filePath,
            file_name: file.name,
            mime_type: file.type,
            size_bytes: file.size,
        })
        .select()
        .single();

    if (dbError) throw dbError;
    return data;
}

export async function fetchAttachments(voucherId: string) {
    const { data, error } = await supabase
        .from('voucher_attachments')
        .select('*')
        .eq('voucher_id', voucherId)
        .order('uploaded_at');

    if (error) throw error;
    return data;
}

// ================================================================
// DATABASE RESET (CLEAN START)
// ================================================================

export async function clearAllData() {
    console.log('ðŸš¨ WARNING: TRIGGERING FULL SYSTEM FACTORY RESET...');

    // Phase 1: Unlink System Configurations (Critical to release Foreign Keys)
    console.log('Unlinking system configurations to release FK constraints...');
    const { error: configError } = await supabase
        .from('system_configurations')
        .update({
            current_financial_year_id: null,
            business_name: null,
            business_address: null,
            business_gstin: null,
            business_phone: null,
            business_email: null,
            updated_at: new Date().toISOString()
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Singleton row

    if (configError) {
        console.error('âŒ Failed to reset system configuration:', configError.message);
        throw new Error('System reset failed at configuration phase.');
    }

    // Correct order to handle foreign key dependencies (CHILDREN first, then PARENTS)
    const allTables = [
        // Level 5: Transaction Details & Sub-records
        { name: 'audit_log' },
        { name: 'voucher_attachments' },
        { name: 'voucher_lines' },
        { name: 'bank_txn_exports' },
        { name: 'reference_counters' },
        { name: 'attendance_corrections_log' },
        { name: 'attendance_salary_deductions' },
        { name: 'delay_incidents' },
        { name: 'attendance_incidents' },
        { name: 'attendance_records' },
        { name: 'attendance_monthly_snapshots' },
        { name: 'attendance_delta_adjustments' },
        { name: 'exit_clearance_tasks' },
        { name: 'exit_checklist_items' },
        { name: 'exit_fnf_settlements' },
        { name: 'session_staff' },

        // Level 4: Parent Transactions & Bank Links
        { name: 'approval_requests' },
        { name: 'vouchers' },
        { name: 'transaction_sessions' },
        { name: 'bank_accounts' },
        { name: 'bank_statement_items' },
        { name: 'reconcile_locks' },

        // Level 3: Policy, Staff & Template Details
        { name: 'template_lines' },
        { name: 'template_voucher_types', col: 'template_id' },
        { name: 'staff_master' },
        { name: 'leave_requests' },
        { name: 'exit_cases' },
        { name: 'voucher_sequences', col: 'voucher_type_id' },

        // Level 2: Masters & Templates
        { name: 'ledgers', protected: true },
        { name: 'parties' },
        { name: 'voucher_types', protected: true },
        { name: 'leave_policies' },
        { name: 'exit_policies' },
        { name: 'shift_assignments' },
        { name: 'shift_groups' },
        { name: 'exit_checklist_templates' },
        { name: 'device_departments', protected: true },

        // Level 1: Core System Roots
        { name: 'ledger_groups', protected: true },
        { name: 'party_groups' },
        { name: 'voucher_groups', protected: true },
        { name: 'template_groups' },
        { name: 'uoms', protected: true },
        { name: 'financial_years' },
        { name: 'reference_prefixes', protected: true }
    ];

    // 2. Clear Special Tables (Preserving some data)
    console.log('Clearing Ledger Tags (Preserving BANK ACCOUNT)...');
    const { error: tagError } = await supabase
        .from('ledger_tags')
        .delete()
        .neq('tag_name', 'BANK ACCOUNT');
    if (tagError) console.warn('Failed to clear ledger_tags:', tagError.message);

    // 3. Clear Tables in loop
    for (const table of allTables as any[]) {
        console.log(`Wiping data from: ${table.name}...`);
        const col = table.col || 'id';

        let query = (supabase.from(table.name as any) as any)
            .delete()
            .neq(col as any, '00000000-0000-0000-0000-000000000000');

        // Apply system-default protection if requested
        if (table.protected) {
            query = query.eq('is_system', false);
        }

        const { error } = await query;

        if (error) {
            console.error(`âŒ CRITICAL: Could not clear table ${table.name}:`, error.message);
            // Fallback attempt: just try to match ANY non-null value
            const { error: error2 } = await supabase
                .from(table.name as any)
                .delete()
                .not(col as any, 'is', 'null');

            if (error2) console.error(`âŒ FAILED Retry for ${table.name}:`, error2.message);
        }
    }

    // Phase 4: Create 'BANK ACCOUNT' tag if missing
    console.log('Ensuring default BANK ACCOUNT filter...');
    await supabase.from('ledger_tags').upsert({ tag_name: 'BANK ACCOUNT', is_active: true }, { onConflict: 'tag_name' });

    console.log('âœ… Full database wipe complete.');
    return true;
}

// ================================================================
// SAMPLE DATA GENERATOR (GOLD LOAN SPECIALIZED)
// ================================================================

export async function seedSampleData() {
    console.log('ðŸš€ Initializing Gold Loan Sample Data Engine...');

    try {
        // 0. Ensure Business Filters (Tags)
        console.log('ðŸ·ï¸ Ensuring Business Filters...');
        const { error: bankTagErr } = await supabase
            .from('ledger_tags')
            .upsert({ tag_name: 'BANK ACCOUNT', is_active: true }, { onConflict: 'tag_name' })
            .select()
            .single();
        if (bankTagErr) console.warn('Failed to ensure default BANK ACCOUNT filter:', bankTagErr.message);

        // 0.5 Ensure Financial Year
        console.log('ðŸ“… Ensuring default Financial Year (2025-26)...');
        const { data: fy, error: fyErr } = await supabase
            .from('financial_years')
            .upsert({
                name: 'FY 2025-26',
                start_date: '2025-04-01',
                end_date: '2026-03-31',
                is_active: true
            }, { onConflict: 'name' })
            .select()
            .single();
        if (fyErr) throw fyErr;

        // Link to System Configuration
        console.log('ðŸ”— Linking FY to system configuration...');
        await supabase
            .from('system_configurations')
            .update({ current_financial_year_id: fy.id })
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Singleton ID

        // 1. Ensure Grams UOM exists
        console.log('ðŸ“¦ Ensuring UOMs...');
        const requiredUoms = [
            { name: 'Grams', code: 'GMS', type: 'WEIGHT', precision: 3 },
            { name: 'Rupees', code: 'INR', type: 'CURRENCY', precision: 2 },
            { name: 'Pieces', code: 'PCS', type: 'COUNT', precision: 0 }
        ];

        const uomMap: Record<string, string> = {};
        for (const u of requiredUoms) {
            const { data: uom, error: uomErr } = await supabase
                .from('uoms')
                .upsert({ name: u.name, code: u.code, uom_type: u.type, precision: u.precision, is_active: true }, { onConflict: 'code' })
                .select()
                .single();
            if (uomErr) throw uomErr;
            uomMap[u.code] = uom.id;
        }

        // 2. Fetch/Create Ledger Groups
        console.log('ðŸ“‚ Organizing Ledger Groups...');
        const requiredGroups = [
            { name: 'Current Assets', nature: 'ASSET' },
            { name: 'Bank Accounts', nature: 'ASSET' },
            { name: 'Loans & Advances (Asset)', nature: 'ASSET' },
            { name: 'Current Liabilities', nature: 'LIABILITY' },
            { name: 'Direct Income', nature: 'INCOME' },
            { name: 'Indirect Expenses', nature: 'EXPENSE' }
        ];

        const groupMap: Record<string, string> = {};
        for (const g of requiredGroups) {
            const { data: group, error: gErr } = await supabase
                .from('ledger_groups')
                .upsert({ group_name: g.name, nature: g.nature, is_active: true }, { onConflict: 'group_name' })
                .select()
                .single();
            if (gErr) throw gErr;
            groupMap[g.name] = group.id;
        }

        // 3. Create Ledgers
        console.log('ledger Creating Gold Loan Ledgers...');
        const ledgerConfigs = [
            { name: 'Cash in Hand', group: groupMap['Current Assets'], nature: 'ASSET', side: 'DR', isCash: true },
            { name: 'SIB Bank Account', group: groupMap['Bank Accounts'], nature: 'ASSET', side: 'DR', isCash: true },
            { name: 'Gold Loan Receivable (Principal)', group: groupMap['Loans & Advances (Asset)'], nature: 'ASSET', side: 'DR' },
            { name: 'Gold Pledged â€“ Customer (Gold Liability)', group: groupMap['Current Liabilities'], nature: 'LIABILITY', side: 'CR', uomId: uomMap['GMS'] },
            { name: 'Gold Loan Interest Income', group: groupMap['Direct Income'], nature: 'INCOME', side: 'CR' },
            { name: 'Gold Loan Charges Income', group: groupMap['Direct Income'], nature: 'INCOME', side: 'CR' }
        ];

        const createdLedgers: Record<string, any> = {};
        for (const config of ledgerConfigs) {
            const { data: ledger, error: lErr } = await supabase
                .from('ledgers')
                .upsert({
                    ledger_name: config.name,
                    ledger_group_id: config.group,
                    nature: config.nature as any,
                    normal_side: config.side as 'DR' | 'CR',
                    is_cash_bank: config.isCash || false,
                    default_uom_id: config.uomId || null,
                    is_active: true
                }, { onConflict: 'ledger_name' })
                .select()
                .single();
            if (lErr) throw lErr;
            createdLedgers[config.name] = ledger;
        }

        // 4. Create Voucher Types
        console.log('ðŸŽ« Creating Gold Loan Voucher Types...');
        const vtConfigs = [
            { code: 'GL_ISSUE', name: 'Gold Loan Issue', prefix: 'GLI', nature: 'PAYMENT', flow: 'OUTFLOW' },
            { code: 'GL_INT_RCPT', name: 'Gold Loan Interest Receipt', prefix: 'INT', nature: 'RECEIPT', flow: 'INFLOW' },
            { code: 'GL_CLOSE', name: 'Gold Loan Closure', prefix: 'GLC', nature: 'RECEIPT', flow: 'INFLOW' }
        ];

        const createdVoucherTypes: Record<string, any> = {};
        for (const config of vtConfigs) {
            const { data: vt, error: vtErr } = await supabase
                .from('voucher_types')
                .upsert({
                    type_code: config.code,
                    type_name: config.name,
                    prefix: config.prefix,
                    voucher_nature: config.nature as any,
                    cash_bank_flow: config.flow as any,
                    is_active: true
                }, { onConflict: 'type_code' })
                .select()
                .single();
            if (vtErr) throw vtErr;
            createdVoucherTypes[config.code] = vt;

            // Ensure sequence exists
            await supabase.from('voucher_sequences').upsert({
                voucher_type_id: vt.id,
                next_number: 1
            }, { onConflict: 'voucher_type_id' });
        }

        // 5. Create Templates
        console.log('ðŸ“‹ Creating Gold Loan Templates...');

        // Ensure Template Group exists
        const { data: tmplGrp } = await supabase
            .from('template_groups')
            .upsert({ group_name: 'Gold Loan', description: 'Gold Loan Management Templates' }, { onConflict: 'group_name' })
            .select()
            .single();

        const templates = [
            {
                name: 'Gold Loan Issue',
                code: 'GL_ISSUE',
                vtId: createdVoucherTypes['GL_ISSUE'].id,
                lines: [
                    { lid: createdLedgers['Gold Loan Receivable (Principal)'].id, side: 'DR', fixed: true, rule: 'INPUT' },
                    { lid: createdLedgers['Cash in Hand'].id, side: 'CR', fixed: false, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Pledged â€“ Customer (Gold Liability)'].id, side: 'CR', fixed: true, rule: 'INPUT' }
                ]
            },
            {
                name: 'Interest Receipt',
                code: 'GL_INT_RCPT',
                vtId: createdVoucherTypes['GL_INT_RCPT'].id,
                lines: [
                    { lid: createdLedgers['Cash in Hand'].id, side: 'DR', fixed: false, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Loan Interest Income'].id, side: 'CR', fixed: true, rule: 'INPUT' }
                ]
            },
            {
                name: 'Gold Loan Closure',
                code: 'GL_CLOSE',
                vtId: createdVoucherTypes['GL_CLOSE'].id,
                lines: [
                    { lid: createdLedgers['Cash in Hand'].id, side: 'DR', fixed: false, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Loan Receivable (Principal)'].id, side: 'CR', fixed: true, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Loan Interest Income'].id, side: 'CR', fixed: false, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Loan Charges Income'].id, side: 'CR', fixed: false, rule: 'INPUT' },
                    { lid: createdLedgers['Gold Pledged â€“ Customer (Gold Liability)'].id, side: 'DR', fixed: true, rule: 'CALCULATED' }
                ]
            }
        ];

        for (const t of templates) {
            const { data: tmpl, error: tErr } = await supabase
                .from('rapid_templates')
                .upsert({
                    template_name: t.name,
                    template_code: t.code,
                    voucher_type_id: t.vtId,
                    group_id: tmplGrp?.id,
                    is_active: true
                }, { onConflict: 'template_code' })
                .select()
                .single();
            if (tErr) throw tErr;

            // Link to Voucher Type (Many-to-Many - check if table exists)
            try {
                await supabase.from('template_voucher_types').upsert({
                    template_id: tmpl.id,
                    voucher_type_id: t.vtId
                }, { onConflict: 'template_id,voucher_type_id' });
            } catch (e) {
                console.warn('Could not link template to voucher type via many-to-many. Skipping.');
            }

            // Lines
            const linesToInsert = t.lines.map((l, idx) => ({
                template_id: tmpl.id,
                line_number: idx + 1,
                ledger_id: l.lid,
                default_side: l.side as 'DR' | 'CR',
                is_fixed_side: l.fixed,
                amount_rule: l.rule as any
            }));

            // Delete old lines first
            await supabase.from('template_lines').delete().eq('template_id', tmpl.id);
            await supabase.from('template_lines').insert(linesToInsert);
        }

        // 6. Generate Sample Parties
        console.log('ðŸ‘¥ Generating Sample Parties...');
        const partyNames = ['Arjun Kumar', 'Sarah Williams', 'Rajesh Sharma', 'Priya Mani'];
        for (let i = 0; i < partyNames.length; i++) {
            await upsertParty({
                party_name: partyNames[i],
                party_type: 'CUSTOMER',
                phone: `998877660${i}`,
                customer_id: `CU-GL-${100 + i}`,
                is_active: true
            });
        }

        console.log('ðŸŽ‰ Gold Loan Sample Data generated successfully.');
        return true;
    } catch (error) {
        console.error('ðŸ”¥ Failed to seed Gold Loan data:', error);
        throw error;
    }
}

// ================================================================
// STAFF & IDENTITY OPERATIONS
// ================================================================

export async function fetchStaffMasters(activeOnly = false) {
    return withRetry(async () => {
        let query = supabase
            .from('staff_master')
            .select('*, exit_cases(final_lwd, status)');

        if (activeOnly) {
            query = query.neq('is_active', false);
        }

        const { data, error } = await query.order('full_name');
        if (error) throw error;
        return data as StaffMaster[];
    });
}

export async function upsertStaffMaster(staff: Partial<StaffMaster>) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('staff_master')
            .upsert(staff)
            .select()
            .single();
        if (error) throw error;

        // Automation: If staff member is deactivated, disconnect account
        if (staff.is_active === false && data.id) {
            try {
                await disconnectStaffAccount(data.id);
            } catch (e) {
                console.error("Automated disconnection failed during upsert:", e);
            }
        }

        return data as StaffMaster;
    });
}

export async function updateStaffMaster(id: string, staff: Partial<StaffMaster>) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('staff_master')
            .update(staff)
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data as StaffMaster;
    });
}

// Save which staff were on duty for a session (replaces existing assignments)
export async function saveSessionStaff(
    sessionId: string,
    staffIds: string[],
    responsibleStaffId?: string | null,
    selectedBy?: string
) {
    return withRetry(async () => {
        // Delete all existing staff for this session
        const { error: deleteError } = await supabase
            .from('session_staff')
            .delete()
            .eq('session_id', sessionId);
        if (deleteError) throw deleteError;

        // Insert the selected staff
        if (staffIds.length > 0) {
            const rows = staffIds.map(staff_id => ({
                session_id: sessionId,
                staff_id,
                is_responsible: responsibleStaffId ? staff_id === responsibleStaffId : false,
                selected_by: selectedBy || null,
                selected_at: new Date().toISOString()
            }));
            const { error: insertError } = await supabase
                .from('session_staff')
                .insert(rows);
            if (insertError) throw insertError;
        }
    });
}


// Fetch staff members who are eligible for session posting (Active + Dept Flag or Staff Override)
export async function fetchPostingEligibleStaff() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('posting_eligible_staff_view')
            .select('*')
            .order('full_name');
        if (error) throw error;
        return data as (StaffMaster & { department_name?: string })[];
    });
}

// Fetch staff IDs that were saved for a session
export async function fetchSessionStaff(sessionId: string): Promise<string[]> {
    const { data, error } = await supabase
        .from('session_staff')
        .select('staff_id')
        .eq('session_id', sessionId);
    if (error) throw error;
    return (data || []).map((r: any) => r.staff_id);
}



// ================================================================
// ROLE & ACCESS OPERATIONS
// ================================================================

export async function fetchRoles() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('roles')
            .select('*')
            .order('role_name');
        if (error) throw error;
        return data as Role[];
    });
}

// ================================================================
// ENTERPRISE: DEVICE & ROLE OPERATIONS
// ================================================================

export const DEVICE_COLUMNS = 'id, device_name, device_fingerprint, is_authorized, last_seen, created_at, permissions, user_id, email, department_id';

export async function fetchDevices() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('devices')
            .select(`${DEVICE_COLUMNS}, department:device_departments(*)`)
            .order('device_name');
        if (error) throw error;
        return data as unknown as Device[];
    });
}

export async function upsertDevice(device: Partial<Device>) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('devices')
            .upsert(device)
            .select(DEVICE_COLUMNS)
            .single();
        if (error) throw error;
        return data as Device;
    });
}

export async function fetchDeviceDepartments(activeOnly = false) {
    return withRetry(async () => {
        let query = supabase
            .from('device_departments')
            .select('*')
            .order('name');
        if (activeOnly) {
            query = query.eq('is_active', true);
        }
        const { data, error } = await query;
        if (error) throw error;
        return (data || []) as DeviceDepartment[];
    });
}

export async function upsertDeviceDepartment(dept: Partial<DeviceDepartment>) {
    const cleaned = { ...dept };
    delete (cleaned as any).created_at;

    const { data, error } = await supabase
        .from('device_departments')
        .upsert({
            ...cleaned,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as DeviceDepartment;
}

export async function fetchDevicesByDepartment(deptId: string) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('devices')
            .select(DEVICE_COLUMNS)
            .eq('department_id', deptId)
            .order('device_name');
        if (error) throw error;
        return data as Device[];
    });
}

export async function fetchUserOrgAccess(userId?: string) {
    return withRetry(async () => {
        let query = supabase
            .from('user_org_access')
            .select('*, role:roles(*)');

        if (userId) {
            query = query.eq('user_id', userId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as UserOrgAccess[];
    });
}

// ================================================================
// APPROVAL WORKFLOW OPERATIONS
// ================================================================

export async function fetchApprovalRequests(filters?: {
    moduleId?: string;
    status?: string;
}) {
    return withRetry(async () => {
        let query = supabase
            .from('approval_requests_v2')
            .select('*')
            .order('created_at', { ascending: false });

        if (filters?.moduleId) query = query.eq('module_id', filters.moduleId);
        if (filters?.status) query = query.eq('status', filters.status);

        const { data, error } = await query;
        if (error) throw error;
        return data as ApprovalRequest[];
    });
}

export async function updateApprovalRequestStatus(
    id: string,
    status: 'APPROVED' | 'REJECTED',
    approvedBy: string,
    comments?: string
) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('approval_requests')
            .update({
                status,
                approved_by: approvedBy,
                decision_reason: comments,
                closed_at: new Date().toISOString()
            })
            .eq('id', id)
            .select()
            .single();
        if (error) throw error;
        return data as ApprovalRequest;
    });
}

export async function fetchTransactionSessions(filters?: {
    startDate?: string;
    endDate?: string;
    partyId?: string;
    status?: string;
}) {
    let query = supabase
        .from('transaction_sessions')
        .select('*, party:parties(*), vouchers(*)')
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (filters?.startDate) query = query.gte('session_date', filters.startDate);
    if (filters?.endDate) query = query.lte('session_date', filters.endDate);
    if (filters?.partyId) query = query.eq('party_id', filters.partyId);
    if (filters?.status) query = query.eq('status', filters.status);

    const { data, error } = await query;
    if (error) throw error;
    return data as TransactionSession[];
}

export async function fetchSessionById(id: string) {
    const { data, error } = await supabase
        .from('transaction_sessions')
        .select(`
            *,
            party:parties(*),
            vouchers:vouchers(
                *,
                voucher_type:voucher_types(*),
                lines:voucher_lines(
                    *,
                    ledger:ledgers(*)
                )
            )
        `)
        .eq('id', id)
        .single();

    if (error) throw error;
    return data as TransactionSession;
}

/**
 * Creates a Transaction Session and its child vouchers in a single flow.
 * Note: To ensure total atomicity, this should ideally be handled via a Postgres RPC function.
 */
export async function createTransactionSession(sessionData: SessionFormData & { id?: string }) {
    // prepare vouchers for RPC
    const preparedVouchers = sessionData.vouchers.map(v => {
        const validLines = (v.lines || [])
            .map(l => ({
                ...l,
                party_id: toUUID(l.party_id),
                uom_id: toUUID(l.uom_id),
                amount: Number(l.amount) || 0,
                quantity: Number(l.quantity) || 0,
                line_narration: l.line_narration || null,
                external_ref: l.external_ref || null,
                rate: l.rate || null,
                valuation_ref: l.valuation_ref || null
            }))
            .filter(l => Math.abs(l.amount) > 0.001 || Math.abs(l.quantity) > 0.001);

        const totalDebit = validLines
            .filter(l => l.side === 'DR')
            .reduce((sum, l) => sum + l.amount, 0);

        const totalCredit = validLines
            .filter(l => l.side === 'CR')
            .reduce((sum, l) => sum + l.amount, 0);

        return {
            draft_id: toUUID(v.draft_id),
            ui_key: v.ui_key,
            voucher_type_id: v.voucher_type_id,
            template_id: toUUID(v.template_id),
            narration: v.narration,
            reference_no: v.reference_no || null,
            total_debit: totalDebit,
            total_credit: totalCredit,
            status: 'DRAFT',
            bank_status: v.bank_status || 'NONE',
            approval_status: v.approval_status || 'NOT_REQUIRED',
            lines: validLines,
            expected_updated_at: v.updated_at || null
        };
    });

    const { data, error: rpcError } = await supabase.rpc('save_transaction_session_v1', {
        p_session_id: toUUID(sessionData.id),
        p_party_id: toUUID(sessionData.party_id),
        p_session_date: sessionData.session_date,
        p_narration: sessionData.narration,
        p_session_ref: sessionData.session_ref,
        p_status: 'DRAFT',
        p_vouchers: preparedVouchers,
        p_audit_exception_reason: sessionData.audit_exception_reason || null
    });

    if (rpcError) {
        console.error('save_transaction_session_v1 RPC Error:', rpcError);
        throw rpcError;
    }

    const savedSession = await fetchSessionById(data.id);

    // Re-attach ui_keys for frontend reconciliation
    if (savedSession && savedSession.vouchers) {
        savedSession.vouchers = savedSession.vouchers.map(v => {
            const match = data.vouchers.find((rv: any) => rv.id === v.id);
            if (match) {
                return { ...v, ui_key: match.ui_key, updated_at: match.updated_at } as any;
            }
            return v;
        });
    }

    return savedSession;
}


/**
 * Posts an entire session atomically using a Postgres RPC.
 * This ensures that if one voucher fails, none are posted.
 */
export async function postTransactionSession(sessionId: string) {
    const { data, error } = await supabase
        .rpc('post_session_atomically', { p_session_id: sessionId });

    if (error) throw error;
    return data;
}

// ================================================================
// FINANCIAL YEAR & SYSTEM CONFIG OPERATIONS
// ================================================================

export async function fetchFinancialYears() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('financial_years')
            .select('*')
            .order('start_date', { ascending: false });
        if (error) throw error;
        return data as FinancialYear[];
    });
}

export async function fetchSystemConfig() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('system_configurations')
            .select('*, current_fy:financial_years(*)')
            .limit(1);

        if (error) throw error;
        if (!data || data.length === 0) return null;
        return data[0] as SystemConfiguration;
    });
}

export async function updateSystemConfig(config: Partial<SystemConfiguration>) {
    const cleaned = { ...config };
    delete (cleaned as any).current_fy;
    // Use a fixed singleton ID to ensure we always have a valid row to reference
    const id = config.id || '00000000-0000-0000-0000-000000000000';

    const { error } = await supabase
        .from('system_configurations')
        .upsert({ ...cleaned, id });

    if (error) {
        console.error('System config update failed:', error);
        throw error;
    }

    // Fetch fresh config with joined current_fy to ensure UI updates correctly
    return await fetchSystemConfig() as SystemConfiguration;
}

// ================================================================
// SYSTEM DATE OVERRIDE OPERATIONS
// ================================================================

export async function fetchSystemDateLogs(filters?: {
    startDate?: string;
    endDate?: string;
}): Promise<SystemDateLog[]> {
    return withRetry(async () => {
        let query = supabase
            .from('system_date_logs')
            .select('*')
            .order('changed_at', { ascending: false });

        if (filters?.startDate) {
            query = query.gte('changed_at', filters.startDate);
        }
        if (filters?.endDate) {
            // Add 1 day to include full end date
            const end = new Date(filters.endDate);
            end.setDate(end.getDate() + 1);
            query = query.lt('changed_at', end.toISOString().split('T')[0]);
        }

        const { data, error } = await query;
        if (error) throw error;
        return (data || []) as SystemDateLog[];
    });
}

export async function updateBusinessDate(
    newDate: string | null,
    reason?: string
): Promise<SystemConfiguration> {
    // 1. Read current business_date for the audit log
    const current = await fetchSystemConfig();
    const oldDate = current?.business_date || null;
    const action = newDate ? 'SET' : 'CLEAR';

    // 2. Write audit log entry FIRST (immutable record)
    const { error: logError } = await supabase
        .from('system_date_logs')
        .insert({
            old_date: oldDate,
            new_date: newDate,
            changed_by: 'admin',
            reason: reason || null,
            action,
        });

    if (logError) {
        console.error('System date log insert failed:', logError);
        throw logError;
    }

    // 3. Update system_configurations.business_date
    return await updateSystemConfig({
        ...current,
        business_date: newDate,
    } as any);
}

export async function carryForwardBalances(asOfDate: string) {
    const tb = await fetchTrialBalance('1900-01-01', asOfDate);

    const updates = tb.filter(r => r.node_type === 'LEDGER').map((row) => ({
        id: row.node_id,
        opening_balance: Math.max(row.closing_dr, row.closing_cr),
        opening_balance_side: (row.closing_dr >= row.closing_cr ? 'DR' : 'CR') as Side
    }));

    // Bulk update ledgers
    for (const update of updates) {
        const { error } = await supabase
            .from('ledgers')
            .update({
                opening_balance: update.opening_balance,
                opening_balance_side: update.opening_balance_side,
                updated_at: new Date().toISOString()
            })
            .eq('id', update.id);

        if (error) throw error;
    }

    return true;
}

export async function upsertFinancialYear(fy: Partial<FinancialYear>) {
    const { data, error } = await supabase
        .from('financial_years')
        .upsert({
            ...fy,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();
    if (error) throw error;
    return data as FinancialYear;
}

export async function toggleFinancialYearStatus(id: string, isClosed: boolean) {
    const { data, error } = await supabase
        .from('financial_years')
        .update({
            is_closed: isClosed,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

    if (error) throw error;
    return data as FinancialYear;
}

export async function fetchPartiesForLedger(ledgerId: string): Promise<string[]> {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('voucher_lines')
            .select(`
                party_id,
                vouchers!inner(party_id)
            `)
            .eq('ledger_id', ledgerId);

        if (error) throw error;

        const partyIds = new Set<string>();
        data?.forEach(row => {
            if (row.party_id) partyIds.add(row.party_id);
            if ((row.vouchers as any)?.party_id) partyIds.add((row.vouchers as any).party_id);
        });

        return Array.from(partyIds);
    });
}

/**
 * Calculates net balances for all parties associated with a specific ledger.
 */
export async function fetchPartyBalancesForLedger(ledgerId: string): Promise<Record<string, { balance: number; side: Side }>> {
    return withRetry(async () => {
        const { data: ledger } = await supabase.from('ledgers').select('ledger_name, nature').eq('id', ledgerId).single();
        if (!ledger) return {};

        const linesQuery = supabase
            .from('voucher_lines')
            .select(`
                amount,
                side,
                party_id,
                vouchers!inner(party_id, status)
            `)
            .eq('ledger_id', ledgerId)
            .eq('vouchers.status', 'POSTED');

        const [linesResponse, partiesResponse] = await Promise.all([
            linesQuery,
            supabase
                .from('parties')
                .select('id, opening_balance, opening_balance_side, party_type')
                .eq('is_active', true)
        ]);

        if (linesResponse.error) throw linesResponse.error;
        if (partiesResponse.error) throw partiesResponse.error;

        const partyNet: Record<string, number> = {};
        const nature = ledger.nature as AccountNature;
        const isAssetOrExpense = ['ASSET', 'EXPENSE'].includes(nature);

        // Initialize with Opening Balances based on PRIMARY LEDGER RULE
        (partiesResponse.data || []).forEach(p => {
            let initialBalance = 0;
            const isPrimary = (
                (ledger.ledger_name.toUpperCase() === 'CUSTOMER RECEIVABLES' && p.party_type !== 'VENDOR') ||
                (ledger.ledger_name.toUpperCase() === 'SUPPLIER PAYABLES' && p.party_type !== 'CUSTOMER')
            );

            if (isPrimary && p.opening_balance) {
                const opAmt = p.opening_balance;
                if (p.opening_balance_side === 'DR') {
                    initialBalance = isAssetOrExpense ? opAmt : -opAmt;
                } else if (p.opening_balance_side === 'CR') {
                    initialBalance = isAssetOrExpense ? -opAmt : opAmt;
                }
            }
            partyNet[p.id] = initialBalance;
        });

        // Calculate actual balances from lines
        (linesResponse.data || []).forEach(line => {
            const pid = line.party_id || (line.vouchers as any)?.party_id;
            if (pid && partyNet[pid] !== undefined) {
                const amt = line.amount || 0;
                if (isAssetOrExpense) {
                    partyNet[pid] += (line.side === 'DR' ? amt : -amt);
                } else {
                    partyNet[pid] += (line.side === 'CR' ? amt : -amt);
                }
            }
        });

        const balances: Record<string, { balance: number; side: Side }> = {};
        for (const [id, net] of Object.entries(partyNet)) {
            balances[id] = {
                balance: Math.abs(net),
                side: net >= 0 ? (isAssetOrExpense ? 'DR' : 'CR') : (isAssetOrExpense ? 'CR' : 'DR')
            };
        }
        return balances;
    });
}

// ================================================================
// BANK EXPORT & PREFIX OPERATIONS (NEW)
// ================================================================

export async function fetchReferencePrefixes() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('reference_prefixes')
            .select('*')
            .order('prefix', { ascending: true });
        if (error) throw error;
        return data as ReferencePrefix[];
    });
}

export async function upsertReferencePrefix(prefix: Partial<ReferencePrefix>) {
    const { data, error } = await supabase
        .from('reference_prefixes')
        .upsert({ ...prefix, updated_at: new Date().toISOString() })
        .select()
        .single();
    if (error) throw error;
    return data as ReferencePrefix;
}

export async function generateNextBankRefNo(prefixId: string, count: number = 1) {
    const { data, error } = await supabase.rpc('get_next_reference_number', {
        p_prefix_id: prefixId,
        p_count: count
    });
    if (error) throw error;
    return data as {
        prefix: string;
        start_counter: number;
        end_counter: number;
        reference_no: string;
        file_name: string
    };
}

export async function logBankTxnExport(exportData: Partial<BankTxnExport>) {
    const { data, error } = await supabase
        .from('bank_txn_exports')
        .insert(exportData)
        .select()
        .single();
    if (error) throw error;
    return data as BankTxnExport;
}

export async function upsertUserOrgAccess(access: Partial<UserOrgAccess>) {
    // Call the robust server-side RPC which handles partial index conflict targets automatically.
    const { data, error } = await supabase
        .rpc('upsert_user_org_access_v1', {
            p_user_id: access.user_id,
            p_role_id: access.role_id,
            p_scope_type: access.scope_type,
            p_scope_id: access.scope_id,
            p_is_active: access.is_active ?? true
        });

    if (error) throw error;
    return data as UserOrgAccess;
}

export async function revokeUserOrgAccess(id: string) {
    const { error } = await supabase
        .from('user_org_access')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

// ================================================================
// ENTERPRISE: DEVICE MANAGEMENT
// ================================================================

// Duplicate fetchDevices and legacy upsertDevice removed, unified above in ROLE & ACCESS OPERATIONS section

export async function upsertRole(role: Partial<Role>) {
    const { data, error } = await supabase
        .from('roles')
        .upsert({ ...role, updated_at: new Date().toISOString() })
        .select()
        .single();
    if (error) throw error;
    return data as Role;
}

export async function deleteRole(id: string) {
    const { error } = await supabase
        .from('roles')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

export async function updateDeviceAuthorization(id: string, is_authorized: boolean) {
    const updatePayload: any = { is_authorized };

    const { data, error } = await supabase
        .from('devices')
        .update(updatePayload)
        .eq('id', id)
        .select(DEVICE_COLUMNS)
        .single();
    if (error) throw error;
    return data as Device;
}

// ================================================================
// ENTERPRISE: AUDIT LOGS
// ================================================================

export async function fetchSystemAuditLogs(filters?: {
    staffId?: string | null;
    deviceId?: string | null;
    actionType?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}) {
    const deviceSelector = `device:devices(${DEVICE_COLUMNS})`;
    let query = supabase
        .from('system_audit_logs')
        .select(`*, staff_profile:staff_master(*), ${deviceSelector}`)
        .order('created_at', { ascending: false });

    if (filters?.staffId) query = query.eq('staff_id', filters.staffId);
    if (filters?.deviceId) query = query.eq('device_id', filters.deviceId);
    if (filters?.actionType) query = query.eq('action_type', filters.actionType);
    if (filters?.startDate) query = query.gte('created_at', filters.startDate);

    if (filters?.endDate) {
        const end = new Date(filters.endDate);
        end.setDate(end.getDate() + 1);
        query = query.lt('created_at', end.toISOString().split('T')[0]);
    }

    if (filters?.limit) query = query.limit(filters.limit);
    else query = query.limit(500);

    const { data, error } = await query;
    if (error) throw error;
    return data as any[];
}

export async function uploadBusinessLogo(file: File) {
    const fileExt = file.name.split('.').pop();
    const fileName = `logo-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${fileName}`;

    const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(filePath, file);

    if (uploadError) {
        if (uploadError.message.includes('Bucket not found') || (uploadError as any).status === 404) {
            throw new Error('Storage bucket "logos" not found. Please run the SQL migration in your Supabase dashboard or create a public bucket named "logos".');
        }
        if (uploadError.message.includes('permission') || (uploadError as any).status === 403) {
            throw new Error('Permission denied. Please ensure the "logos" bucket has public INSERT policies enabled.');
        }
        throw uploadError;
    }

    const { data } = supabase.storage
        .from('logos')
        .getPublicUrl(filePath);

    return data.publicUrl;
}

// ================================================================
// ENTERPRISE: PROTECTED RESET
// ================================================================

export async function resetUserManagement(confirmPhrase: string) {
    return withRetry(async () => {
        const { data, error } = await supabase.rpc('reset_user_management_v1', {
            p_confirm_phrase: confirmPhrase
        });

        if (error) {
            console.error('reset_user_management_v1 RPC Error:', error);
            throw error;
        }

        const result = data as { success: boolean; message: string; error?: string; stats?: any };
        if (!result.success) {
            throw new Error(result.error || 'Reset failed');
        }
        return result;
    });
}

export async function disconnectStaffAccount(staffId: string) {
    return withRetry(async () => {
        const { error } = await supabase.rpc('rpc_disconnect_staff_account', {
            p_staff_id: staffId
        });
        if (error) throw error;
        return { success: true };
    });
}

export async function provisionStaffAccount(staffId: string, email: string) {
    const { data, error } = await supabase.rpc('provision_staff_account_v1', {
        p_staff_id: staffId,
        p_email: email
    });

    if (error) {
        console.error('provision_staff_account_v1 RPC Error:', error);
        throw error;
    }

    const result = data as { success: boolean; message: string; error?: string; user_id?: string };
    if (!result.success) {
        throw new Error(result.message || result.error || 'Provisioning failed');
    }
    return result;
}

export async function provisionDeviceAccount(deviceId: string, email: string) {
    const { data, error } = await supabase.rpc('provision_device_account_v1', {
        p_device_id: deviceId,
        p_email: email
    });

    if (error) {
        console.error('provision_device_account_v1 RPC Error:', error);
        throw error;
    }

    const result = data as { success: boolean; message: string; error?: string; user_id?: string };
    if (!result.success) {
        throw new Error(result.message || result.error || 'Provisioning failed');
    }
    return result;
}

export async function deleteDevice(id: string) {
    const { data, error } = await supabase.rpc('delete_device_v1', {
        p_device_id: id
    });

    if (error) {
        console.error('delete_device_v1 RPC Error:', error);
        throw error;
    }

    const result = data as { success: boolean; message: string; error?: string };
    if (!result.success) {
        throw new Error(result.message || result.error || 'Deletion failed');
    }
    return result;
}

export async function updateUserAuthCredentials(email: string, newEmail: string | null, password: string | null) {
    const { data, error } = await supabase.rpc('update_user_auth_credentials', {
        p_email: email,
        p_new_email: newEmail,
        p_password: password
    });

    if (error) {
        console.error('update_user_auth_credentials RPC Error:', error);
        throw error;
    }

    const result = data as { success: boolean; user_id?: string; error?: string };
    if (!result.success) {
        throw new Error(result.error || 'Credential update failed');
    }
    return result;
}

// ================================================================
// HR: LEAVE MANAGEMENT OPERATIONS
// ================================================================

export async function fetchActiveLeavePolicy(referenceDate?: string) {
    const targetDate = referenceDate || new Date().toLocaleDateString('en-CA');
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('leave_policies')
            .select('*')
            .or(`and(status.eq.ACTIVE,effective_from.lte.${targetDate},or(effective_to.is.null,effective_to.gte.${targetDate})),and(status.eq.INACTIVE,effective_from.lte.${targetDate},or(effective_to.is.null,effective_to.gte.${targetDate}))`)
            .order('effective_from', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        return data as LeavePolicy | null;
    });
}

export async function fetchLeavePolicies() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('leave_policies')
            .select('*')
            .order('effective_from', { ascending: false });
        if (error) throw error;
        return data as LeavePolicy[];
    });
}

export async function upsertLeavePolicy(policy: Partial<LeavePolicy>) {
    return withRetry(async () => {
        const { id, ...rest } = policy;
        const payload = { ...rest };

        let query;
        if (id) {
            query = supabase.from('leave_policies').update(payload).eq('id', id);
        } else {
            query = supabase.from('leave_policies').insert(payload);
        }

        const { data, error } = await query.select().single();
        if (error) throw error;
        return data as LeavePolicy;
    });
}

export async function fetchLeaveBalances(year: number, staffId?: string) {
    return withRetry(async () => {
        let query = supabase
            .from('leave_balances')
            .select('*, staff:staff_master(*)')
            .eq('year', year);

        if (staffId) {
            query = query.eq('staff_id', staffId);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as LeaveBalance[];
    });
}

export async function fetchLeaveRequests(filters?: { staffId?: string, status?: string }) {
    return withRetry(async () => {
        let query = supabase
            .from('leave_requests')
            .select('*, staff:staff_master(*)')
            .order('from_date', { ascending: false });

        if (filters?.staffId) query = query.eq('staff_id', filters.staffId);
        if (filters?.status) query = query.eq('status', filters.status);

        const { data, error } = await query;
        if (error) throw error;
        return data as LeaveRequest[];
    });
}

export async function upsertLeaveRequest(request: Partial<LeaveRequest>) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('leave_requests')
            .upsert(request)
            .select()
            .single();
        if (error) throw error;
        return data as LeaveRequest;
    });
}

export async function approveLeaveRequest(requestId: string, approverId: string) {
    return withRetry(async () => {
        // 1. Get the request and the active policy
        const { data: request, error: reqError } = await supabase
            .from('leave_requests')
            .select('*, staff:staff_master(*)')
            .eq('id', requestId)
            .single();
        if (reqError) throw reqError;
        // 1. Check if allocation already exists (Primary check for same-day AUTO_UPL)
        const { count } = await supabase
            .from('leave_days')
            .select('*', { count: 'exact', head: true })
            .eq('request_id', requestId);

        if (count && count > 0) {
            // If and only if allocation exists, we check if status is synced
            if (request.status !== 'APPROVED') {
                await supabase.from('leave_requests').update({ status: 'APPROVED', approved_by: approverId }).eq('id', requestId);
            }
            return true;
        }

        // 2. Call the Atomic Allocation RPC
        const { error: allocError } = await supabase.rpc('process_leave_allocation_v2', {
            p_request_id: requestId,
            p_approver_id: approverId
        });

        if (allocError) {
            console.error('Allocation Error:', allocError);
            throw new Error(`Failed to allocate leave: ${allocError.message}`);
        }

        return true;
    });
}

export async function requestCancelLeave(requestId: string) {
    const { error } = await supabase
        .from('leave_requests')
        .update({ status: 'CANCEL_REQUESTED', updated_at: new Date().toISOString() })
        .eq('id', requestId);

    if (error) throw error;
    return true;
}

export async function approveCancelLeave(requestId: string, adminId?: string) {
    // Uses the RPC to handle balances transactionally 
    const { error } = await supabase.rpc('process_leave_reversal', {
        p_request_id: requestId,
        p_new_status: 'CANCELLED',
        p_admin_id: adminId || null
    });

    if (error) {
        console.error('Error in approveCancelLeave RPC:', error);
        throw error;
    }
    return true;
}

export async function revokeLeave(requestId: string, adminId?: string) {
    // Equivalent logic but distinct semantic action for past leaves
    const { error } = await supabase.rpc('process_leave_reversal', {
        p_request_id: requestId,
        p_new_status: 'REVOKED',
        p_admin_id: adminId || null
    });

    if (error) {
        console.error('Error in revokeLeave RPC:', error);
        throw error;
    }
    return true;
}

// ================================================================
// RELIEVING & EXIT MANAGEMENT
// ================================================================



export async function fetchActiveExitPolicy() {
    const { data, error } = await supabase
        .from('exit_policies')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data as ExitPolicy | null;
}

export async function updateExitPolicy(newPolicy: Partial<ExitPolicy>) {
    // 1. Mark existing ACTIVE as INACTIVE with an effective_to date of today
    const { error: updateError } = await supabase
        .from('exit_policies')
        .update({
            status: 'INACTIVE',
            effective_to: new Date().toISOString().split('T')[0],
            updated_at: new Date().toISOString()
        })
        .eq('status', 'ACTIVE');

    if (updateError) throw updateError;

    // 2. Insert the new active policy
    const { data, error } = await supabase
        .from('exit_policies')
        .insert([{
            notice_period_days: newPolicy.notice_period_days ?? 30,
            allow_withdrawal: newPolicy.allow_withdrawal ?? true,
            withdrawal_cutoff_days: newPolicy.withdrawal_cutoff_days ?? 7,
            encash_leave_enabled: newPolicy.encash_leave_enabled ?? false,
            encash_leave_max_days: newPolicy.encash_leave_max_days ?? 0,
            absconding_unpaid_rule: newPolicy.absconding_unpaid_rule ?? true,
            status: 'ACTIVE',
            effective_from: new Date().toISOString().split('T')[0]
        }])
        .select()
        .single();

    if (error) throw error;
    return data as ExitPolicy;
}

export async function fetchExitCases() {
    const { data, error } = await supabase
        .from('exit_cases')
        .select(`
            *,
            staff:staff_master ! staff_id (id, full_name, staff_code, department)
        `)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data as ExitCase[];
}

export async function initiateExitCase(caseData: Partial<ExitCase>) {
    const { data, error } = await supabase
        .from('exit_cases')
        .insert([caseData])
        .select()
        .single();
    if (error) throw error;
    return data as ExitCase;
}

export async function fetchExitChecklistTemplates() {
    const { data, error } = await supabase
        .from('exit_checklist_templates')
        .select(`
            *,
            items:exit_checklist_items (*)
        `)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data as (ExitChecklistTemplate & { items: ExitChecklistItem[] })[];
}

export async function createExitChecklistTemplate(name: string, description?: string) {
    const { data, error } = await supabase
        .from('exit_checklist_templates')
        .insert([{ name, description }])
        .select()
        .single();
    if (error) throw error;
    return data as ExitChecklistTemplate;
}

export async function deleteExitChecklistTemplate(id: string) {
    const { error } = await supabase
        .from('exit_checklist_templates')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function createExitChecklistItem(item: Partial<ExitChecklistItem>) {
    const { data, error } = await supabase
        .from('exit_checklist_items')
        .insert([item])
        .select()
        .single();
    if (error) throw error;
    return data as ExitChecklistItem;
}

export async function deleteExitChecklistItem(id: string) {
    const { error } = await supabase
        .from('exit_checklist_items')
        .delete()
        .eq('id', id);
    if (error) throw error;
}

export async function fetchExitClearanceTasks(exitCaseId: string) {
    const { data, error } = await supabase
        .from('exit_clearance_tasks')
        .select('*')
        .eq('exit_case_id', exitCaseId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data as ExitClearanceTask[];
}

export async function updateClearanceTask(id: string, updates: Partial<ExitClearanceTask>) {
    const { data, error } = await supabase
        .from('exit_clearance_tasks')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data as ExitClearanceTask;
}

export async function updateExitCaseStatus(caseId: string, status: ExitCase['status'], finalLwd?: string) {
    const updates: any = { status, updated_at: new Date().toISOString() };
    if (finalLwd) updates.final_lwd = finalLwd;

    const { data, error } = await supabase
        .from('exit_cases')
        .update(updates)
        .eq('id', caseId)
        .select()
        .single();
    if (error) throw error;

    // If we're scheduling the exit, fire the RPC to freeze/cancel future leaves
    if (status === 'EXIT_SCHEDULED' && data?.staff_id && data?.final_lwd) {
        const { error: rpcError } = await supabase.rpc('freeze_leaves_after_lwd', {
            p_staff_id: data.staff_id,
            p_lwd: data.final_lwd
        });
        if (rpcError) console.error("Error freezing leaves:", rpcError);
    }

    // If case is MANAGER_APPROVED or CLOSED, deactivate the staff member and disconnect account
    if ((status === 'MANAGER_APPROVED' || status === 'CLOSED') && data?.staff_id) {
        const { error: sErr } = await supabase
            .from('staff_master')
            .update({ is_active: false })
            .eq('id', data.staff_id);
        if (sErr) throw sErr;

        await disconnectStaffAccount(data.staff_id);
    }

    return data as ExitCase;
}

export async function fetchLatestExitCase(staffId: string) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('exit_cases')
            .select('*')
            .eq('staff_id', staffId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data as ExitCase | null;
    });
}

export async function upsertExitFnfSettlement(settlementData: Partial<ExitFnfSettlement>) {
    const { error } = await supabase
        .from('exit_fnf_settlements')
        .upsert({ ...settlementData, updated_at: new Date().toISOString() }, { onConflict: 'exit_case_id' });
    if (error) throw error;
}

export async function fetchExitFnfSettlement(caseId: string) {
    const { data, error } = await supabase
        .from('exit_fnf_settlements')
        .select('*')
        .eq('exit_case_id', caseId)
        .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data as ExitFnfSettlement | null;
}

// ================================================================
// ATTENDANCE & SHIFT MANAGEMENT
// ================================================================

export async function fetchShiftGroups() {
    const { data, error } = await supabase
        .from('shift_groups')
        .select('*')
        .order('name');
    if (error) throw error;
    return data as ShiftGroup[];
}

export async function upsertShiftGroup(shift: Partial<ShiftGroup>) {
    const { data, error } = await supabase
        .from('shift_groups')
        .upsert({ ...shift, updated_at: new Date().toISOString() })
        .select()
        .single();
    if (error) throw error;
    return data as ShiftGroup;
}

export async function deleteShiftGroup(id: string) {
    const { error } = await supabase
        .from('shift_groups')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

// --- Shift Assignments ---

export async function fetchShiftAssignments(staffId?: string) {
    let query = supabase
        .from('shift_assignments')
        .select('*, shift_group:shift_groups(*)');
    if (staffId) {
        query = query.eq('staff_id', staffId);
    }
    const { data, error } = await query.order('effective_from', { ascending: false });
    if (error) throw error;
    return data as ShiftAssignment[];
}

export async function upsertShiftAssignment(assignment: Partial<ShiftAssignment>) {
    const { data, error } = await supabase
        .from('shift_assignments')
        .upsert({ ...assignment, updated_at: new Date().toISOString() })
        .select()
        .single();
    if (error) throw error;
    return data as ShiftAssignment;
}

export async function getEffectiveShift(staffId: string, date: string) {
    const { data, error } = await supabase.rpc('get_effective_shift', {
        p_staff_id: staffId,
        p_date: date
    });
    if (error) throw error;
    return data?.[0] as { shift_group_id: string; source: ShiftSource; assignment_id: string } | null;
}

export async function fetchAttendanceRecords(date: string) {
    const { data: recordsData, error: recError } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('attendance_date', date);
    if (recError) throw recError;
    return recordsData;
}





export async function upsertAttendanceRecords(records: Partial<AttendanceRecord>[]) {
    // Helper: ensure a value is a valid TIMESTAMPTZ string.
    // - If already a full ISO timestamp → pass through unchanged.
    // - If a bare time "HH:MM" or "HH:MM:SS" → combine with attendanceDate to build a full ISO string.
    // - If null/undefined → return null.
    const toTimestamp = (val: any, attendanceDate: string): string | null => {
        if (!val) return null;
        const s = String(val);

        // Already a full ISO timestamp (contains 'T' or a date portion)
        if (s.includes('T') || /^\d{4}-\d{2}-\d{2}/.test(s)) return s;

        // Bare time string like "09:00" or "09:00:00" — combine with the date
        if (/^\d{2}:\d{2}(:\d{2})?$/.test(s)) {
            const timeStr = s.length === 5 ? s + ':00' : s;
            return `${attendanceDate}T${timeStr}`;
        }

        return s; // fallback: pass as-is
    };

    const TIME_COLS = ['punch_in', 'punch_out', 'break_start', 'break_end', 'lunch_in', 'lunch_out'];

    const cleanRecords = records.map(r => {
        const attendanceDate: string = r.attendance_date || new Date().toISOString().split('T')[0];

        // Strictly whitelist columns for attendance_records
        const cleaned: any = {
            staff_id: r.staff_id,
            attendance_date: attendanceDate,
            status: r.status || 'ABSENT',
            is_verified: r.is_verified,
            verified_by: r.verified_by,
            notes: r.notes,
            incident_id: (r as any).incident_id,
            correction_reason: r.correction_reason,
            excused_late_minutes: r.excused_late_minutes,
            updated_at: new Date().toISOString(),
        };

        if (r.id) cleaned.id = r.id;

        for (const col of TIME_COLS) {
            cleaned[col] = toTimestamp((r as any)[col], attendanceDate);
        }

        return cleaned;
    });
    const { data, error } = await supabase
        .from('attendance_records')
        .upsert(cleanRecords, { onConflict: 'staff_id,attendance_date' })
        .select();
    if (error) throw error;
    return data;
}



export async function verifyAttendanceRecord(recordId: string, userId: string) {
    const { data, error } = await supabase
        .from('attendance_records')
        .update({
            is_verified: true,
            verified_by: userId,
            updated_at: new Date().toISOString()
        })
        .eq('id', recordId)
        .select();
    if (error) throw error;
    return data;
}

export async function fetchDelayIncidents(date?: string) {
    let query = supabase.from('attendance_incidents').select('*, staff:staff_master(full_name, staff_code)');
    if (date) query = query.eq('attendance_date', date);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data as any[];
}

export async function fetchLeaveDaysForDate(date: string) {
    const { data, error } = await supabase
        .from('leave_days')
        .select('*, leave_requests(status)')
        .eq('leave_date', date);
    if (error) throw error;
    // Only return those where the parent request is APPROVED or TAKEN
    return (data as any[]).filter(d => ['APPROVED', 'TAKEN'].includes(d.leave_requests?.status));
}

export async function requestAttendanceIncidentRPC(params: {
    p_staff_id: string;
    p_date: string;
    p_type: AttendanceIncidentType;
    p_reason: string;
    p_impact_request?: any;
}) {
    const { data, error } = await supabase.rpc('request_attendance_incident', params);
    if (error) throw error;
    return data as string;
}

export async function resolveAttendanceIncidentRPC(params: {
    p_incident_id: string;
    p_status: IncidentState;
    p_reason: string;
}) {
    const { error } = await supabase.rpc('resolve_attendance_incident', params);
    if (error) throw error;
}

export async function requestAttendanceCorrectionRPC(params: {
    p_staff_id: string;
    p_date: string;
    p_type: AttendanceCorrectionType;
    p_reason: string;
    p_proposed_impact: any;
    p_evidence_metadata?: any;
}) {
    const { data, error } = await supabase.rpc('request_attendance_correction', params);
    if (error) throw error;
    return data as string;
}

export async function resolveAttendanceCorrectionRPC(params: {
    p_correction_id: string;
    p_action: 'MANAGER_APPROVE' | 'MANAGER_REJECT' | 'HR_APPROVE' | 'HR_REJECT';
    p_reason: string;
}) {
    const { error } = await supabase.rpc('resolve_attendance_correction', params);
    if (error) throw error;
}

export async function fetchAttendanceCorrections(date?: string) {
    let query = supabase.from('attendance_corrections').select('*, staff:staff_master(full_name, staff_code)');
    if (date) query = query.eq('attendance_date', date);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    return data as AttendanceCorrection[];
}

export async function fetchMonthlySnapshots(year: number, month: number, staffId?: string) {
    let query = supabase.from('attendance_monthly_snapshots')
        .select('*, staff:staff_master(full_name, staff_code)')
        .eq('year', year)
        .eq('month', month);

    if (staffId) query = query.eq('staff_id', staffId);

    const { data, error } = await query.order('total_payable_days', { ascending: false });
    if (error) throw error;
    return data as AttendanceMonthlySnapshot[];
}

export async function generateMonthlySnapshotRPC(year: number, month: number, staffId: string) {
    const { data, error } = await supabase.rpc('generate_monthly_snapshot', {
        p_year: year,
        p_month: month,
        p_staff_id: staffId
    });
    if (error) throw error;
    return data as string;
}

export async function recomputeMonthlySnapshotsRPC(year: number, month: number, staffIds?: string[]) {
    const { data, error } = await supabase.rpc('recompute_monthly_snapshots', {
        p_year: year,
        p_month: month,
        p_staff_ids: staffIds
    });
    if (error) throw error;
    return data as { total_processed: number; success_count: number };
}

export async function lockPayrollPeriodRPC(params: {
    p_year: number;
    p_month: number;
    p_locked_by: string;
}) {
    const { data, error } = await supabase.rpc('lock_payroll_period', params);
    if (error) throw error;
    return data as number;
}

export async function fetchPayrollReconciliation(year: number, month: number) {
    const { data, error } = await supabase.from('view_payroll_reconciliation')
        .select('*')
        .eq('year', year)
        .eq('month', month);
    if (error) throw error;
    return data as PayrollReconciliation[];
}

export async function recordPayrollAdjustmentRPC(params: {
    p_staff_id: string;
    p_target_year: number;
    p_target_month: number;
    p_adj_type: string;
    p_delta: number;
    p_reason: string;
    p_cur_year: number;
    p_cur_month: number;
    p_created_by: string;
}) {
    const { data, error } = await supabase.rpc('record_payroll_adjustment', params);
    if (error) throw error;
    return data as string;
}

export async function fetchDeltaAdjustments(year: number, month: number) {
    const { data, error } = await supabase.from('attendance_delta_adjustments')
        .select('*, staff:staff_master(full_name, staff_code)')
        .eq('applied_in_year', year)
        .eq('applied_in_month', month);
    if (error) throw error;
    return data as AttendanceDeltaAdjustment[];
}

export async function fetchStaffAttendanceHistory(staffId: string, startDate: string, endDate: string) {
    const { data, error } = await supabase.rpc('get_attendance_history_v2', {
        p_staff_id: staffId,
        p_start_date: startDate,
        p_end_date: endDate
    });
    if (error) throw error;
    return data as AttendanceRecord[];
}

export async function verifyDayRPC(params: {
    p_date: string;
    p_verified_by: string;
    p_shift_group_id?: string;
}) {
    const { error } = await supabase.rpc('verify_day_v1', params);
    if (error) throw error;
}

export async function resolveLeaveReversalRPC(params: {
    p_request_id: string;
    p_new_status: 'CANCELLED' | 'REVOKED';
    p_admin_id?: string;
}) {
    const { error } = await supabase.rpc('process_leave_reversal', params);
    if (error) throw error;
}

export async function getDailyMusterSummaryRPC(p_date: string) {
    const { data, error } = await supabase.rpc('get_daily_muster_summary_v1', { p_date });
    if (error) throw error;
    return data?.[0] || null;
}

export async function getLateReportRPC(p_start_date: string, p_end_date: string) {
    const { data, error } = await supabase.rpc('get_late_report_v1', { p_start_date, p_end_date });
    if (error) throw error;
    return data || [];
}

export async function fetchAttendanceAuditLogs(recordId: string) {
    const { data, error } = await supabase
        .from('attendance_audit_logs_view')
        .select('*')
        .eq('attendance_record_id', recordId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

// ================================================================
// DEPARTMENT MANAGEMENT
// ================================================================

export async function fetchDepartments(activeOnly = false) {
    return withRetry(async () => {
        let query = supabase
            .from('departments')
            .select('*')
            .order('dept_name');

        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query;
        if (error) throw error;
        return data as import('../types/accounting').Department[];
    });
}

export async function upsertDepartment(dept: Partial<import('../types/accounting').Department>) {
    const cleaned = { ...dept };
    delete (cleaned as any).created_at;

    const { data, error } = await supabase
        .from('departments')
        .upsert({
            ...cleaned,
            updated_at: new Date().toISOString()
        })
        .select()
        .single();

    if (error) throw error;
    return data as import('../types/accounting').Department;
}

export async function deleteDepartment(id: string) {
    const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', id);
    if (error) throw error;
    return true;
}

// ================================================================
// BANK RECONCILIATION OPERATIONS
// ================================================================

export async function fetchBankVoucherLines(ledgerId: string, startDate?: string, endDate?: string) {
    return withRetry(async () => {
        let query = supabase
            .from('voucher_lines')
            .select(`
                *,
                voucher:vouchers!inner(voucher_no, voucher_date, narration, total_debit, total_credit, status),
                party:parties(party_name)
            `)
            .eq('ledger_id', ledgerId)
            .eq('voucher.status', 'POSTED')
            .order('created_at', { ascending: true });

        if (startDate) query = query.gte('voucher.voucher_date', startDate);
        if (endDate) query = query.lte('voucher.voucher_date', endDate);

        const { data, error } = await query;
        if (error) throw error;
        return data.map((row: any) => ({
            ...row,
            voucher: row.voucher,
            party: row.party
        })) as (VoucherLine & { voucher: Voucher; party: Party })[];
    });
}

export async function fetchBankStatementItems(ledgerId: string, startDate?: string, endDate?: string) {
    return withRetry(async () => {
        let query = supabase
            .from('bank_statement_items')
            .select('*')
            .eq('ledger_id', ledgerId)
            .order('txn_date', { ascending: true });

        if (startDate) query = query.gte('txn_date', startDate);
        if (endDate) query = query.lte('txn_date', endDate);

        const { data, error } = await query;
        if (error) throw error;
        return data as BankStatementItem[];
    });
}

export async function reconcileBankMatches(bookLineIds: string[], statementItemId: string, reconDate: string) {
    return withRetry(async () => {
        const { error } = await supabase.rpc('reconcile_bank_txn', {
            p_book_line_ids: bookLineIds,
            p_statement_item_id: statementItemId,
            p_recon_date: reconDate
        });
        if (error) throw error;
        return true;
    });
}

export async function unreconcileBankTxn(statementItemId: string) {
    return withRetry(async () => {
        const { error } = await supabase.rpc('unreconcile_bank_txn', {
            p_statement_item_id: statementItemId
        });
        if (error) throw error;
        return true;
    });
}

export async function importBankStatement(ledgerId: string, items: Partial<BankStatementItem>[], clearExisting: boolean = false) {
    return withRetry(async () => {
        if (clearExisting) {
            const { error: deleteError } = await supabase
                .from('bank_statement_items')
                .delete()
                .eq('ledger_id', ledgerId)
                .eq('match_status', 'UNMATCHED');

            if (deleteError) throw deleteError;
        }

        const batchId = crypto.randomUUID();
        const rows = items.map(item => ({
            ...item,
            ledger_id: ledgerId,
            import_batch_id: batchId,
            match_status: 'UNMATCHED'
        }));

        // Upsert with conflict on row_hash makes re-uploads idempotent.
        // Duplicate rows (same ledger, date, amount, direction, reference) are silently skipped.
        const { data, error } = await supabase
            .from('bank_statement_items')
            .upsert(rows, {
                onConflict: 'row_hash',
                ignoreDuplicates: true
            })
            .select();

        if (error) throw error;
        return { data, batchId };
    });
}

export async function fetchReconLock(ledgerId: string) {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('reconcile_locks')
            .select('*')
            .eq('ledger_id', ledgerId)
            .maybeSingle();
        if (error) throw error;
        return data as ReconcileLock | null;
    });
}

export async function updateReconLock(ledgerId: string, lockDate: string) {
    return withRetry(async () => {
        const { error } = await supabase
            .from('reconcile_locks')
            .upsert({
                ledger_id: ledgerId,
                lock_date: lockDate,
                locked_by: (await supabase.auth.getUser()).data.user?.id,
                locked_at: new Date().toISOString()
            });
        if (error) throw error;
        return true;
    });
}

/**
 * Atomic "Record & Auto-Match": creates a voucher AND reconciles it
 * in a single database transaction. If reconciliation fails the
 * voucher is automatically rolled back — no orphaned vouchers.
 */
export async function recordAndReconcileAtomic(params: {
    voucherTypeId: string;
    bankLedgerId: string;
    statementItemId: string;
    voucherDate: string;
    narration: string;
    contraLedgerId: string;
    lines: Array<{
        ledger_id: string;
        side: 'DR' | 'CR';
        amount: number;
        line_narration?: string;
    }>;
}) {
    return withRetry(async () => {
        const { data, error } = await supabase.rpc('record_and_reconcile_v1', {
            p_voucher_type_id: params.voucherTypeId,
            p_bank_ledger_id: params.bankLedgerId,
            p_statement_item_id: params.statementItemId,
            p_voucher_date: params.voucherDate,
            p_narration: params.narration,
            p_contra_ledger_id: params.contraLedgerId,
            p_lines: params.lines,
        });
        if (error) throw error;
        return data as string; // returns the new voucher UUID
    });
}

// ================================================================
// FEATURE VISIBILITY OPERATIONS
// ================================================================

export async function fetchFeatureVisibility() {
    return withRetry(async () => {
        const { data, error } = await supabase
            .from('feature_visibility')
            .select('*');
        if (error) throw error;
        return data as { feature_id: string; is_enabled: boolean }[];
    });
}

export async function updateFeatureVisibility(featureId: string, isEnabled: boolean) {
    return withRetry(async () => {
        const { error } = await supabase
            .from('feature_visibility')
            .upsert({
                feature_id: featureId,
                is_enabled: isEnabled,
                updated_at: new Date().toISOString()
            });
        if (error) throw error;
        return true;
    });
}

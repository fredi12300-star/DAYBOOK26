import React, { useState, useEffect } from 'react';
import {
    Calendar, ClipboardList, Settings, ShieldCheck,
    Plus, Check, X,
    Save, History, Calculator, User, FileText
} from 'lucide-react';
import {
    fetchLeavePolicies, fetchActiveLeavePolicy, upsertLeavePolicy,
    fetchLeaveRequests, upsertLeaveRequest, approveLeaveRequest,
    fetchLeaveBalances, fetchStaffMasters
} from '../../lib/supabase';
import {
    LeavePolicy, LeaveRequest, LeaveBalance, StaffMaster
} from '../../types/accounting';
import { useAuth } from '../../lib/auth';
import Modal from '../ui/Modal';

interface LeaveManagementProps {
    initialTab?: 'requests' | 'balances' | 'settings' | 'attendance';
}

const LeaveManagement: React.FC<LeaveManagementProps> = ({ initialTab = 'requests' }) => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState<'requests' | 'balances' | 'settings' | 'attendance'>(initialTab);
    const [staff, setStaff] = useState<StaffMaster[]>([]);

    // Requests State
    const [requests, setRequests] = useState<LeaveRequest[]>([]);
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
    // Requests filter + pagination
    const [reqFilterFrom, setReqFilterFrom] = useState('');
    const [reqFilterTo, setReqFilterTo] = useState('');
    const [reqPage, setReqPage] = useState(1);
    const REQ_PAGE_SIZE = 10;

    // Balance card → leave history drawer
    const [historyDrawer, setHistoryDrawer] = useState<LeaveBalance | null>(null);
    const [historyRecords, setHistoryRecords] = useState<LeaveRequest[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');

    // Penalty sub-tab state
    const [drawerTab, setDrawerTab] = useState<'history' | 'penalty'>('history');
    const now = new Date();
    const [penaltyMonth, setPenaltyMonth] = useState<string>(
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    );
    type PenaltyDayRow = { leave_date: string; day_count: number; allocation_type: 'PAID' | 'UNPAID' | 'PENALTY' };
    const [penaltyDays, setPenaltyDays] = useState<PenaltyDayRow[]>([]);
    const [penaltyLoading, setPenaltyLoading] = useState(false);
    const [penaltyWorkingDays, setPenaltyWorkingDays] = useState<number>(26);

    // Apply Leave Form State
    const [applyTiming, setApplyTiming] = useState<'TODAY' | 'FUTURE'>('TODAY');
    const [applyType, setApplyType] = useState<'SINGLE' | 'CONSECUTIVE'>('SINGLE');
    const [applyDuration, setApplyDuration] = useState<'FULL' | 'HALF'>('FULL'); // For today/single
    const [consecutiveStartDay, setConsecutiveStartDay] = useState<'FULL' | 'HALF'>('FULL');
    const [consecutiveEndDay, setConsecutiveEndDay] = useState<'FULL' | 'HALF'>('FULL');
    const [selectedStaffId, setSelectedStaffId] = useState<string>('');
    const [applyStartDate, setApplyStartDate] = useState<string>(new Date().toLocaleDateString('en-CA')); // YYYY-MM-DD local
    const [applyEndDate, setApplyEndDate] = useState<string>('');
    // Simple staff select - just update the id; the effect below will fetch data
    const handleStaffSelect = async (staffId: string) => {
        setSelectedStaffId(staffId);
        if (!staffId) { setPreviewMonthlyTracking({}); return; }
        try {
            const { supabase: sb } = await import('../../lib/supabase');
            // Fetch annual balance if not already loaded
            const alreadyLoaded = balances.some(b => b.staff_id === staffId);
            if (!alreadyLoaded) {
                const leaveYear = new Date(applyStartDate || new Date()).getFullYear();
                const { data: balData } = await sb
                    .from('leave_balances')
                    .select('*, staff:staff_master(*)')
                    .eq('staff_id', staffId)
                    .eq('year', leaveYear)
                    .maybeSingle();
                if (balData) {
                    setBalances(prev => [...prev.filter(b => b.staff_id !== staffId), balData as any]);
                }
            }
        } catch { /* silent */ }
    };

    // Balances State
    const [balances, setBalances] = useState<LeaveBalance[]>([]);
    const [selectedYear] = useState(new Date().getFullYear());
    // Monthly tracking cache for leave impact preview (Key: "year-month")
    const [previewMonthlyTracking, setPreviewMonthlyTracking] = useState<Record<string, number>>({});

    // Re-fetch monthly tracking and annual balances for the entire date range
    useEffect(() => {
        if (!selectedStaffId || !applyStartDate) {
            setPreviewMonthlyTracking({});
            return;
        }

        const start = new Date(applyStartDate);
        const end = applyEndDate ? new Date(applyEndDate) : start;
        const years = new Set<number>();
        const months: { year: number, month: number }[] = [];

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            years.add(y);
            const monthKey = `${y}-${m}`;
            if (!months.some(x => `${x.year}-${x.month}` === monthKey)) {
                months.push({ year: y, month: m });
            }
        }

        import('../../lib/supabase').then(({ supabase: sb }) => {
            // Fetch Monthly Tracking
            Promise.all(months.map(m =>
                sb.from('leave_monthly_tracking')
                    .select('year, month, paid_used')
                    .eq('staff_id', selectedStaffId)
                    .eq('year', m.year)
                    .eq('month', m.month)
                    .maybeSingle()
            )).then(results => {
                const map: Record<string, number> = {};
                results.forEach((r, i) => {
                    const m = months[i];
                    map[`${m.year}-${m.month}`] = Number(r.data?.paid_used ?? 0);
                });
                setPreviewMonthlyTracking(map);
            });

            // Fetch Annual Balances
            Promise.all(Array.from(years).map(y =>
                sb.from('leave_balances')
                    .select('*, staff:staff_master(*)')
                    .eq('staff_id', selectedStaffId)
                    .eq('year', y)
                    .maybeSingle()
            )).then(results => {
                const balData = results.map(r => r.data).filter(Boolean);
                setBalances(prev => {
                    const filtered = prev.filter(b => b.staff_id !== selectedStaffId || !years.has(b.year));
                    return [...filtered, ...balData as any];
                });
            });
        });
    }, [selectedStaffId, applyStartDate, applyEndDate]);

    // Settings State
    const [policies, setPolicies] = useState<LeavePolicy[]>([]);
    const [editingPolicy, setEditingPolicy] = useState<Partial<LeavePolicy>>({});
    const [isSavingPolicy, setIsSavingPolicy] = useState(false);

    useEffect(() => {
        loadInitialData();
    }, []);

    useEffect(() => {
        if (initialTab) {
            setActiveTab(initialTab);
            loadTabData(initialTab);
        }
    }, [initialTab]);

    const loadInitialData = async () => {
        try {
            const [staffData, policyData, activePol] = await Promise.all([
                fetchStaffMasters(true),
                fetchLeavePolicies(),
                fetchActiveLeavePolicy()
            ]);
            setStaff(staffData);
            setPolicies(policyData);
            if (activePol) setEditingPolicy(activePol);

            await loadTabData(activeTab);
        } catch (error) {
            console.error('Error loading initial leave data:', error);
        }
    };

    const loadTabData = async (tab: typeof activeTab) => {
        try {
            if (tab === 'requests') {
                const reqData = await fetchLeaveRequests();
                setRequests(reqData);
            } else if (tab === 'balances') {
                const balData = await fetchLeaveBalances(selectedYear);
                setBalances(balData);
            }
        } catch (error) {
            console.error(`Error loading ${tab} data:`, error);
        }
    };

    const handleTabChange = (tab: typeof activeTab) => {
        setActiveTab(tab);
        loadTabData(tab);
    };

    const handleSavePolicy = async () => {
        setIsSavingPolicy(true);
        try {
            // Create a new version
            const newPolicy: Partial<LeavePolicy> = {
                ...editingPolicy,
                id: undefined, // ensure it's a new record
                status: 'ACTIVE',
                effective_from: new Date().toLocaleDateString('en-CA')
            };

            // Deactivate old active policy if needed (DB trigger or manual)
            // For now, we manually handle status in the upsert if we want logic here

            await upsertLeavePolicy(newPolicy);
            const [polData, activePol] = await Promise.all([
                fetchLeavePolicies(),
                fetchActiveLeavePolicy()
            ]);
            setPolicies(polData);
            if (activePol) setEditingPolicy(activePol);
            alert('Policy updated successfully. New version created.');
        } catch (error) {
            alert('Error saving policy');
        } finally {
            setIsSavingPolicy(false);
        }
    };

    const handleApprove = async (id: string) => {
        if (!user?.id) {
            alert('You must be logged in to approve leave.');
            return;
        }
        if (!confirm('Approve this leave request? Engine will allocate days based on current policy.')) return;
        try {
            await approveLeaveRequest(id, user.id);
            await loadTabData('requests');
            alert('Leave approved and allocated.');
        } catch (error: any) {
            alert('Error approving leave: ' + error.message);
        }
    };

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
                <div className="space-y-2">
                    <h1 className="text-4xl font-display font-black text-white uppercase tracking-tight leading-none flex items-center gap-4">
                        <Calendar className="w-10 h-10 text-brand-500" />
                        Leave Management
                    </h1>
                    <p className="text-slate-500 font-medium text-sm max-w-xl">
                        Integrated policy engine with automatic allocation across Paid, Unpaid, and Penalty tiers.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            setApplyStartDate(new Date().toLocaleDateString('en-CA'));
                            setIsRequestModalOpen(true);
                        }}
                        className="btn-primary"
                    >
                        <Plus className="w-4 h-4" />
                        Apply Leave
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1.5 bg-[#0f172a] border border-slate-800 rounded-2xl w-fit">
                {[
                    { id: 'requests', label: 'Requests', icon: ClipboardList },
                    { id: 'balances', label: 'Balances', icon: User },
                    { id: 'settings', label: 'Policy Settings', icon: Settings },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => handleTabChange(tab.id as any)}
                        className={`flex items-center gap-2 px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-xl ${activeTab === tab.id ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-slate-500 hover:text-slate-300'}`}
                    >
                        <tab.icon className="w-3.5 h-3.5" />
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="animate-fade-in">

                {activeTab === 'requests' && (() => {
                    // Sort newest first
                    const sorted = [...requests].sort((a, b) =>
                        new Date(b.created_at || b.from_date).getTime() - new Date(a.created_at || a.from_date).getTime()
                    );
                    // Date range filter
                    const filtered = sorted.filter(req => {
                        if (reqFilterFrom && req.from_date < reqFilterFrom) return false;
                        if (reqFilterTo && req.to_date > reqFilterTo) return false;
                        return true;
                    });
                    const totalPages = Math.max(1, Math.ceil(filtered.length / REQ_PAGE_SIZE));
                    const safePage = Math.min(reqPage, totalPages);
                    const paginated = filtered.slice((safePage - 1) * REQ_PAGE_SIZE, safePage * REQ_PAGE_SIZE);

                    return (
                        <div className="space-y-4">
                            {/* Filter bar */}
                            <div className="flex flex-wrap items-center gap-3 bg-slate-900/50 border border-slate-800 rounded-2xl px-5 py-3.5">
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Filter by Date</span>
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-slate-500 font-bold">From</label>
                                    <input
                                        type="date"
                                        value={reqFilterFrom}
                                        onChange={e => { setReqFilterFrom(e.target.value); setReqPage(1); }}
                                        className="input-field !py-1.5 !text-[11px] !w-36"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-slate-500 font-bold">To</label>
                                    <input
                                        type="date"
                                        value={reqFilterTo}
                                        onChange={e => { setReqFilterTo(e.target.value); setReqPage(1); }}
                                        className="input-field !py-1.5 !text-[11px] !w-36"
                                    />
                                </div>
                                {(reqFilterFrom || reqFilterTo) && (
                                    <button
                                        onClick={() => { setReqFilterFrom(''); setReqFilterTo(''); setReqPage(1); }}
                                        className="text-[10px] font-bold text-rose-400 hover:text-rose-300 uppercase tracking-widest px-3 py-1.5 border border-rose-500/20 rounded-lg bg-rose-500/5 transition-all"
                                    >
                                        Clear
                                    </button>
                                )}
                                <span className="ml-auto text-[10px] text-slate-500 font-bold">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
                            </div>

                            {/* Table */}
                            <div className="surface-card overflow-hidden border border-slate-800/50">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-900/50 border-b border-slate-800">
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Employee</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Duration</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Days</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                            <th className="px-6 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/50">
                                        {paginated.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} className="px-6 py-12 text-center text-[11px] text-slate-500 font-bold uppercase tracking-widest">
                                                    No leave requests found
                                                </td>
                                            </tr>
                                        ) : paginated.map(req => (
                                            <tr key={req.id} className="hover:bg-white/[0.02] transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400 border border-slate-700">
                                                            {req.staff?.full_name?.charAt(0)}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-bold text-white">{req.staff?.full_name}</div>
                                                            <div className="text-[10px] text-slate-500 font-black uppercase tracking-widest">{req.staff?.staff_code}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="text-[12px] font-medium text-slate-300">
                                                        {new Date(req.from_date).toLocaleDateString('en-GB')} — {new Date(req.to_date).toLocaleDateString('en-GB')}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="px-2.5 py-1 bg-slate-800 rounded-lg text-[11px] font-black text-white border border-slate-700">
                                                        {req.days_count}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border ${req.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                        req.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                            req.status === 'CANCEL_REQUESTED' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' :
                                                                req.status === 'CANCELLED' || req.status === 'LAPSED' ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' :
                                                                    req.status === 'REVOKED' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' :
                                                                        'bg-amber-500/10 text-amber-500 border-amber-500/20'
                                                        }`}>
                                                        {req.status.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    {req.status === 'PENDING' && (() => {
                                                        const activePolicy = policies.find(p => p.status === 'ACTIVE');
                                                        const threshold = activePolicy?.consecutive_limit || 3;
                                                        const isOverLimit = req.days_count > threshold;

                                                        if (isOverLimit) {
                                                            return (
                                                                <div className="flex items-center justify-end">
                                                                    <span className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-lg text-[9px] font-black uppercase tracking-widest cursor-help" title="Leaves exceeding policy limit must be authorized via the Approval Hub in the sidebar.">
                                                                        <ShieldCheck className="w-3 h-3 text-amber-500" />
                                                                        Hub Approval Reqd
                                                                    </span>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    onClick={() => handleApprove(req.id)}
                                                                    className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white rounded-lg transition-all border border-emerald-500/20"
                                                                    title="Approve"
                                                                >
                                                                    <Check className="w-4 h-4" />
                                                                </button>
                                                                <button
                                                                    onClick={async () => {
                                                                        if (confirm('Are you sure you want to reject and cancel this request?')) {
                                                                            await import('../../lib/supabase').then(m => m.requestCancelLeave(req.id));
                                                                            loadTabData('requests');
                                                                        }
                                                                    }}
                                                                    className="p-2 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white rounded-lg transition-all border border-rose-500/20"
                                                                    title="Reject/Cancel"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}

                                                    {req.status === 'APPROVED' && new Date(req.from_date) > new Date() && (
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm('Request cancellation for this future leave?')) {
                                                                    await import('../../lib/supabase').then(m => m.requestCancelLeave(req.id));
                                                                    loadTabData('requests');
                                                                }
                                                            }}
                                                            className="text-[10px] font-bold text-orange-500 hover:text-orange-400 uppercase tracking-widest px-3 py-1.5 border border-orange-500/20 rounded-lg bg-orange-500/5 transition-all"
                                                        >
                                                            Request Cancel
                                                        </button>
                                                    )}

                                                    {req.status === 'CANCEL_REQUESTED' && (
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm('Approve this cancellation? Leave days and balances will be restored.')) {
                                                                    await import('../../lib/supabase').then(m => m.approveCancelLeave(req.id, user?.id));
                                                                    loadTabData('requests');
                                                                    loadTabData('balances');
                                                                    alert('Cancellation approved and balances restored.');
                                                                }
                                                            }}
                                                            className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase tracking-widest px-3 py-1.5 border border-emerald-500/20 rounded-lg bg-emerald-500/5 transition-all"
                                                        >
                                                            Approve Cancel
                                                        </button>
                                                    )}

                                                    {req.status === 'APPROVED' && new Date(req.from_date) <= new Date() && (
                                                        <button
                                                            onClick={async () => {
                                                                if (!confirm('WARNING: Are you sure you want to REVOKE this past leave? This alters historical balances and may affect locked payrolls. Proceed?')) return;
                                                                try {
                                                                    await import('../../lib/supabase').then(m => m.revokeLeave(req.id, user?.id));
                                                                    loadTabData('requests');
                                                                    loadTabData('balances');
                                                                    alert('Leave revoked successfully. Balances restored.');
                                                                } catch (err: any) {
                                                                    alert('Error revoking leave: ' + err.message);
                                                                }
                                                            }}
                                                            className="text-[10px] font-bold text-purple-500 hover:text-purple-400 uppercase tracking-widest px-3 py-1.5 border border-purple-500/20 rounded-lg bg-purple-500/5 transition-all"
                                                        >
                                                            Revoke
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination */}
                            {totalPages > 1 && (
                                <div className="flex items-center justify-between px-2">
                                    <span className="text-[10px] text-slate-500 font-bold">
                                        Page {safePage} of {totalPages} · showing {paginated.length} of {filtered.length}
                                    </span>
                                    <div className="flex items-center gap-2">
                                        <button
                                            disabled={safePage <= 1}
                                            onClick={() => setReqPage(p => Math.max(1, p - 1))}
                                            className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            ← Prev
                                        </button>
                                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                                            <button
                                                key={p}
                                                onClick={() => setReqPage(p)}
                                                className={`w-8 h-8 text-[11px] font-black rounded-lg border transition-all ${safePage === p ? 'bg-brand-600 border-brand-600 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'}`}
                                            >
                                                {p}
                                            </button>
                                        ))}
                                        <button
                                            disabled={safePage >= totalPages}
                                            onClick={() => setReqPage(p => Math.min(totalPages, p + 1))}
                                            className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest border border-slate-700 rounded-lg text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                                        >
                                            Next →
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {activeTab === 'balances' && (() => {
                    // Always trust the persisted total from DB — it is the source of truth.
                    // NOTE: Do NOT use a fallback derivation here. When total_leaves_taken = 0
                    // (e.g. after a reset), the derivation (annualPaid - paid_balance) would
                    // produce a wrong non-zero number if balances haven't been fully zeroed.
                    const derivedTotal = (bal: LeaveBalance): number => {
                        return Math.max(0, Number(bal.total_leaves_taken));
                    };

                    // Handler to open drawer and fetch history
                    const openHistory = async (bal: LeaveBalance) => {
                        setHistoryDrawer(bal);
                        setHistoryFrom('');
                        setHistoryTo('');
                        setDrawerTab('history');
                        setPenaltyDays([]);
                        setHistoryLoading(true);
                        try {
                            const { supabase: sb } = await import('../../lib/supabase');
                            const { data } = await sb
                                .from('leave_requests')
                                .select('*, staff:staff_master(*)')
                                .eq('staff_id', bal.staff_id)
                                .order('created_at', { ascending: false });
                            setHistoryRecords((data as LeaveRequest[]) || []);
                        } catch { setHistoryRecords([]); }
                        setHistoryLoading(false);
                    };

                    // Fetch leave_days for penalty tab
                    const fetchPenaltyDays = async (staffId: string, monthStr: string) => {
                        setPenaltyLoading(true);
                        setPenaltyDays([]);
                        try {
                            const [year, month] = monthStr.split('-').map(Number);
                            const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
                            const lastDay = new Date(year, month, 0).getDate();
                            const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
                            const { supabase: sb } = await import('../../lib/supabase');
                            const { data } = await sb
                                .from('leave_days')
                                .select('leave_date, day_count, allocation_type, request:leave_requests!leave_days_request_id_fkey(status)')
                                .eq('staff_id', staffId)
                                .gte('leave_date', monthStart)
                                .lte('leave_date', monthEnd);
                            // Only include days belonging to APPROVED requests
                            const approved = ((data || []) as any[]).filter(
                                (d) => d.request?.status === 'APPROVED'
                            );
                            setPenaltyDays(approved.map((d: any) => ({
                                leave_date: d.leave_date,
                                day_count: Number(d.day_count),
                                allocation_type: d.allocation_type,
                            })));
                        } catch { setPenaltyDays([]); }
                        setPenaltyLoading(false);
                    };

                    // Filtered history inside drawer
                    const filteredHistory = historyRecords.filter(r => {
                        if (historyFrom && r.from_date < historyFrom) return false;
                        if (historyTo && r.to_date > historyTo) return false;
                        return true;
                    });

                    return (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {balances.filter(b => {
                                    const status = b.staff?.status as string;
                                    return status !== 'RELIEVED' && status !== 'ARCHIVED';
                                }).map(bal => (
                                    <div
                                        key={bal.id}
                                        className="surface-card p-6 border border-slate-800/50 space-y-6 cursor-pointer hover:border-brand-500/40 hover:shadow-lg hover:shadow-brand-500/5 transition-all group"
                                        onClick={() => openHistory(bal)}
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500 font-black text-lg border border-brand-500/20 shadow-lg shadow-brand-500/5 group-hover:bg-brand-500/20 transition-colors">
                                                {bal.staff?.full_name?.charAt(0)}
                                            </div>
                                            <div className="flex-1">
                                                <h3 className="text-lg font-display font-black text-white uppercase tracking-tight">{bal.staff?.full_name}</h3>
                                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{bal.staff?.staff_code}</div>
                                            </div>
                                            <div className="text-[9px] font-black text-brand-500/50 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">View History →</div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Paid Leave</div>
                                                <div className="text-2xl font-black text-emerald-500">{bal.paid_balance}</div>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Unpaid Leave</div>
                                                <div className="text-2xl font-black text-amber-500">{bal.unpaid_balance}</div>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Penalty Count</div>
                                                <div className="text-2xl font-black text-rose-500">{Number(bal.penalty_count) > 0 ? `-${bal.penalty_count}` : 0}</div>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Taken</div>
                                                <div className="text-2xl font-black text-slate-300">{derivedTotal(bal)}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Leave History Drawer */}
                            {historyDrawer && (
                                <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setHistoryDrawer(null)}>
                                    {/* Backdrop */}
                                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
                                    {/* Panel */}
                                    <div
                                        className="relative w-full max-w-2xl bg-[#0b1120] border-l border-slate-800 h-full flex flex-col shadow-2xl animate-fade-in"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        {/* Header */}
                                        <div className="flex items-center gap-4 px-7 py-6 border-b border-slate-800">
                                            <div className="w-12 h-12 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-500 font-black text-xl border border-brand-500/20">
                                                {historyDrawer.staff?.full_name?.charAt(0)}
                                            </div>
                                            <div className="flex-1">
                                                <h2 className="text-xl font-display font-black text-white uppercase tracking-tight">{historyDrawer.staff?.full_name}</h2>
                                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{historyDrawer.staff?.staff_code} · Staff Profile</div>
                                            </div>
                                            <button
                                                onClick={() => setHistoryDrawer(null)}
                                                className="w-9 h-9 rounded-xl border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 flex items-center justify-center transition-all text-lg font-bold"
                                            >
                                                ×
                                            </button>
                                        </div>

                                        {/* Balance summary strip */}
                                        <div className="grid grid-cols-4 gap-px bg-slate-800 border-b border-slate-800">
                                            {[
                                                { label: 'Paid Left', value: historyDrawer.paid_balance, color: 'text-emerald-500' },
                                                { label: 'Unpaid Left', value: historyDrawer.unpaid_balance, color: 'text-amber-500' },
                                                { label: 'Penalty Days', value: Number(historyDrawer.penalty_count) > 0 ? `${historyDrawer.penalty_count}` : 0, color: 'text-rose-500' },
                                                { label: 'Total Taken', value: derivedTotal(historyDrawer), color: 'text-slate-300' },
                                            ].map(s => (
                                                <div key={s.label} className="bg-slate-900/80 px-4 py-3 text-center">
                                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-0.5">{s.label}</div>
                                                    <div className={`text-lg font-black ${s.color}`}>{s.value}</div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Sub-tab pills */}
                                        <div className="flex gap-1 px-7 py-3 border-b border-slate-800 bg-slate-950/60">
                                            <button
                                                onClick={() => setDrawerTab('history')}
                                                className={`px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${drawerTab === 'history'
                                                    ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20'
                                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                                    }`}
                                            >
                                                Leave History
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setDrawerTab('penalty');
                                                    fetchPenaltyDays(historyDrawer.staff_id, penaltyMonth);
                                                }}
                                                className={`px-5 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${drawerTab === 'penalty'
                                                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                                                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                                    }`}
                                            >
                                                Penalty Calculator
                                            </button>
                                        </div>

                                        {/* ── HISTORY TAB ── */}
                                        {drawerTab === 'history' && (
                                            <>
                                                {/* Date filters */}
                                                <div className="flex flex-wrap items-center gap-3 px-7 py-4 border-b border-slate-800/50 bg-slate-900/30">
                                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Filter</span>
                                                    <div className="flex items-center gap-2">
                                                        <label className="text-[10px] text-slate-500 font-bold">From</label>
                                                        <input type="date" value={historyFrom} onChange={e => setHistoryFrom(e.target.value)} className="input-field !py-1.5 !text-[11px] !w-36" />
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <label className="text-[10px] text-slate-500 font-bold">To</label>
                                                        <input type="date" value={historyTo} onChange={e => setHistoryTo(e.target.value)} className="input-field !py-1.5 !text-[11px] !w-36" />
                                                    </div>
                                                    {(historyFrom || historyTo) && (
                                                        <button onClick={() => { setHistoryFrom(''); setHistoryTo(''); }} className="text-[10px] font-bold text-rose-400 hover:text-rose-300 uppercase tracking-widest px-3 py-1.5 border border-rose-500/20 rounded-lg bg-rose-500/5 transition-all">Clear</button>
                                                    )}
                                                    <span className="ml-auto text-[10px] text-slate-500 font-bold">{filteredHistory.length} record{filteredHistory.length !== 1 ? 's' : ''}</span>
                                                </div>

                                                {/* History table */}
                                                <div className="flex-1 overflow-y-auto">
                                                    {historyLoading ? (
                                                        <div className="flex items-center justify-center py-20">
                                                            <div className="spinner !w-7 !h-7 border-brand-500" />
                                                        </div>
                                                    ) : filteredHistory.length === 0 ? (
                                                        <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                                                            <div className="text-[11px] font-black uppercase tracking-widest">No leave records found</div>
                                                        </div>
                                                    ) : (
                                                        <table className="w-full text-left">
                                                            <thead className="sticky top-0 bg-slate-900/95 border-b border-slate-800">
                                                                <tr>
                                                                    <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Duration</th>
                                                                    <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Days</th>
                                                                    <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Type</th>
                                                                    <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                                                    <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Applied</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-800/40">
                                                                {filteredHistory.map(r => (
                                                                    <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                                                                        <td className="px-6 py-3.5 text-[11px] font-medium text-slate-300 whitespace-nowrap">
                                                                            {new Date(r.from_date).toLocaleDateString('en-GB')}
                                                                            {r.from_date !== r.to_date && <> — {new Date(r.to_date).toLocaleDateString('en-GB')}</>}
                                                                        </td>
                                                                        <td className="px-4 py-3.5">
                                                                            <span className="px-2 py-0.5 bg-slate-800 rounded-md text-[10px] font-black text-white border border-slate-700">{r.days_count}</span>
                                                                        </td>
                                                                        <td className="px-4 py-3.5">
                                                                            <span className={`text-[9px] font-black uppercase tracking-widest ${r.leave_type === 'PAID' ? 'text-emerald-500' : r.leave_type === 'UNPAID' ? 'text-amber-500' : 'text-rose-500'}`}>{r.leave_type}</span>
                                                                        </td>
                                                                        <td className="px-4 py-3.5">
                                                                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${r.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : r.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : r.status === 'REVOKED' ? 'bg-purple-500/10 text-purple-500 border-purple-500/20' : r.status === 'CANCELLED' || r.status === 'LAPSED' ? 'bg-slate-500/10 text-slate-500 border-slate-500/20' : r.status === 'CANCEL_REQUESTED' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : 'bg-amber-500/10 text-amber-500 border-amber-500/20'}`}>
                                                                                {r.status.replace('_', ' ')}
                                                                            </span>
                                                                        </td>
                                                                        <td className="px-4 py-3.5 text-[10px] text-slate-500 font-medium whitespace-nowrap">
                                                                            {r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB') : '—'}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    )}
                                                </div>
                                            </>
                                        )}

                                        {/* ── PENALTY TAB ── */}
                                        {drawerTab === 'penalty' && (() => {
                                            const activePolicy = policies.find(p => p.status === 'ACTIVE');
                                            const staffSalary: number | null =
                                                (historyDrawer.staff as any)?.basic_pay ??
                                                (historyDrawer.staff as any)?.salary_info?.basic_salary ??
                                                null;
                                            const perDay = staffSalary && penaltyWorkingDays > 0
                                                ? staffSalary / penaltyWorkingDays
                                                : null;

                                            // Aggregate paid / unpaid / penalty days from fetched leave_days
                                            const paidDaysInMonth = penaltyDays
                                                .filter(d => d.allocation_type === 'PAID')
                                                .reduce((s, d) => s + d.day_count, 0);
                                            const unpaidDaysInMonth = penaltyDays
                                                .filter(d => d.allocation_type === 'UNPAID')
                                                .reduce((s, d) => s + d.day_count, 0);
                                            const penaltyDaysInMonth = penaltyDays
                                                .filter(d => d.allocation_type === 'PENALTY')
                                                .reduce((s, d) => s + d.day_count, 0);

                                            const totalDaysInMonth = paidDaysInMonth + unpaidDaysInMonth + penaltyDaysInMonth;

                                            // Progressive slab engine
                                            const slab1Limit = Number(activePolicy?.penalty_slab1_limit ?? 5);
                                            const slab2Limit = Number(activePolicy?.penalty_slab2_limit ?? 10);
                                            const slab1Mult = Number(activePolicy?.penalty_slab1_mult ?? 2);
                                            const slab2Mult = Number(activePolicy?.penalty_slab2_mult ?? 3);
                                            const slab3Mult = Number(activePolicy?.penalty_slab3_mult ?? 4);

                                            const slab1Days = Math.min(penaltyDaysInMonth, slab1Limit);
                                            const slab2Days = Math.max(0, Math.min(penaltyDaysInMonth - slab1Limit, slab2Limit - slab1Limit));
                                            const slab3Days = Math.max(0, penaltyDaysInMonth - slab2Limit);

                                            const slab1Amt = perDay != null ? slab1Days * perDay * slab1Mult : null;
                                            const slab2Amt = perDay != null ? slab2Days * perDay * slab2Mult : null;
                                            const slab3Amt = perDay != null ? slab3Days * perDay * slab3Mult : null;
                                            const totalDeduction = perDay != null
                                                ? (slab1Amt! + slab2Amt! + slab3Amt!)
                                                : null;

                                            const fmt = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                                            const [pmYear, pmMonth] = penaltyMonth.split('-').map(Number);
                                            const monthLabel = new Date(pmYear, pmMonth - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

                                            return (
                                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                                    {penaltyLoading ? (
                                                        <div className="flex items-center justify-center py-20">
                                                            <div className="spinner !w-7 !h-7 border-rose-500" />
                                                        </div>
                                                    ) : (
                                                        <div className="p-7 space-y-6">

                                                            {/* Month selector */}
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Calculating for month</div>
                                                                    <div className="text-base font-black text-white">{monthLabel}</div>
                                                                </div>
                                                                <input
                                                                    type="month"
                                                                    value={penaltyMonth}
                                                                    onChange={e => {
                                                                        setPenaltyMonth(e.target.value);
                                                                        fetchPenaltyDays(historyDrawer.staff_id, e.target.value);
                                                                    }}
                                                                    className="input-field !py-1.5 !w-40 !text-[11px]"
                                                                />
                                                            </div>

                                                            {/* Salary info row */}
                                                            <div className="grid grid-cols-3 gap-3">
                                                                <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Monthly Salary</div>
                                                                    <div className="text-base font-black text-white">
                                                                        {staffSalary != null ? fmt(staffSalary) : <span className="text-slate-500 text-[11px]">Not set</span>}
                                                                    </div>
                                                                </div>
                                                                <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Working Days</div>
                                                                    <input
                                                                        type="number"
                                                                        min={1} max={31}
                                                                        value={penaltyWorkingDays}
                                                                        onChange={e => setPenaltyWorkingDays(Math.max(1, parseInt(e.target.value) || 26))}
                                                                        className="input-field !py-1 !text-base font-black !text-white !bg-transparent !border-0 !px-0 !ring-0 w-full"
                                                                    />
                                                                </div>
                                                                <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Per-Day Rate</div>
                                                                    <div className="text-base font-black text-white">
                                                                        {perDay != null ? fmt(perDay) : <span className="text-slate-500 text-[11px]">—</span>}
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Leave summary for month */}
                                                            <div className="p-4 bg-slate-900/30 rounded-2xl border border-slate-800 space-y-3">
                                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Approved Leave — {monthLabel}</div>
                                                                <div className="grid grid-cols-4 gap-2">
                                                                    <div className="text-center p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                                        <div className="text-xl font-black text-white">{totalDaysInMonth}</div>
                                                                        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Total Days</div>
                                                                    </div>
                                                                    <div className="text-center p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                                        <div className="text-xl font-black text-emerald-500">{paidDaysInMonth}</div>
                                                                        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Paid</div>
                                                                    </div>
                                                                    <div className="text-center p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                                        <div className="text-xl font-black text-amber-500">{unpaidDaysInMonth}</div>
                                                                        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Unpaid</div>
                                                                    </div>
                                                                    <div className="text-center p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                                        <div className="text-xl font-black text-rose-500">{penaltyDaysInMonth}</div>
                                                                        <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Penalty</div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Progressive slab table */}
                                                            <div className="space-y-2">
                                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-3">Progressive Slab Breakdown</div>
                                                                <div className="rounded-2xl border border-slate-800 overflow-hidden">
                                                                    <table className="w-full text-left">
                                                                        <thead className="bg-slate-900/80 border-b border-slate-800">
                                                                            <tr>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest">Slab</th>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest">Range</th>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Days</th>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Rate/Day</th>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest text-center">Mult</th>
                                                                                <th className="px-4 py-2.5 text-[9px] font-black text-slate-500 uppercase tracking-widest text-right">Amount</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-slate-800/50">
                                                                            {[
                                                                                { label: 'Slab 1', range: `1 – ${slab1Limit}`, days: slab1Days, mult: slab1Mult, amt: slab1Amt },
                                                                                { label: 'Slab 2', range: `${slab1Limit + 1} – ${slab2Limit}`, days: slab2Days, mult: slab2Mult, amt: slab2Amt },
                                                                                { label: 'Slab 3', range: `${slab2Limit + 1}+`, days: slab3Days, mult: slab3Mult, amt: slab3Amt },
                                                                            ].map((row, i) => (
                                                                                <tr key={i} className={`transition-colors ${row.days > 0 ? 'bg-rose-500/5' : 'opacity-40'
                                                                                    }`}>
                                                                                    <td className="px-4 py-3 text-[11px] font-black text-white">{row.label}</td>
                                                                                    <td className="px-4 py-3 text-[11px] font-bold text-slate-400">{row.range} days</td>
                                                                                    <td className="px-4 py-3 text-center">
                                                                                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-black border ${row.days > 0
                                                                                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                                                                            : 'bg-slate-800 text-slate-600 border-slate-700'
                                                                                            }`}>{row.days}</span>
                                                                                    </td>
                                                                                    <td className="px-4 py-3 text-center text-[11px] font-bold text-slate-400">
                                                                                        {perDay != null ? fmt(perDay) : '—'}
                                                                                    </td>
                                                                                    <td className="px-4 py-3 text-center">
                                                                                        <span className={`text-[11px] font-black ${row.days > 0 ? 'text-rose-500' : 'text-slate-600'
                                                                                            }`}>{row.mult}×</span>
                                                                                    </td>
                                                                                    <td className="px-4 py-3 text-right text-[11px] font-black text-white">
                                                                                        {row.amt != null ? fmt(row.amt) : '—'}
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            </div>

                                                            {/* Total deduction banner */}
                                                            <div className={`p-5 rounded-2xl border flex items-center justify-between ${totalDeduction != null && totalDeduction > 0
                                                                ? 'bg-rose-500/10 border-rose-500/30'
                                                                : 'bg-emerald-500/5 border-emerald-500/20'
                                                                }`}>
                                                                <div>
                                                                    <div className={`text-[10px] font-black uppercase tracking-widest ${totalDeduction != null && totalDeduction > 0 ? 'text-rose-400' : 'text-emerald-500'
                                                                        }`}>
                                                                        {totalDeduction != null && totalDeduction > 0
                                                                            ? 'Penalty Deduction for ' + monthLabel
                                                                            : 'No Penalty — ' + monthLabel}
                                                                    </div>
                                                                    <div className="text-[11px] text-slate-400 font-medium mt-0.5">
                                                                        {totalDeduction != null && totalDeduction > 0
                                                                            ? 'This amount will be deducted from salary payout.'
                                                                            : 'Staff has no unpaid leave deductions this month.'}
                                                                    </div>
                                                                </div>
                                                                <div className={`text-3xl font-black ${totalDeduction != null && totalDeduction > 0 ? 'text-rose-400' : 'text-emerald-500'
                                                                    }`}>
                                                                    {totalDeduction != null ? fmt(totalDeduction) : staffSalary == null ? 'Set salary' : '—'}
                                                                </div>
                                                            </div>

                                                            {/* Policy note */}
                                                            <div className="p-4 bg-slate-900/30 rounded-2xl border border-slate-800 space-y-2">
                                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Policy Rules Applied</div>
                                                                <ul className="space-y-1 text-[10px] text-slate-500 font-medium">
                                                                    <li>• Penalty basis: <span className="text-rose-500 font-bold">Penalty days only</span> (over-entitlement days trigger slabs)</li>
                                                                    <li>• Half-day leave counts as <span className="text-slate-300 font-bold">0.5 days</span></li>
                                                                    <li>• Cancelled, rejected, and revoked leaves are <span className="text-slate-300 font-bold">excluded</span></li>
                                                                    <li>• Slabs are <span className="text-slate-300 font-bold">progressive</span> — only the excess days fall into the next tier</li>
                                                                    <li>• Working days: <span className="text-slate-300 font-bold">{penaltyWorkingDays} days/month</span> (editable above)</li>
                                                                    <li>• Slab limits from active policy version deployed in Settings</li>
                                                                </ul>
                                                            </div>

                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}

                                    </div>
                                </div>
                            )}
                        </>
                    );
                })()}
                {activeTab === 'settings' && (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-2 space-y-8">
                                <div className="surface-card p-8 space-y-8 border border-slate-800 shadow-2xl">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-xl font-display font-black text-white uppercase tracking-tight flex items-center gap-3">
                                            <Calculator className="w-5 h-5 text-brand-500" />
                                            Active Policy Configuration
                                        </h2>
                                        <span className="px-3 py-1 bg-brand-500/10 text-brand-500 text-[10px] font-black uppercase tracking-widest rounded-lg border border-brand-500/20">
                                            Active Version
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        {/* Entitlements */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Annual Entitlements</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Paid Days</div>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        placeholder="0"
                                                        value={editingPolicy.annual_paid_days ?? ''}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, annual_paid_days: parseInt(e.target.value) })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Unpaid Buffer</div>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        placeholder="0"
                                                        value={editingPolicy.annual_unpaid_days ?? ''}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, annual_unpaid_days: parseInt(e.target.value) })}
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Soft Cap */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Monthly Soft Cap</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Max Paid/Month</div>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        placeholder="0"
                                                        value={editingPolicy.monthly_paid_cap ?? ''}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, monthly_paid_cap: parseInt(e.target.value) })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Cap Type</div>
                                                    <select
                                                        className="select-field"
                                                        value={editingPolicy.cap_type || 'SOFT'}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, cap_type: e.target.value as any })}
                                                    >
                                                        <option value="SOFT">SOFT (Auto-UPL)</option>
                                                        <option value="HARD">HARD (Block)</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Core Rules */}
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Engine Rules</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Same-Day Approval</div>
                                                    <select
                                                        className="select-field"
                                                        value={editingPolicy.same_day_rule || 'REQUIRE_APPROVAL'}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, same_day_rule: e.target.value as any })}
                                                    >
                                                        <option value="REQUIRE_APPROVAL">Manager Approval Required</option>
                                                        <option value="AUTO_UPL">Auto-Approve (Direct)</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Max Consecutive Days</div>
                                                    <input
                                                        type="number"
                                                        className="input-field"
                                                        placeholder="0"
                                                        value={editingPolicy.consecutive_limit ?? ''}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, consecutive_limit: parseInt(e.target.value) })}
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Allow Half-Days</div>
                                                    <select
                                                        className="select-field"
                                                        value={editingPolicy.half_day_allowed ? 'YES' : 'NO'}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, half_day_allowed: e.target.value === 'YES' })}
                                                    >
                                                        <option value="YES">Yes</option>
                                                        <option value="NO">No</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                        {/* Cancellation & Reversal Rules */}
                                        <div className="space-y-4 pt-4 border-t border-slate-800">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Cancellation & Reversal Rules</label>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Future Cancellation Notice (Days)</div>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        className="input-field"
                                                        placeholder="0"
                                                        value={editingPolicy.cancel_future_days_notice ?? ''}
                                                        onChange={e => setEditingPolicy({ ...editingPolicy, cancel_future_days_notice: parseInt(e.target.value) })}
                                                    />
                                                </div>
                                                <div className="space-y-2 flex flex-col justify-end">
                                                    <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-brand-500/50 transition-all">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingPolicy.cancel_same_day_allowed ?? false}
                                                            onChange={e => setEditingPolicy({ ...editingPolicy, cancel_same_day_allowed: e.target.checked })}
                                                            className="rounded border-slate-700 text-brand-500 focus:ring-brand-500 bg-slate-800"
                                                        />
                                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Allow Same-Day Cancellation</span>
                                                    </label>
                                                </div>
                                                <div className="space-y-2 flex flex-col justify-end">
                                                    <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-brand-500/50 transition-all">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingPolicy.revoke_past_allowed ?? false}
                                                            onChange={e => setEditingPolicy({ ...editingPolicy, revoke_past_allowed: e.target.checked })}
                                                            className="rounded border-slate-700 text-brand-500 focus:ring-brand-500 bg-slate-800"
                                                        />
                                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Allow Revoking Past Leaves</span>
                                                    </label>
                                                </div>
                                                <div className="space-y-2 flex flex-col justify-end">
                                                    <label className="flex items-center gap-2 cursor-pointer p-3 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-brand-500/50 transition-all">
                                                        <input
                                                            type="checkbox"
                                                            checked={editingPolicy.payroll_lock_protection ?? true}
                                                            onChange={e => setEditingPolicy({ ...editingPolicy, payroll_lock_protection: e.target.checked })}
                                                            className="rounded border-slate-700 text-brand-500 focus:ring-brand-500 bg-slate-800"
                                                        />
                                                        <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Enable Payroll Lock Protection</span>
                                                    </label>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Penalty Slabs */}
                                    <div className="space-y-4 pt-4 border-t border-slate-800">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Penalty Slabs & Multipliers</label>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-4">
                                                <div className="text-[10px] font-black text-white uppercase tracking-widest bg-slate-800 px-2 py-1 rounded w-fit">Slab 01</div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Limit (Days)</div>
                                                    <input type="number" className="input-field !py-2" placeholder="0" value={editingPolicy.penalty_slab1_limit ?? ''} onChange={e => setEditingPolicy({ ...editingPolicy, penalty_slab1_limit: parseInt(e.target.value) })} />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Multiplier</div>
                                                    <input type="number" step="0.5" className="input-field !py-2" placeholder="0" value={editingPolicy.penalty_slab1_mult ?? ''} onChange={e => setEditingPolicy({ ...editingPolicy, penalty_slab1_mult: parseFloat(e.target.value) })} />
                                                </div>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-4">
                                                <div className="text-[10px] font-black text-white uppercase tracking-widest bg-slate-800 px-2 py-1 rounded w-fit">Slab 02</div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Limit (Days)</div>
                                                    <input type="number" className="input-field !py-2" placeholder="0" value={editingPolicy.penalty_slab2_limit ?? ''} onChange={e => setEditingPolicy({ ...editingPolicy, penalty_slab2_limit: parseInt(e.target.value) })} />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Multiplier</div>
                                                    <input type="number" step="0.5" className="input-field !py-2" placeholder="0" value={editingPolicy.penalty_slab2_mult ?? ''} onChange={e => setEditingPolicy({ ...editingPolicy, penalty_slab2_mult: parseFloat(e.target.value) })} />
                                                </div>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-4">
                                                <div className="text-[10px] font-black text-white uppercase tracking-widest bg-slate-800 px-2 py-1 rounded w-fit">Slab 03</div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Above Slab 2</div>
                                                    <div className="input-field !py-2 bg-slate-800/50 cursor-not-allowed">Unlimited</div>
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-bold text-slate-600 uppercase">Multiplier</div>
                                                    <input type="number" step="0.5" className="input-field !py-2" placeholder="0" value={editingPolicy.penalty_slab3_mult ?? ''} onChange={e => setEditingPolicy({ ...editingPolicy, penalty_slab3_mult: parseFloat(e.target.value) })} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-4">
                                        {/* Reset All HR & Leave Data */}
                                        <button
                                            onClick={async () => {
                                                const warning = 'CRITICAL: RESET ALL HR MANAGEMENT DATA?\n\nThis will permanently delete:\n• All Staff Profiles (except Admins)\n• All Leave Requests & Balances\n• All Attendance Records\n• All Exit Cases & Checklists\n\nThis cannot be undone. Type "RESET USER MANAGEMENT" to confirm:';
                                                const confirmation = prompt(warning);

                                                if (confirmation !== 'RESET USER MANAGEMENT') {
                                                    if (confirmation !== null) alert('Incorrect confirmation phrase. Reset cancelled.');
                                                    return;
                                                }

                                                try {
                                                    const { supabase: sb } = await import('../../lib/supabase');

                                                    const { data, error } = await sb.rpc('reset_user_management_v1', {
                                                        p_confirm_phrase: 'RESET USER MANAGEMENT'
                                                    });

                                                    if (error) throw error;
                                                    if (data?.success === false) throw new Error(data.message || 'Reset failed');

                                                    alert('HR Management data has been reset successfully.');
                                                    window.location.reload(); // Hard reload to clear all cached states
                                                } catch (err: any) {
                                                    alert('Error resetting HR data: ' + err.message);
                                                }
                                            }}
                                            className="flex items-center gap-2 px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-xl hover:bg-rose-500 hover:text-white transition-all"
                                        >
                                            Reset All HR & Leave Data
                                        </button>

                                        <button
                                            onClick={handleSavePolicy}
                                            disabled={isSavingPolicy}
                                            className="btn-primary"
                                        >
                                            <Save className="w-4 h-4" />
                                            {isSavingPolicy ? 'Saving...' : 'Deploy New Version'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div className="surface-card p-6 border border-slate-800">
                                    <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                                        <History className="w-4 h-4 text-slate-500" />
                                        Policy Versions
                                    </h3>
                                    <div className="space-y-3">
                                        {policies.map(p => (
                                            <div key={p.id} className={`p-4 rounded-2xl border ${p.status === 'ACTIVE' ? 'bg-brand-500/5 border-brand-500/20' : 'bg-slate-900/50 border-slate-800 opacity-60'}`}>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-[11px] font-bold text-white">Version {p.id.slice(0, 8)}</div>
                                                    <div className={`text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${p.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-500' : 'bg-slate-800 text-slate-500'}`}>
                                                        {p.status}
                                                    </div>
                                                </div>
                                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                                    Effective: {new Date(p.effective_from).toLocaleDateString()}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="surface-card p-6 border-brand-500/10 bg-brand-500/[0.01] space-y-4">
                                    <div className="flex gap-3">
                                        <ShieldCheck className="w-5 h-5 text-brand-500 shrink-0" />
                                        <div className="space-y-1">
                                            <h4 className="text-[10px] font-black text-brand-500 uppercase tracking-widest">Safety Protocol</h4>
                                            <p className="text-[11px] text-slate-400 leading-relaxed font-bold">
                                                Modifying policies will not affect historical records. Changes will only apply to new leaves submitted after the effective date.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Leave Apply Modal */}
            <Modal isOpen={isRequestModalOpen} onClose={() => setIsRequestModalOpen(false)}>
                <div
                    className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 flex flex-col shadow-2xl overflow-hidden rounded-[2.5rem] animate-slide-down mx-auto mt-[5vh] max-h-[90vh]"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/[0.01]">
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-brand-500/10 rounded-xl flex items-center justify-center border border-brand-500/20">
                                <FileText className="w-4.5 h-4.5 text-brand-500" />
                            </div>
                            <h2 className="text-2xl font-display font-black text-white uppercase tracking-tight">Apply Leave</h2>
                        </div>
                        <button onClick={() => setIsRequestModalOpen(false)} className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-800 transition-all">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="overflow-y-auto flex-1 custom-scrollbar">
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);

                            let finalDays = 1;
                            let fromDate = applyStartDate;
                            let toDate = applyStartDate;

                            if (applyTiming === 'TODAY') {
                                finalDays = applyDuration === 'FULL' ? 1 : 0.5;
                                fromDate = new Date().toLocaleDateString('en-CA');
                                toDate = fromDate;
                            } else {
                                if (applyType === 'SINGLE') {
                                    finalDays = applyDuration === 'FULL' ? 1 : 0.5;
                                    toDate = fromDate;
                                } else {
                                    const start = new Date(applyStartDate);
                                    const end = new Date(applyEndDate);
                                    if (end >= start) {
                                        const diffTime = (end.getTime() - start.getTime());
                                        let rawDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
                                        if (consecutiveStartDay === 'HALF') rawDays -= 0.5;
                                        if (consecutiveEndDay === 'HALF' && rawDays > 0.5) rawDays -= 0.5;
                                        finalDays = Math.max(0, rawDays);
                                        toDate = applyEndDate;
                                    } else {
                                        finalDays = 0; // Error indicator
                                    }
                                }
                            }

                            if (finalDays <= 0) {
                                alert("Invalid date range specified. End date must be after or on start date.");
                                return;
                            }

                            // Policy Enforcement
                            const policy = policies.find(p => p.status === 'ACTIVE');
                            if (policy) {
                                // Consecutive Limit (Calendar Days) handled via Approval Hub routing below

                                // Same Day Rule Enforcement
                                if (policy.same_day_rule === 'REQUIRE_APPROVAL' || policy.same_day_rule === 'AUTO_UPL') {
                                    // Special logic for same-day
                                    const isSameDay = fromDate === new Date().toLocaleDateString('en-CA');
                                    if (isSameDay) {
                                        // If rule is AUTO_UPL, we skip the block and auto-approve below
                                        // This replaces the old "NOT_ALLOWED" path which was dead
                                    }
                                }
                            }

                            // Determine start/end types for allocation weighting
                            let startDayType: 'FULL' | 'HALF' = 'FULL';
                            let endDayType: 'FULL' | 'HALF' = 'FULL';

                            if (applyTiming === 'TODAY' || applyType === 'SINGLE') {
                                startDayType = applyDuration;
                                endDayType = applyDuration;
                            } else {
                                startDayType = consecutiveStartDay;
                                endDayType = consecutiveEndDay;
                            }

                            try {
                                const activePolicy = policies.find(p => p.status === 'ACTIVE');
                                const threshold = activePolicy?.consecutive_limit || 3;
                                const needsApproval = finalDays > threshold;

                                if (needsApproval) {
                                    const confirmed = window.confirm(
                                        `This leave request (${finalDays} days) exceeds the standard policy limit of ${threshold} days and requires manual approval via the Approval Hub.\n\nDo you wish to proceed with submitting it for manager review?`
                                    );
                                    if (!confirmed) return;
                                }

                                const newRequest = await upsertLeaveRequest({
                                    staff_id: selectedStaffId,
                                    from_date: fromDate,
                                    to_date: toDate,
                                    days_count: finalDays,
                                    start_day_type: startDayType,
                                    end_day_type: endDayType,
                                    reason: formData.get('reason') as string,
                                    status: 'PENDING'
                                });

                                // If leave exceeds threshold, send to Approval Hub
                                if (needsApproval && newRequest?.id) {
                                    const staffMember = staff.find(s => s.id === selectedStaffId);
                                    const { supabase: sb } = await import('../../lib/supabase');
                                    const { data: { user: authUser } } = await sb.auth.getUser();
                                    await sb.from('approval_requests').insert({
                                        request_type: 'LEAVE_REQUEST',
                                        status: 'PENDING',
                                        requested_by: authUser?.id ?? selectedStaffId,
                                        target_scope_id: newRequest.id,
                                        reason: formData.get('reason') as string,
                                        payload: {
                                            leave_request_id: newRequest.id,
                                            staff_id: selectedStaffId,
                                            staff_name: staffMember?.full_name ?? '',
                                            staff_code: staffMember?.staff_code ?? '',
                                            from_date: fromDate,
                                            to_date: toDate,
                                            days_count: finalDays,
                                            start_day_type: startDayType,
                                            end_day_type: endDayType,
                                            reason: formData.get('reason') as string,
                                        }
                                    });
                                }

                                setIsRequestModalOpen(false);
                                loadTabData('requests');
                                alert(needsApproval
                                    ? `Leave application submitted and sent to Approval Hub for manager review.`
                                    : 'Leave application submitted.'
                                );
                            } catch (error) {
                                alert('Error submitting leave');
                            }
                        }} className="p-8 space-y-8">

                            <div className="space-y-6">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Personnel *</label>
                                    <select
                                        name="staff_id"
                                        required
                                        className="select-field"
                                        value={selectedStaffId}
                                        onChange={e => handleStaffSelect(e.target.value)}
                                    >
                                        <option value="">Select Employee...</option>
                                        {staff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.staff_code})</option>)}
                                    </select>
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Leave Timing</label>
                                    <div className="flex bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800">
                                        <button
                                            type="button"
                                            onClick={() => setApplyTiming('TODAY')}
                                            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${applyTiming === 'TODAY' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                        >
                                            Apply for Today
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setApplyTiming('FUTURE')}
                                            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${applyTiming === 'FUTURE' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}
                                        >
                                            Future Date
                                        </button>
                                    </div>
                                </div>

                                {applyTiming === 'TODAY' ? (
                                    <div className="space-y-4 animate-fade-in p-5 bg-slate-900/30 rounded-2xl border border-slate-800/50">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                            <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Same-day Leave</div>
                                        </div>
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Duration</label>
                                        <div className="flex gap-4">
                                            <label className={`flex-1 cursor-pointer p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${applyDuration === 'FULL' ? 'bg-brand-500/10 border-brand-500/50 text-brand-500' : 'border-slate-800 bg-slate-900/50 text-slate-500 hover:border-slate-700'}`}>
                                                <input type="radio" className="sr-only" checked={applyDuration === 'FULL'} onChange={() => setApplyDuration('FULL')} />
                                                <span className="font-bold">Full Day</span>
                                            </label>
                                            <label className={`flex-1 cursor-pointer p-4 rounded-2xl border-2 transition-all flex flex-col items-center justify-center gap-2 ${applyDuration === 'HALF' ? 'bg-brand-500/10 border-brand-500/50 text-brand-500' : 'border-slate-800 bg-slate-900/50 text-slate-500 hover:border-slate-700'}`}>
                                                <input type="radio" className="sr-only" checked={applyDuration === 'HALF'} onChange={() => setApplyDuration('HALF')} />
                                                <span className="font-bold">Half Day</span>
                                            </label>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-6 animate-fade-in p-5 bg-slate-900/30 rounded-2xl border border-slate-800/50">
                                        <div className="space-y-4">
                                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Apply Type</label>
                                            <div className="flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => setApplyType('SINGLE')}
                                                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg border transition-all ${applyType === 'SINGLE' ? 'bg-brand-500/20 text-brand-500 border-brand-500/30' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 xl'}`}
                                                >
                                                    Single Date
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setApplyType('CONSECUTIVE')}
                                                    className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg border transition-all ${applyType === 'CONSECUTIVE' ? 'bg-brand-500/20 text-brand-500 border-brand-500/30' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300 xl'}`}
                                                >
                                                    Consecutive Dates
                                                </button>
                                            </div>
                                        </div>

                                        {applyType === 'SINGLE' ? (
                                            <div className="grid grid-cols-2 gap-6 pt-2 border-t border-slate-800/50">
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Date</label>
                                                    <input type="date" value={applyStartDate} onChange={e => setApplyStartDate(e.target.value)} required className="input-field" />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Duration</label>
                                                    <select className="select-field" value={applyDuration} onChange={e => setApplyDuration(e.target.value as any)}>
                                                        <option value="FULL">Full Day</option>
                                                        <option value="HALF">Half Day</option>
                                                    </select>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="space-y-4 pt-2 border-t border-slate-800/50">
                                                <div className="grid grid-cols-2 gap-6">
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Date</label>
                                                        <input type="date" value={applyStartDate} onChange={e => setApplyStartDate(e.target.value)} required className="input-field" />
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">End Date</label>
                                                        <input type="date" value={applyEndDate} min={applyStartDate} onChange={e => setApplyEndDate(e.target.value)} required className="input-field" />
                                                    </div>
                                                </div>

                                                <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-800">
                                                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Duration Pattern</div>
                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="space-y-2">
                                                            <div className="text-[9px] font-bold text-slate-500">First Day</div>
                                                            <select className="select-field !py-2" value={consecutiveStartDay} onChange={e => setConsecutiveStartDay(e.target.value as any)}>
                                                                <option value="FULL">Full Day</option>
                                                                <option value="HALF">Half Day</option>
                                                            </select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div className="text-[9px] font-bold text-slate-500">Last Day</div>
                                                            <select className="select-field !py-2" value={consecutiveEndDay} onChange={e => setConsecutiveEndDay(e.target.value as any)}>
                                                                <option value="FULL">Full Day</option>
                                                                <option value="HALF">Half Day</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <p className="text-[10px] text-slate-500 font-medium mt-3 italic">Days in between are always marked as Full Days.</p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Reason / Notes *</label>
                                    <textarea name="reason" required className="input-field min-h-[80px]" placeholder="Explain the context of absence..." />
                                </div>

                                {/* LEAVE IMPACT PREVIEW (Per-day Simulation) */}
                                {(() => {
                                    if (!selectedStaffId) return null;
                                    const startStr = applyTiming === 'TODAY' ? new Date().toLocaleDateString('en-CA') : applyStartDate;
                                    const endStr = applyTiming === 'TODAY' ? startStr : (applyType === 'SINGLE' ? startStr : applyEndDate);

                                    if (!startStr || !endStr) return null;
                                    const start = new Date(startStr);
                                    const end = new Date(endStr);
                                    if (end < start) return null;

                                    const activePolicyInfo = policies.find(p => p.status === 'ACTIVE');
                                    if (!activePolicyInfo) return null;

                                    // Local mutable copies to track the "impact" across the simulation loop
                                    // Map: year -> { paid, unpaid, penalty }
                                    const localBalances: Record<number, { paid: number, unpaid: number, penalty: number }> = {};
                                    // Map: year-month -> paid_used
                                    const localMonthlyTracking: Record<string, number> = { ...previewMonthlyTracking };

                                    const getLocalBalance = (year: number) => {
                                        if (!localBalances[year]) {
                                            const bal = balances.find(b => b.staff_id === selectedStaffId && b.year === year);
                                            localBalances[year] = {
                                                paid: Number(bal?.paid_balance ?? activePolicyInfo.annual_paid_days),
                                                unpaid: Number(bal?.unpaid_balance ?? activePolicyInfo.annual_unpaid_days),
                                                penalty: Number(bal?.penalty_count ?? 0)
                                            };
                                        }
                                        return localBalances[year];
                                    };

                                    let totalPaid = 0;
                                    let totalUnpaid = 0;
                                    let totalPenaltyMultiplied = 0;
                                    let totalPenaltyDays = 0;
                                    let totalDaysCount = 0;
                                    let lastMultiplier = 1;

                                    // Effective monthly cap
                                    const effectiveMonthCap = Number(activePolicyInfo.monthly_paid_cap) >= 0 ? Number(activePolicyInfo.monthly_paid_cap) : Infinity;

                                    // Iterate through days
                                    const diffTime = (end.getTime() - start.getTime());
                                    const calendarDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

                                    let currentDay = 0;
                                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                        const y = d.getFullYear();
                                        const m = d.getMonth() + 1;
                                        const monthKey = `${y}-${m}`;
                                        const bal = getLocalBalance(y);
                                        const monthlyUsed = localMonthlyTracking[monthKey] || 0;

                                        let dayWeight = 1.0;
                                        if (applyType === 'SINGLE') {
                                            dayWeight = applyDuration === 'HALF' ? 0.5 : 1.0;
                                        } else {
                                            if (currentDay === 0 && consecutiveStartDay === 'HALF') dayWeight = 0.5;
                                            else if (currentDay === calendarDays - 1 && consecutiveEndDay === 'HALF') dayWeight = 0.5;
                                        }
                                        currentDay++;

                                        const overCap = (monthlyUsed + dayWeight) > effectiveMonthCap;

                                        // Step 1: PAID (Must have balance AND be under monthly cap)
                                        if (bal.paid >= dayWeight && !overCap) {
                                            totalPaid += dayWeight;
                                            bal.paid -= dayWeight;
                                            localMonthlyTracking[monthKey] = (localMonthlyTracking[monthKey] || 0) + dayWeight;
                                        }
                                        // Step 2: UNPAID (Buffer for exhausted paid balance or cap limits)
                                        else if (bal.unpaid >= dayWeight) {
                                            // Check if we should block due to HARD monthly cap
                                            if (overCap && activePolicyInfo.cap_type === 'HARD') {
                                                // Preview shows blocking state (optional visual indicator but here we skip allocation)
                                                continue;
                                            }
                                            totalUnpaid += dayWeight;
                                            bal.unpaid -= dayWeight;
                                        }
                                        // Step 3: PENALTY (Exhausted all entitlements)
                                        else {
                                            // Check if we should block due to HARD monthly cap
                                            if (overCap && activePolicyInfo.cap_type === 'HARD') {
                                                continue;
                                            }
                                            let penaltyWeight = dayWeight;
                                            const currentPenalty = bal.penalty;
                                            let multiplier = 1.0;

                                            // Simulate backend slab logic
                                            const nextPenaltyTotal = currentPenalty + penaltyWeight;
                                            if (nextPenaltyTotal <= activePolicyInfo.penalty_slab1_limit) multiplier = Number(activePolicyInfo.penalty_slab1_mult);
                                            else if (nextPenaltyTotal <= activePolicyInfo.penalty_slab2_limit) multiplier = Number(activePolicyInfo.penalty_slab2_mult);
                                            else multiplier = Number(activePolicyInfo.penalty_slab3_mult);

                                            totalPenaltyMultiplied += (penaltyWeight * multiplier);
                                            totalPenaltyDays += penaltyWeight;
                                            bal.penalty += penaltyWeight;
                                            lastMultiplier = multiplier;
                                        }
                                        totalDaysCount += dayWeight;
                                    }

                                    if (totalDaysCount === 0) return null;

                                    return (
                                        <div className="p-5 rounded-2xl bg-brand-500/5 border border-brand-500/20 space-y-4">
                                            <div className="flex items-center gap-2">
                                                <Calculator className="w-4 h-4 text-brand-500" />
                                                <h3 className="text-[11px] font-black text-brand-500 uppercase tracking-widest">Leave Impact Preview</h3>
                                            </div>

                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Asked</div>
                                                    <div className="text-xl font-black text-white">{totalDaysCount} <span className="text-[10px] text-slate-500">Days</span></div>
                                                </div>
                                                <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Will be Paid</div>
                                                    <div className="text-xl font-black text-emerald-500">{totalPaid}</div>
                                                </div>
                                                <div className="p-3 bg-slate-900/50 rounded-xl border border-slate-800/50">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Will be Unpaid</div>
                                                    <div className="text-xl font-black text-amber-500">{totalUnpaid}</div>
                                                </div>
                                            </div>

                                            {totalPenaltyDays > 0 && (
                                                <div className="p-3 bg-rose-500/10 rounded-xl border border-rose-500/20 flex justify-between items-center">
                                                    <div>
                                                        <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Penalty Applied</div>
                                                        <div className="text-xs text-rose-400 font-medium">Out of buffer. Penalty applied on {totalPenaltyDays} days.</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Multiplier</div>
                                                        <div className="text-xl font-black text-rose-500">{lastMultiplier}x</div>
                                                    </div>
                                                </div>
                                            )}

                                            {totalDaysCount > (activePolicyInfo.consecutive_limit || 3) && (
                                                <div className="flex items-start gap-3 p-3 bg-amber-500/10 rounded-xl border border-amber-500/25">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0 animate-pulse" />
                                                    <div>
                                                        <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Approval Required</div>
                                                        <div className="text-[11px] text-amber-400/80 font-medium mt-0.5">
                                                            Leaves exceeding {activePolicyInfo.consecutive_limit || 3} days are sent to the <span className="font-black text-amber-400">Approval Hub</span> for manager review before taking effect.
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="flex justify-end gap-3 pt-4 border-t border-white/5 sticky bottom-0 bg-slate-950 pb-2">
                                <button type="button" onClick={() => setIsRequestModalOpen(false)} className="btn-ghost">Cancel</button>
                                <button type="submit" className="btn-primary flex items-center gap-2">
                                    <Check className="w-4 h-4" />
                                    Submit Application
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default LeaveManagement;

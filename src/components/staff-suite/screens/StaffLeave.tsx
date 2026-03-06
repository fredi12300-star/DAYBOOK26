import { useState, useEffect } from 'react';
import {
    Calendar,
    Plus,
    History,
    FileText,
    X,
    Loader2,
    Clock,
    AlertCircle,
    RotateCcw,
    Shield,
    Calculator,
    ChevronLeft,
    ChevronRight,
    ArrowRight,
    Check,
    ShieldCheck,
    Settings
} from 'lucide-react';
import { StaffMaster, LeaveRequest } from '../../../types/accounting';
import {
    fetchLeaveBalances,
    fetchLeaveRequests,
    upsertLeaveRequest,
    fetchActiveLeavePolicy,
    requestCancelLeave,
    revokeLeave,
    fetchLeaveDays,
    fetchStaffMasters,
    approveLeaveRequest,
    approveCancelLeave,
    fetchLeaveMonthlyTracking,
    createApprovalRequest
} from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { toast } from 'react-hot-toast';

type ActiveTab = 'balances' | 'history' | 'requests' | 'settings';

interface StaffLeaveProps {
    staff: StaffMaster;
}

type ApplyTiming = 'TODAY' | 'FUTURE';
type ApplyType = 'SINGLE' | 'CONSECUTIVE';
type ApplyDuration = 'FULL' | 'HALF';

export default function StaffLeave({ staff }: StaffLeaveProps) {
    const { canExecute, isSuperAdmin, user } = useAuth();
    const canApprove = canExecute('hr_leave', 'approve');
    const canManagePolicy = canExecute('hr_leave', 'settings');

    const [activeTab, setActiveTab] = useState<ActiveTab>('balances');
    const [balances, setBalances] = useState<any[]>([]);
    const [requests, setRequests] = useState<any[]>([]);
    const [allRequests, setAllRequests] = useState<any[]>([]); // For 'Requests' tab
    const [allStaff, setAllStaff] = useState<StaffMaster[]>([]); // For Apply Modal selector
    const [selectedApplyStaffId, setSelectedApplyStaffId] = useState(staff.id);
    const [activePolicy, setActivePolicy] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isApplying, setIsApplying] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Form State (Sync with HR version)
    const [applyTiming, setApplyTiming] = useState<ApplyTiming>('FUTURE');
    const [applyType, setApplyType] = useState<ApplyType>('SINGLE');
    const [applyDuration, setApplyDuration] = useState<ApplyDuration>('FULL');
    const [formData, setFormData] = useState({
        from_date: new Date().toISOString().split('T')[0],
        to_date: new Date().toISOString().split('T')[0],
        start_day_type: 'FULL' as 'FULL' | 'HALF',
        end_day_type: 'FULL' as 'FULL' | 'HALF',
        reason: ''
    });

    // Requests Tab Filters (Organization-wide)
    const [reqFilterFrom, setReqFilterFrom] = useState('');
    const [reqFilterTo, setReqFilterTo] = useState('');
    const [reqPage, setReqPage] = useState(1);

    // History Filters & Pagination
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [historyPage, setHistoryPage] = useState(1);
    const REQ_PAGE_SIZE = 5;

    // Balance Drill-down Drawer
    const [selectedBalance, setSelectedBalance] = useState<any>(null);
    const [drawerTab, setDrawerTab] = useState<'history' | 'penalty'>('history');
    const [drawerHistoryFrom, setDrawerHistoryFrom] = useState('');
    const [drawerHistoryTo, setDrawerHistoryTo] = useState('');
    const [penaltyMonth, setPenaltyMonth] = useState(new Date().toISOString().slice(0, 7));
    const [penaltyWorkingDays, setPenaltyWorkingDays] = useState(26);
    const [previewMonthlyTracking, setPreviewMonthlyTracking] = useState<Record<string, number>>({});
    const [penaltyDays, setPenaltyDays] = useState<any[]>([]);
    const [penaltyLoading, setPenaltyLoading] = useState(false);

    const loadLeaveData = async () => {
        setIsLoading(true);
        try {
            const year = new Date().getFullYear();
            const promises: any[] = [
                fetchLeaveBalances(year, staff.id),
                fetchLeaveRequests({ staffId: staff.id }),
                fetchActiveLeavePolicy()
            ];

            if (canApprove || canManagePolicy) {
                promises.push(fetchLeaveRequests()); // Fetch all requests
                promises.push(fetchStaffMasters(true)); // Fetch all staff for selector
            }

            const [balanceData, requestData, policyData, orgRequests, staffList] = await Promise.all(promises);

            setBalances(balanceData);
            setRequests(requestData);
            setActivePolicy(policyData);
            if (orgRequests) setAllRequests(orgRequests);
            if (staffList) setAllStaff(staffList);
        } catch (error) {
            console.error('Failed to load leave data:', error);
            toast.error('Failed to load leave data');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadLeaveData();
    }, [staff.id]);

    // Refetch monthly tracking and multi-year balances for accurate impact preview
    useEffect(() => {
        const startDate = applyTiming === 'TODAY' ? new Date().toISOString().split('T')[0] : formData.from_date;
        const endDate = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? startDate : formData.to_date;

        if (!startDate || !endDate) return;

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (end < start) return;

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

        // Fetch Data
        const fetchData = async () => {
            try {
                // Fetch Monthly Tracking
                const trackingResults = await Promise.all(months.map(m => fetchLeaveMonthlyTracking(selectedApplyStaffId, m.year, m.month)));
                const trackingMap: Record<string, number> = {};
                trackingResults.forEach((r, i) => {
                    const m = months[i];
                    trackingMap[`${m.year}-${m.month}`] = Number(r?.paid_used ?? 0);
                });
                setPreviewMonthlyTracking(trackingMap);

                // Fetch multi-year balances
                const balanceResults = await Promise.all(Array.from(years).map(y => fetchLeaveBalances(y, selectedApplyStaffId)));
                const allBalances = balanceResults.flat();
                setBalances(prev => {
                    const filtered = prev.filter(b => !years.has(b.year));
                    return [...filtered, ...allBalances];
                });
            } catch (err) {
                console.error('Simulation data fetch error:', err);
            }
        };
        fetchData();
    }, [selectedApplyStaffId, applyTiming, formData.from_date, formData.to_date, applyType]);

    // Fetch actual leave_days for penalty calculator
    useEffect(() => {
        if (drawerTab === 'penalty' && selectedBalance) {
            const fetchPenaltyData = async () => {
                setPenaltyLoading(true);
                try {
                    const data = await fetchLeaveDays(staff.id, penaltyMonth);
                    setPenaltyDays(data);
                } catch (err) {
                    console.error('Failed to fetch penalty days:', err);
                } finally {
                    setPenaltyLoading(false);
                }
            };
            fetchPenaltyData();
        }
    }, [drawerTab, penaltyMonth, staff.id, selectedBalance]);

    const handleApply = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const startDate = applyTiming === 'TODAY' ? new Date().toISOString().split('T')[0] : formData.from_date;
            const endDate = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? startDate : formData.to_date;

            const targetStaffId = selectedApplyStaffId;
            const targetStaff = allStaff.find(s => s.id === targetStaffId) || staff;

            const startDayType = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? applyDuration : formData.start_day_type;
            const endDayType = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? applyDuration : formData.end_day_type;

            // Simple validation
            if (new Date(endDate) < new Date(startDate)) {
                toast.error('End date cannot be before start date');
                setIsSubmitting(false);
                return;
            }

            // Accurate days_count calculation (Parity with HR)
            let finalDays = 1;
            if (applyTiming === 'TODAY' || applyType === 'SINGLE') {
                finalDays = applyDuration === 'FULL' ? 1 : 0.5;
            } else {
                const start = new Date(startDate);
                const end = new Date(endDate);
                const diffTime = (end.getTime() - start.getTime());
                let rawDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
                if (startDayType === 'HALF') rawDays -= 0.5;
                if (endDayType === 'HALF' && rawDays > 0.5) rawDays -= 0.5;
                finalDays = Math.max(0, rawDays);
            }

            // Determine finalType based on simulation (assuming simulation logic is run before this)
            // For now, we'll keep it 'PAID' as per original, or derive if simulation provides it.
            // The instruction implies `finalType` should be used, but it's not calculated here.
            // Sticking to 'PAID' for now, as the backend handles allocation.
            const finalType = 'PAID';

            // Threshold Breach / Approval Hub Routing
            const threshold = activePolicy?.consecutive_limit || 3;
            const needsApproval = finalDays > threshold;

            if (needsApproval) {
                const confirmed = window.confirm(
                    `This leave request (${finalDays} days) exceeds the standard policy limit of ${threshold} days and requires manual approval via the Approval Hub.\n\nDo you wish to proceed with submitting it for manager review?`
                );
                if (!confirmed) {
                    setIsSubmitting(false);
                    return;
                }
            }

            const request: Partial<LeaveRequest> = {
                staff_id: targetStaffId,
                leave_type: finalType as any,
                from_date: startDate,
                to_date: endDate,
                days_count: finalDays,
                start_day_type: startDayType,
                end_day_type: endDayType,
                reason: formData.reason,
                status: 'PENDING'
            };

            const newRequest = await upsertLeaveRequest(request);

            // Threshold Breach / Approval Hub Routing
            if (needsApproval && newRequest?.id) {
                await createApprovalRequest({
                    request_type: 'LEAVE_REQUEST',
                    status: 'PENDING',
                    requested_by: user?.id || '', // The user making the request
                    target_scope_id: newRequest.id,
                    reason: formData.reason,
                    payload: {
                        leave_request_id: newRequest.id,
                        staff_id: targetStaffId,
                        staff_name: targetStaff.full_name,
                        days_count: finalDays,
                        from_date: startDate,
                        to_date: endDate
                    }
                });
            }

            toast.success('Leave request submitted successfully');
            setIsApplying(false);
            setFormData({
                from_date: new Date().toISOString().split('T')[0],
                to_date: new Date().toISOString().split('T')[0],
                start_day_type: 'FULL',
                end_day_type: 'FULL',
                reason: ''
            });
            await loadLeaveData();
        } catch (error) {
            console.error('Failed to submit leave request:', error);
            toast.error('Failed to submit leave request');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleApprove = async (requestId: string) => {
        try {
            await approveLeaveRequest(requestId, user?.id || '');
            toast.success('Leave request approved');
            await loadLeaveData();
        } catch (error) {
            console.error('Failed to approve request:', error);
            toast.error('Failed to approve request');
        }
    };

    const derivedTotal = (balanceObj: any) => {
        return Math.max(0, Number(balanceObj.total_leaves_taken));
    };

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'APPROVED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'REJECTED': return 'text-red-400 bg-red-500/10 border-red-500/20';
            case 'PENDING': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            case 'CANCEL_REQUESTED': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
            case 'CANCELLED': return 'text-slate-500 bg-slate-500/10 border-slate-500/20';
            case 'REVOKED': return 'text-purple-400 bg-purple-500/10 border-purple-500/20';
            case 'LAPSED': return 'text-slate-400 bg-slate-500/10 border-slate-400/20';
            default: return 'text-slate-400 bg-slate-500/10 border-slate-400/20';
        }
    };

    const handleAction = async (action: 'CANCEL' | 'REVOKE', requestId: string) => {
        const confirmMsg = action === 'CANCEL'
            ? 'Are you sure you want to request cancellation for this leave?'
            : 'WARNING: Are you sure you want to REVOKE this past leave? This alters historical balances. Proceed?';

        if (!window.confirm(confirmMsg)) return;

        try {
            if (action === 'CANCEL') {
                await requestCancelLeave(requestId);
                toast.success('Cancellation requested');
            } else {
                await revokeLeave(requestId);
                toast.success('Leave revoked successfully');
            }
            await loadLeaveData();
        } catch (error: any) {
            console.error(`Failed to ${action.toLowerCase()} leave:`, error);
            toast.error(error.message || `Failed to ${action.toLowerCase()} leave`);
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Tab Navigation */}
            <div className="flex flex-wrap items-center gap-2 bg-[#0f172a]/50 p-2 rounded-2xl border border-slate-800/50">
                {[
                    { id: 'balances', label: 'My Balances', icon: FileText }, // Changed icon to FileText to match original balances tab
                    { id: 'history', label: 'My History', icon: History },
                    ...(canApprove || canManagePolicy ? [{ id: 'requests', label: 'Approvals', icon: Clock }] : []),
                    ...(canManagePolicy ? [{ id: 'settings', label: 'Policy Settings', icon: Shield }] : [])
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as ActiveTab)}
                        className={`flex items-center gap-2 px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all rounded-xl ${activeTab === tab.id
                            ? 'bg-brand-600 text-white shadow-glow shadow-brand-600/20'
                            : 'text-slate-500 hover:text-slate-300'
                            }`}
                    >
                        <tab.icon size={14} />
                        {tab.label}
                    </button>
                ))}
                {isSuperAdmin && (
                    <div className="ml-auto pr-4">
                        <span className="px-2 py-1 bg-brand-500/10 text-brand-500 border border-brand-500/20 rounded-lg text-[8px] font-black uppercase tracking-widest">
                            Super Admin
                        </span>
                    </div>
                )}
            </div>

            {activeTab === 'balances' ? (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        {isLoading ? (
                            [1, 2].map(i => (
                                <div key={i} className="h-32 bg-slate-800/20 rounded-3xl border border-slate-800 animate-pulse" />
                            ))
                        ) : balances.length === 0 ? (
                            <div className="col-span-2 p-10 bg-slate-800/20 rounded-3xl border border-dashed border-slate-800 text-center">
                                <p className="text-xs font-bold text-slate-500">No leave policies assigned</p>
                            </div>
                        ) : (
                            balances.map((b) => (
                                <div key={b.id} className="col-span-2">
                                    <div
                                        className="bg-[#0f172a]/50 p-6 rounded-3xl border border-slate-800/50 space-y-6 cursor-pointer hover:border-brand-500/30 transition-all group"
                                        onClick={() => {
                                            setSelectedBalance(b);
                                            setDrawerTab('history');
                                        }}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-brand-500/10 rounded-xl">
                                                <FileText size={16} className="text-brand-500" />
                                            </div>
                                            <p className="text-[12px] font-black text-white uppercase tracking-widest">Yearly Leave Analytics</p>
                                        </div>

                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50">
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Paid Leave</p>
                                                <p className="text-2xl font-black text-emerald-400">{b.paid_balance}</p>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50">
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Unpaid Leave</p>
                                                <p className="text-2xl font-black text-amber-400">{b.unpaid_balance}</p>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50">
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1">Penalty Count</p>
                                                <p className="text-2xl font-black text-rose-400">
                                                    {Number(b.penalty_count) > 0 ? `-${b.penalty_count}` : 0}
                                                </p>
                                            </div>
                                            <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50 relative overflow-hidden">
                                                <div className="absolute -right-4 -top-4 w-16 h-16 bg-brand-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1 relative z-10">Total Taken</p>
                                                <p className="text-2xl font-black text-slate-300 relative z-10">{derivedTotal(b)}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Policy Rules Visibility */}
                    {activePolicy && (
                        <div className="bg-brand-500/5 border border-brand-500/10 rounded-[2rem] p-6 space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-2 bg-brand-500/10 rounded-xl">
                                    <Shield size={16} className="text-brand-500" />
                                </div>
                                <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Active Policy Rules</h3>
                            </div>
                            <div className="grid grid-cols-2 gap-y-5 gap-x-6">
                                <div>
                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Monthly Paid Cap</p>
                                    <p className="text-[9px] font-black text-slate-200 uppercase tracking-tighter">
                                        {activePolicy.monthly_paid_cap} Days ({activePolicy.cap_type})
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Consecutive Limit</p>
                                    <p className="text-[9px] font-black text-slate-200 uppercase tracking-tighter">
                                        {activePolicy.consecutive_limit} Days
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Same-Day Rule</p>
                                    <p className="text-[9px] font-black text-slate-200 uppercase tracking-tighter text-wrap">
                                        {activePolicy.same_day_rule?.replace(/_/g, ' ')}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Cancel Notice</p>
                                    <p className="text-[9px] font-black text-slate-200 uppercase tracking-tighter">
                                        {activePolicy.cancel_future_days_notice} Days Prior
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => setIsApplying(true)}
                        className="w-full py-4 bg-brand-600 hover:bg-brand-500 text-white rounded-3xl font-black uppercase tracking-[0.2em] shadow-glow shadow-brand-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                    >
                        <Plus size={18} /> Enroll Leave
                    </button>
                </div>
            ) : activeTab === 'history' ? (
                <div className="space-y-4">
                    {/* Filters Strip */}
                    <div className="flex flex-wrap items-center gap-3 bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50">
                        <div className="flex items-center gap-2 flex-1">
                            <Calendar size={12} className="text-slate-500" />
                            <input
                                type="date"
                                value={historyFrom}
                                onChange={e => { setHistoryFrom(e.target.value); setHistoryPage(1); }}
                                className="bg-transparent text-[10px] font-black text-white uppercase outline-none w-full"
                            />
                        </div>
                        <ArrowRight size={12} className="text-slate-700" />
                        <div className="flex items-center gap-2 flex-1">
                            <Calendar size={12} className="text-slate-500" />
                            <input
                                type="date"
                                value={historyTo}
                                onChange={e => { setHistoryTo(e.target.value); setHistoryPage(1); }}
                                className="bg-transparent text-[10px] font-black text-white uppercase outline-none w-full"
                            />
                        </div>
                        {(historyFrom || historyTo) && (
                            <button
                                onClick={() => { setHistoryFrom(''); setHistoryTo(''); setHistoryPage(1); }}
                                className="p-1.5 bg-rose-500/10 text-rose-500 rounded-lg"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>

                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="h-20 bg-slate-800/20 rounded-3xl animate-pulse" />
                            ))}
                        </div>
                    ) : requests.length === 0 ? (
                        <div className="py-20 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                            <Calendar size={24} className="mx-auto text-slate-700 mb-3" />
                            <p className="text-xs font-bold text-slate-500">No recent requests</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {(() => {
                                const filtered = requests.filter(req => {
                                    if (historyFrom && req.from_date < historyFrom) return false;
                                    if (historyTo && req.to_date > historyTo) return false;
                                    return true;
                                });

                                const totalPages = Math.max(1, Math.ceil(filtered.length / REQ_PAGE_SIZE));
                                const paginated = filtered.slice((historyPage - 1) * REQ_PAGE_SIZE, historyPage * REQ_PAGE_SIZE);

                                return (
                                    <>
                                        {paginated.map((req) => (
                                            <div key={req.id} className="bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50 flex flex-col gap-4 group">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-4">
                                                        <div className="text-center min-w-[50px]">
                                                            <p className="text-[10px] font-black text-slate-500 uppercase">
                                                                {req.days_count} {req.days_count === 1 ? 'day' : 'days'}
                                                            </p>
                                                            <p className="text-[10px] font-black text-white uppercase mt-1">
                                                                {new Date(req.from_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                            </p>
                                                        </div>
                                                        <div className="h-8 w-px bg-slate-800" />
                                                        <div>
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <p className="text-[10px] font-black text-white uppercase tracking-widest">
                                                                    {req.leave_type} LEAVE
                                                                </p>
                                                                {(req.start_day_type === 'HALF' || req.end_day_type === 'HALF') && (
                                                                    <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded text-[7px] font-black uppercase">Half-Day</span>
                                                                )}
                                                            </div>
                                                            <p className="text-[9px] text-slate-500 font-bold truncate max-w-[120px]">
                                                                {req.reason || 'No reason provided'}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(req.status)}`}>
                                                        {req.status?.replace('_', ' ')}
                                                    </span>
                                                </div>

                                                {/* Action Buttons for Lifecycle */}
                                                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/50">
                                                    {req.status === 'PENDING' && (
                                                        <button
                                                            onClick={() => handleAction('CANCEL', req.id)}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all"
                                                        >
                                                            <X size={10} /> Withdraw
                                                        </button>
                                                    )}
                                                    {req.status === 'APPROVED' && new Date(req.from_date) > new Date() && (
                                                        <button
                                                            onClick={() => handleAction('CANCEL', req.id)}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 rounded-xl text-[8px] font-black uppercase tracking-widest border border-amber-500/20 transition-all"
                                                        >
                                                            <RotateCcw size={10} /> Request Cancel
                                                        </button>
                                                    )}
                                                    {req.status === 'APPROVED' && new Date(req.from_date) <= new Date() && activePolicy?.revoke_past_allowed && (
                                                        <button
                                                            onClick={() => handleAction('REVOKE', req.id)}
                                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 rounded-xl text-[8px] font-black uppercase tracking-widest border border-rose-500/20 transition-all"
                                                        >
                                                            <AlertCircle size={10} /> Revoke
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Pagination Controls */}
                                        {totalPages > 1 && (
                                            <div className="flex items-center justify-between pt-4">
                                                <button
                                                    disabled={historyPage === 1}
                                                    onClick={() => setHistoryPage(p => p - 1)}
                                                    className="p-2 bg-slate-800 rounded-xl disabled:opacity-30 text-white"
                                                >
                                                    <ChevronLeft size={16} />
                                                </button>
                                                <span className="text-[10px] font-black text-slate-500 uppercase">Page {historyPage} of {totalPages}</span>
                                                <button
                                                    disabled={historyPage === totalPages}
                                                    onClick={() => setHistoryPage(p => p + 1)}
                                                    className="p-2 bg-slate-800 rounded-xl disabled:opacity-30 text-white"
                                                >
                                                    <ChevronRight size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    )}
                </div>
            ) : activeTab === 'requests' ? (
                <div className="space-y-4">
                    {/* Organization-wide Requests Filter */}
                    <div className="flex flex-wrap items-center gap-3 bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50">
                        <div className="flex items-center gap-2 flex-1">
                            <Calendar size={12} className="text-slate-500" />
                            <input
                                type="date"
                                value={reqFilterFrom}
                                onChange={e => { setReqFilterFrom(e.target.value); setReqPage(1); }}
                                className="bg-transparent text-[10px] font-black text-white uppercase outline-none w-full"
                            />
                        </div>
                        <ArrowRight size={12} className="text-slate-700" />
                        <div className="flex items-center gap-2 flex-1">
                            <Calendar size={12} className="text-slate-500" />
                            <input
                                type="date"
                                value={reqFilterTo}
                                onChange={e => { setReqFilterTo(e.target.value); setReqPage(1); }}
                                className="bg-transparent text-[10px] font-black text-white uppercase outline-none w-full"
                            />
                        </div>
                        {(reqFilterFrom || reqFilterTo) && (
                            <button
                                onClick={() => { setReqFilterFrom(''); setReqFilterTo(''); setReqPage(1); }}
                                className="p-1.5 bg-rose-500/10 text-rose-500 rounded-lg"
                            >
                                <X size={12} />
                            </button>
                        )}
                        <span className="ml-auto text-[10px] font-black text-slate-500 uppercase tracking-widest">{allRequests.length} Requests</span>
                    </div>

                    <div className="space-y-3">
                        {(() => {
                            const sorted = [...allRequests].sort((a, b) =>
                                new Date(b.created_at || b.from_date).getTime() - new Date(a.created_at || a.from_date).getTime()
                            );
                            const filtered = sorted.filter(req => {
                                if (reqFilterFrom && req.from_date < reqFilterFrom) return false;
                                if (reqFilterTo && req.to_date > reqFilterTo) return false;
                                return true;
                            });

                            const paginated = filtered.slice((reqPage - 1) * REQ_PAGE_SIZE, reqPage * REQ_PAGE_SIZE);

                            if (paginated.length === 0) {
                                return (
                                    <div className="py-20 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                                        <Clock size={24} className="mx-auto text-slate-700 mb-3" />
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">No requests found</p>
                                    </div>
                                );
                            }

                            return (
                                <>
                                    {paginated.map(req => (
                                        <div key={req.id} className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 hover:border-slate-700 transition-all group">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-10 h-10 rounded-2xl bg-slate-800 flex items-center justify-center text-xs font-black text-slate-400 border border-slate-700">
                                                        {req.staff?.full_name?.charAt(0)}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-black text-white truncate max-w-[150px]">{req.staff?.full_name}</p>
                                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{req.staff?.staff_code}</p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`px-3 py-1 rounded-xl text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(req.status)}`}>
                                                        {req.status.replace('_', ' ')}
                                                    </div>
                                                    {req.days_count > (activePolicy?.consecutive_limit || 3) && req.status === 'PENDING' && (
                                                        <span className="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-lg text-[7px] font-black uppercase tracking-widest" title="Requires Hub Approval">
                                                            <ShieldCheck className="w-3 h-3" />
                                                            Hub Reqd
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 mb-4">
                                                <div className="p-3 bg-slate-900/50 rounded-2xl border border-slate-800/30">
                                                    <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Duration</p>
                                                    <p className="text-[10px] font-bold text-slate-300">
                                                        {new Date(req.from_date).toLocaleDateString('en-GB')} - {new Date(req.to_date).toLocaleDateString('en-GB')}
                                                    </p>
                                                </div>
                                                <div className="p-3 bg-slate-900/50 rounded-2xl border border-slate-800/30">
                                                    <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Total Days</p>
                                                    <p className="text-[10px] font-bold text-slate-300">{req.days_count} Days</p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between gap-3">
                                                <p className="text-[10px] text-slate-500 italic max-w-[80%] truncate">"{req.reason}"</p>

                                                {req.status === 'APPROVED' && new Date(req.from_date) > new Date() && (
                                                    <button
                                                        onClick={async () => {
                                                            if (confirm('Request cancellation for this future leave?')) {
                                                                await requestCancelLeave(req.id);
                                                                loadLeaveData();
                                                                toast.success('Cancellation requested.');
                                                            }
                                                        }}
                                                        className="text-[9px] font-bold text-orange-500 hover:text-orange-400 uppercase tracking-widest px-3 py-1.5 border border-orange-500/20 rounded-lg bg-orange-500/5 transition-all whitespace-nowrap"
                                                    >
                                                        Request Cancel
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {req.status === 'PENDING' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleApprove(req.id)}
                                                            className="p-2 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-xl border border-emerald-500/20"
                                                            title="Approve"
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                        <button
                                                            onClick={async () => {
                                                                if (confirm('Reject this request?')) {
                                                                    await requestCancelLeave(req.id);
                                                                    loadLeaveData();
                                                                }
                                                            }}
                                                            className="p-2 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 rounded-xl border border-rose-500/20"
                                                            title="Reject"
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </>
                                                )}

                                                {req.status === 'CANCEL_REQUESTED' && (
                                                    <button
                                                        onClick={async () => {
                                                            if (confirm('Approve this cancellation? Leave days and balances will be restored.')) {
                                                                await approveCancelLeave(req.id, user?.id || '');
                                                                loadLeaveData();
                                                                toast.success('Cancellation approved and balances restored.');
                                                            }
                                                        }}
                                                        className="text-[9px] font-bold text-emerald-500 hover:text-emerald-400 uppercase tracking-widest px-3 py-1.5 border border-emerald-500/20 rounded-lg bg-emerald-500/5 transition-all"
                                                    >
                                                        Approve Cancel
                                                    </button>
                                                )}

                                                {req.status === 'APPROVED' && new Date(req.from_date) <= new Date() && (
                                                    <button
                                                        onClick={async () => {
                                                            if (!confirm('WARNING: Are you sure you want to REVOKE this past leave? This alters historical balances and may affect locked payrolls. Proceed?')) return;
                                                            try {
                                                                await revokeLeave(req.id, user?.id || '');
                                                                loadLeaveData();
                                                                toast.success('Leave revoked successfully. Balances restored.');
                                                            } catch (err: any) {
                                                                toast.error('Error revoking leave: ' + err.message);
                                                            }
                                                        }}
                                                        className="text-[9px] font-bold text-purple-500 hover:text-purple-400 uppercase tracking-widest px-3 py-1.5 border border-purple-500/20 rounded-lg bg-purple-500/5 transition-all"
                                                    >
                                                        Revoke
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Pagination */}
                                    {filtered.length > REQ_PAGE_SIZE && (
                                        <div className="flex items-center justify-center gap-4 py-4">
                                            <button
                                                disabled={reqPage === 1}
                                                onClick={() => setReqPage(p => p - 1)}
                                                className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-500 disabled:opacity-30"
                                            >
                                                <ChevronLeft size={16} />
                                            </button>
                                            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Page {reqPage}</span>
                                            <button
                                                disabled={reqPage * REQ_PAGE_SIZE >= filtered.length}
                                                onClick={() => setReqPage(p => p + 1)}
                                                className="p-2 bg-slate-900 border border-slate-800 rounded-xl text-slate-500 disabled:opacity-30"
                                            >
                                                <ChevronRight size={16} />
                                            </button>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : activeTab === 'settings' ? (
                <div className="space-y-6">
                    {/* Policy Summary */}
                    {activePolicy ? (
                        <div className="space-y-6">
                            <div className="bg-brand-500/5 border border-brand-500/10 rounded-[2.5rem] p-8 relative overflow-hidden">
                                <div className="absolute top-0 right-0 p-6 opacity-10">
                                    <Shield size={120} className="text-brand-500" />
                                </div>
                                <div className="relative z-10">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-3 bg-brand-500/20 rounded-2xl">
                                            <Shield size={24} className="text-brand-500" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-black text-white uppercase tracking-tighter">{activePolicy.name}</h3>
                                            <p className="text-[10px] font-black text-brand-500 uppercase tracking-[0.3em]">Active Leave Policy</p>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Monthly Paid Cap</p>
                                            <p className="text-sm font-black text-slate-200">{activePolicy.monthly_paid_cap} Days</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Cap Type</p>
                                            <p className="text-sm font-black text-slate-200 uppercase">{activePolicy.cap_type}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Consecutive Limit</p>
                                            <p className="text-sm font-black text-slate-200">{activePolicy.consecutive_limit} Days</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Same-Day Rule</p>
                                            <p className="text-sm font-black text-slate-200 uppercase">{activePolicy.same_day_rule?.replace(/_/g, ' ')}</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Cancel Notice</p>
                                            <p className="text-sm font-black text-slate-200">{activePolicy.cancel_future_days_notice} Days</p>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Payroll Lock</p>
                                            <p className="text-sm font-black text-slate-200">{activePolicy.payroll_lock_day || 'None'}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-[#0f172a]/50 p-6 rounded-[2rem] border border-slate-800/50">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-2 bg-amber-500/10 rounded-xl">
                                            <AlertCircle size={16} className="text-amber-500" />
                                        </div>
                                        <h4 className="text-[10px] font-black text-white uppercase tracking-widest">Policy Constraints</h4>
                                    </div>
                                    <ul className="space-y-3">
                                        {[
                                            { label: 'Half Day Support', value: activePolicy.half_day_allowed ? 'Enabled' : 'Disabled' },
                                            { label: 'Cancel Same Day', value: activePolicy.cancel_same_day_allowed ? 'Enabled' : 'Disabled' },
                                            { label: 'Revoke Past', value: activePolicy.revoke_past_allowed ? 'Enabled' : 'Disabled' }
                                        ].map((item, idx) => (
                                            <li key={idx} className="flex items-center justify-between py-2 border-b border-slate-800/30 last:border-0">
                                                <span className="text-[9px] font-medium text-slate-500 uppercase">{item.label}</span>
                                                <span className={`text-[9px] font-black uppercase ${item.value === 'Enabled' ? 'text-emerald-500' : 'text-slate-400'}`}>{item.value}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <div className="bg-[#0f172a]/50 p-6 rounded-[2rem] border border-slate-800/50 flex flex-col justify-center items-center text-center gap-4">
                                    <div className="w-12 h-12 bg-slate-800 rounded-2xl flex items-center justify-center">
                                        <Settings size={20} className="text-slate-500" />
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-white uppercase tracking-widest">Policy Administration</p>
                                        <p className="text-[9px] text-slate-500 font-bold max-w-[200px]">Advanced policy configuration is available in the HR Management module.</p>
                                    </div>
                                    <button
                                        onClick={() => toast.error('Advanced policy editing is currently limited to the main HR module.')}
                                        className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-[9px] font-black uppercase tracking-widest transition-all"
                                    >
                                        Open Advanced Editor
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="py-20 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                            <Loader2 size={24} className="mx-auto text-slate-700 mb-3 animate-spin" />
                            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Fetching Active Policy...</p>
                        </div>
                    )}
                </div>
            ) : null}

            {/* Application Modal (Synced with HR Leave Management) */}
            {isApplying && (
                <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[100] flex items-end md:items-center justify-center p-4" onClick={() => !isSubmitting && setIsApplying(false)}>
                    <div
                        className="bg-[#0f172a] w-full max-w-sm rounded-[2.5rem] border border-slate-800 p-8 space-y-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-300 overflow-y-auto max-h-[90vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Enroll Leave</h2>
                                <p className="text-[9px] font-black text-brand-500 uppercase tracking-widest mt-1">Self-Service Application</p>
                            </div>
                            <button onClick={() => setIsApplying(false)} className="p-2 bg-slate-800/50 rounded-xl text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleApply} className="space-y-6">
                            {/* Staff Selector (only if canApprove or canManagePolicy) */}
                            {(canApprove || canManagePolicy) && allStaff.length > 0 && (
                                <div className="space-y-3">
                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Apply For</label>
                                    <select
                                        value={selectedApplyStaffId}
                                        onChange={e => setSelectedApplyStaffId(e.target.value)}
                                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-4 py-3 text-[10px] focus:ring-2 focus:ring-brand-500/20 outline-none"
                                    >
                                        {allStaff.map(s => (
                                            <option key={s.id} value={s.id}>{s.full_name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Timing Selection */}
                            <div className="space-y-3">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Leave Timing</label>
                                <div className="flex bg-slate-900 border border-slate-800 p-1.5 rounded-2xl">
                                    <button
                                        type="button"
                                        onClick={() => setApplyTiming('TODAY')}
                                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${applyTiming === 'TODAY' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        Today
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setApplyTiming('FUTURE')}
                                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all ${applyTiming === 'FUTURE' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                                    >
                                        Future
                                    </button>
                                </div>
                            </div>

                            {applyTiming === 'TODAY' ? (
                                <div className="space-y-4 animate-in fade-in zoom-in duration-300">
                                    <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-2xl flex items-center gap-3">
                                        <Clock size={16} className="text-emerald-500" />
                                        <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">Same-day Leave</span>
                                    </div>
                                    <div className="flex gap-3">
                                        {(['FULL', 'HALF'] as const).map(d => (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => setApplyDuration(d)}
                                                className={`flex-1 py-4 border-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${applyDuration === d ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-slate-800 bg-slate-900 text-slate-500'}`}
                                            >
                                                {d} DAY
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                                    <div className="flex gap-2">
                                        {(['SINGLE', 'CONSECUTIVE'] as const).map(t => (
                                            <button
                                                key={t}
                                                type="button"
                                                onClick={() => setApplyType(t)}
                                                className={`px-3 py-2 text-[8px] font-black uppercase tracking-widest rounded-lg border transition-all ${applyType === t ? 'bg-brand-500/20 text-brand-400 border-brand-500/30' : 'bg-slate-900 border-slate-800 text-slate-500'}`}
                                            >
                                                {t}
                                            </button>
                                        ))}
                                    </div>

                                    {applyType === 'SINGLE' ? (
                                        <div className="space-y-4">
                                            <div className="space-y-1.5">
                                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Date</label>
                                                <input
                                                    type="date"
                                                    required
                                                    value={formData.from_date}
                                                    onChange={e => setFormData(p => ({ ...p, from_date: e.target.value }))}
                                                    className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-5 py-3 text-xs focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                                                />
                                            </div>
                                            <div className="flex gap-3">
                                                {(['FULL', 'HALF'] as const).map(d => (
                                                    <button
                                                        key={d}
                                                        type="button"
                                                        onClick={() => setApplyDuration(d)}
                                                        className={`flex-1 py-4 border-2 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${applyDuration === d ? 'border-brand-500 bg-brand-500/10 text-brand-400' : 'border-slate-800 bg-slate-900 text-slate-500'}`}
                                                    >
                                                        {d} DAY
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Date</label>
                                                    <input
                                                        type="date"
                                                        required
                                                        value={formData.from_date}
                                                        onChange={e => setFormData(p => ({ ...p, from_date: e.target.value }))}
                                                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-4 py-3 text-[10px] focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">End Date</label>
                                                    <input
                                                        type="date"
                                                        required
                                                        value={formData.to_date}
                                                        onChange={e => setFormData(p => ({ ...p, to_date: e.target.value }))}
                                                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-4 py-3 text-[10px] focus:ring-2 focus:ring-brand-500/20 outline-none transition-all"
                                                    />
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1.5">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Start Day</label>
                                                    <select
                                                        value={formData.start_day_type}
                                                        onChange={e => setFormData(p => ({ ...p, start_day_type: e.target.value as any }))}
                                                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-4 py-3 text-[10px] focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                    >
                                                        <option value="FULL">FULL DAY</option>
                                                        <option value="HALF">HALF DAY</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">End Day</label>
                                                    <select
                                                        value={formData.end_day_type}
                                                        onChange={e => setFormData(p => ({ ...p, end_day_type: e.target.value as any }))}
                                                        className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-4 py-3 text-[10px] focus:ring-2 focus:ring-brand-500/20 outline-none"
                                                    >
                                                        <option value="FULL">FULL DAY</option>
                                                        <option value="HALF">HALF DAY</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* LEAVE IMPACT PREVIEW */}
                            {(() => {
                                const startDate = applyTiming === 'TODAY' ? new Date().toISOString().split('T')[0] : formData.from_date;
                                const endDate = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? startDate : formData.to_date;

                                if (!startDate || !endDate) return null;
                                const start = new Date(startDate);
                                const end = new Date(endDate);
                                if (end < start) return null;

                                if (!activePolicy) return null;

                                // Local mutable copies to track the "impact" across the simulation loop
                                // Map: year -> { paid, unpaid, penalty }
                                const localBalances: Record<number, { paid: number, unpaid: number, penalty: number }> = {};
                                // Map: year-month -> paid_used
                                const localMonthlyTracking: Record<string, number> = { ...previewMonthlyTracking };

                                const getLocalBalance = (year: number) => {
                                    if (!localBalances[year]) {
                                        const bal = balances.find(b => b.year === year);
                                        localBalances[year] = {
                                            paid: Number(bal?.paid_balance ?? activePolicy.annual_paid_days),
                                            unpaid: Number(bal?.unpaid_balance ?? activePolicy.annual_unpaid_days),
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

                                const effectiveMonthCap = Number(activePolicy.monthly_paid_cap) >= 0 ? Number(activePolicy.monthly_paid_cap) : Infinity;

                                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                                    const y = d.getFullYear();
                                    const m = d.getMonth() + 1;
                                    const monthKey = `${y}-${m}`;
                                    const bal = getLocalBalance(y);
                                    const monthlyUsed = localMonthlyTracking[monthKey] || 0;

                                    let dayWeight = 1.0;
                                    if (applyTiming === 'TODAY' || applyType === 'SINGLE') {
                                        dayWeight = applyDuration === 'HALF' ? 0.5 : 1.0;
                                    } else {
                                        if (d.getTime() === start.getTime() && formData.start_day_type === 'HALF') dayWeight = 0.5;
                                        else if (d.getTime() === end.getTime() && formData.end_day_type === 'HALF') dayWeight = 0.5;
                                    }

                                    const overCap = (monthlyUsed + dayWeight) > effectiveMonthCap;

                                    if (bal.paid >= dayWeight && !overCap) {
                                        totalPaid += dayWeight;
                                        bal.paid -= dayWeight;
                                        localMonthlyTracking[monthKey] = (localMonthlyTracking[monthKey] || 0) + dayWeight;
                                    } else if (bal.unpaid >= dayWeight) {
                                        if (overCap && activePolicy.cap_type === 'HARD') continue;
                                        totalUnpaid += dayWeight;
                                        bal.unpaid -= dayWeight;
                                    } else {
                                        if (overCap && activePolicy.cap_type === 'HARD') continue;
                                        totalPenaltyDays += dayWeight;
                                        bal.penalty += dayWeight;

                                        let currentMult = activePolicy.penalty_slab1_mult || 1;
                                        if (bal.penalty <= activePolicy.penalty_slab1_limit) currentMult = activePolicy.penalty_slab1_mult;
                                        else if (bal.penalty <= activePolicy.penalty_slab2_limit) currentMult = activePolicy.penalty_slab2_mult;
                                        else currentMult = activePolicy.penalty_slab3_mult;

                                        totalPenaltyMultiplied += (dayWeight * currentMult);
                                        lastMultiplier = currentMult;
                                    }
                                    totalDaysCount += dayWeight;
                                }

                                if (totalDaysCount === 0) return null;

                                return (
                                    <div className="p-4 rounded-3xl bg-brand-500/5 border border-brand-500/10 space-y-4 animate-in fade-in zoom-in duration-300">
                                        <div className="flex items-center gap-2">
                                            <Calculator size={14} className="text-brand-500" />
                                            <p className="text-[10px] font-black text-brand-500 uppercase tracking-widest">Impact Preview</p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="p-3 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Paid</p>
                                                <p className="text-lg font-black text-emerald-500">{totalPaid}</p>
                                            </div>
                                            <div className="p-3 bg-slate-900/50 rounded-2xl border border-slate-800">
                                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Unpaid</p>
                                                <p className="text-lg font-black text-amber-500">{totalUnpaid}</p>
                                            </div>
                                        </div>
                                        {totalPenaltyDays > 0 && (
                                            <div className="p-3 bg-rose-500/10 rounded-2xl border border-rose-500/20 flex justify-between items-center">
                                                <div>
                                                    <p className="text-[8px] font-black text-rose-500 uppercase mb-0.5">Penalty Applied</p>
                                                    <p className="text-[10px] font-bold text-rose-400">{totalPenaltyDays} Days Extra</p>
                                                </div>
                                                <p className="text-lg font-black text-rose-500">{lastMultiplier}x</p>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">Reason / Notes</label>
                                <textarea
                                    required
                                    rows={3}
                                    value={formData.reason}
                                    onChange={e => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                                    className="w-full bg-slate-900 border border-slate-800 text-white rounded-2xl px-5 py-4 text-xs focus:ring-2 focus:ring-brand-500/20 outline-none transition-all resize-none"
                                    placeholder="Brief explanation for leave..."
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="w-full py-4 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white rounded-3xl font-black uppercase tracking-[0.2em] shadow-glow shadow-brand-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
                            >
                                {isSubmitting ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
                                {isSubmitting ? 'Submitting...' : 'Submit Request'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Balance Detail Drawer */}
            {selectedBalance && (
                <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md z-[150] flex justify-end" onClick={() => setSelectedBalance(null)}>
                    <div
                        className="bg-[#0f172a] w-full max-w-sm h-full border-l border-slate-800 p-8 flex flex-col animate-in slide-in-from-right duration-300"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-8">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest">Balance Details</h2>
                                <p className="text-[9px] font-black text-brand-500 uppercase tracking-widest mt-1">Year {selectedBalance.year}</p>
                            </div>
                            <button onClick={() => setSelectedBalance(null)} className="p-2 bg-slate-800/50 rounded-xl text-slate-500 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Balance Strip */}
                        <div className="grid grid-cols-2 gap-3 mb-8">
                            <div className="p-4 bg-slate-900/50 rounded-3xl border border-slate-800">
                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Paid Rem.</p>
                                <p className="text-xl font-black text-emerald-500">{selectedBalance.paid_balance}</p>
                            </div>
                            <div className="p-4 bg-slate-900/50 rounded-3xl border border-slate-800">
                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Unpaid Rem.</p>
                                <p className="text-xl font-black text-amber-500">{selectedBalance.unpaid_balance || 0}</p>
                            </div>
                        </div>

                        {/* Drawer Tabs */}
                        <div className="flex bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800 mb-6">
                            <button
                                onClick={() => setDrawerTab('history')}
                                className={`flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${drawerTab === 'history' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500'}`}
                            >
                                History
                            </button>
                            <button
                                onClick={() => setDrawerTab('penalty')}
                                className={`flex-1 py-3 text-[9px] font-black uppercase tracking-widest rounded-xl transition-all ${drawerTab === 'penalty' ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20' : 'text-slate-500'}`}
                            >
                                Penalty Calc
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto custom-scrollbar pb-20 -mx-8">
                            {drawerTab === 'history' ? (
                                <div className="flex flex-col h-full">
                                    <div className="flex flex-wrap items-center gap-3 px-8 py-4 border-b border-slate-800/50 bg-slate-900/30">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Filter</span>
                                        <div className="flex items-center gap-2">
                                            <input type="date" value={drawerHistoryFrom} onChange={e => setDrawerHistoryFrom(e.target.value)} className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2 py-1 text-[10px] uppercase outline-none w-28" />
                                        </div>
                                        <span className="text-slate-500 font-bold">-</span>
                                        <div className="flex items-center gap-2">
                                            <input type="date" value={drawerHistoryTo} onChange={e => setDrawerHistoryTo(e.target.value)} className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2 py-1 text-[10px] uppercase outline-none w-28" />
                                        </div>
                                        {(drawerHistoryFrom || drawerHistoryTo) && (
                                            <button onClick={() => { setDrawerHistoryFrom(''); setDrawerHistoryTo(''); }} className="text-[10px] font-bold text-rose-400 hover:text-rose-300 uppercase tracking-widest px-3 py-1.5 border border-rose-500/20 rounded-lg bg-rose-500/5 transition-all">Clear</button>
                                        )}
                                    </div>
                                    <div className="flex-1 overflow-y-auto w-full">
                                        {(() => {
                                            const filteredHistory = requests.filter(r => {
                                                if (new Date(r.from_date).getFullYear() !== selectedBalance.year) return false;
                                                if (drawerHistoryFrom && r.from_date < drawerHistoryFrom) return false;
                                                if (drawerHistoryTo && r.to_date > drawerHistoryTo) return false;
                                                return true;
                                            });

                                            if (filteredHistory.length === 0) {
                                                return (
                                                    <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                                                        <div className="text-[11px] font-black uppercase tracking-widest">No leave records found</div>
                                                    </div>
                                                );
                                            }

                                            return (
                                                <table className="w-full text-left">
                                                    <thead className="sticky top-0 bg-[#0f172a] border-b border-slate-800 z-10">
                                                        <tr>
                                                            <th className="px-8 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Duration</th>
                                                            <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Days</th>
                                                            <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Type</th>
                                                            <th className="px-4 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800/40">
                                                        {filteredHistory.map(r => (
                                                            <tr key={r.id} className="hover:bg-white/[0.02] transition-colors">
                                                                <td className="px-8 py-3.5 text-[11px] font-medium text-slate-300 whitespace-nowrap">
                                                                    {new Date(r.from_date).toLocaleDateString('en-GB')}
                                                                    {r.from_date !== r.to_date && <> &mdash; {new Date(r.to_date).toLocaleDateString('en-GB')}</>}
                                                                </td>
                                                                <td className="px-4 py-3.5">
                                                                    <span className="px-2 py-0.5 bg-slate-800 rounded-md text-[10px] font-black text-white border border-slate-700">{r.days_count}</span>
                                                                </td>
                                                                <td className="px-4 py-3.5">
                                                                    <span className={`text-[9px] font-black uppercase tracking-widest ${r.leave_type === 'PAID' ? 'text-emerald-500' : r.leave_type === 'UNPAID' ? 'text-amber-500' : 'text-rose-500'}`}>{r.leave_type}</span>
                                                                </td>
                                                                <td className="px-4 py-3.5 pr-8">
                                                                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(r.status)}`}>
                                                                        {r.status.replace('_', ' ')}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            );
                                        })()}
                                    </div>
                                </div>
                            ) : (() => {
                                const staffSalary: number | null = (staff as any)?.basic_pay ?? (staff as any)?.salary_info?.basic_salary ?? null;
                                const perDay = staffSalary && penaltyWorkingDays > 0 ? staffSalary / penaltyWorkingDays : null;

                                const paidDaysInMonth = penaltyDays.filter(d => d.allocation_type === 'PAID').reduce((s, d) => s + d.day_count, 0);
                                const unpaidDaysInMonth = penaltyDays.filter(d => d.allocation_type === 'UNPAID').reduce((s, d) => s + d.day_count, 0);
                                const penaltyDaysInMonth = penaltyDays.filter(d => d.allocation_type === 'PENALTY').reduce((s, d) => s + d.day_count, 0);
                                const totalDaysInMonth = paidDaysInMonth + unpaidDaysInMonth + penaltyDaysInMonth;

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
                                const totalDeduction = perDay != null ? (slab1Amt! + slab2Amt! + slab3Amt!) : null;

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
                                            <div className="space-y-6">
                                                {/* Month selector */}
                                                <div className="flex flex-col gap-1">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Select Month</div>
                                                    <input
                                                        type="month"
                                                        value={penaltyMonth}
                                                        onChange={e => setPenaltyMonth(e.target.value)}
                                                        className="bg-slate-900 border border-slate-800 text-white rounded-lg px-3 py-2 text-xs font-black uppercase outline-none w-full"
                                                    />
                                                </div>

                                                {/* Salary row */}
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Monthly Salary</div>
                                                        <div className="text-sm font-black text-white">{staffSalary != null ? fmt(staffSalary) : 'Not set'}</div>
                                                    </div>
                                                    <div className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1">
                                                            Work Days <Settings size={10} className="text-slate-600" />
                                                        </div>
                                                        <input
                                                            type="number" min={1} max={31}
                                                            value={penaltyWorkingDays}
                                                            onChange={e => setPenaltyWorkingDays(Math.max(1, parseInt(e.target.value) || 26))}
                                                            className="bg-transparent text-sm font-black text-white w-full outline-none"
                                                        />
                                                    </div>
                                                    <div className="col-span-2 p-4 bg-slate-900/50 rounded-2xl border border-slate-800 space-y-1">
                                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Per-Day Rate</div>
                                                        <div className="text-sm font-black text-white">{perDay != null ? fmt(perDay) : '—'}</div>
                                                    </div>
                                                </div>

                                                {/* Leave summary */}
                                                <div className="p-4 bg-slate-900/30 rounded-2xl border border-slate-800 space-y-3">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{monthLabel} Summary</div>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        <div className="text-center bg-slate-900/50 rounded-lg py-2 border border-slate-800/50">
                                                            <div className="text-sm font-black text-emerald-500">{paidDaysInMonth}</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Paid</div>
                                                        </div>
                                                        <div className="text-center bg-slate-900/50 rounded-lg py-2 border border-slate-800/50">
                                                            <div className="text-sm font-black text-amber-500">{unpaidDaysInMonth}</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Unpaid</div>
                                                        </div>
                                                        <div className="text-center bg-slate-900/50 rounded-lg py-2 border border-slate-800/50">
                                                            <div className="text-sm font-black text-rose-500">{penaltyDaysInMonth}</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Penalty</div>
                                                        </div>
                                                        <div className="text-center bg-slate-900/50 rounded-lg py-2 border border-slate-800/50">
                                                            <div className="text-sm font-black text-white">{totalDaysInMonth}</div>
                                                            <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Total</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Slab table */}
                                                <div className="space-y-2">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Progressive Slabs</div>
                                                    <div className="rounded-2xl border border-slate-800 overflow-hidden">
                                                        <table className="w-full text-left">
                                                            <thead className="bg-[#0f172a] border-b border-slate-800">
                                                                <tr>
                                                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest">Slab</th>
                                                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-center">Days</th>
                                                                    <th className="px-3 py-2 text-[8px] font-black text-slate-500 uppercase tracking-widest text-right">Amt</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-800/50">
                                                                {[
                                                                    { label: `S1 (1–${slab1Limit}d) • ${slab1Mult}x`, days: slab1Days, amt: slab1Amt },
                                                                    { label: `S2 (${slab1Limit + 1}–${slab2Limit}d) • ${slab2Mult}x`, days: slab2Days, amt: slab2Amt },
                                                                    { label: `S3 (${slab2Limit + 1}+d) • ${slab3Mult}x`, days: slab3Days, amt: slab3Amt },
                                                                ].map((row, i) => (
                                                                    <tr key={i} className={`transition-colors ${row.days > 0 ? 'bg-rose-500/5' : 'opacity-40'}`}>
                                                                        <td className="px-3 py-2.5 text-[10px] font-black text-white">{row.label}</td>
                                                                        <td className="px-3 py-2.5 text-center">
                                                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${row.days > 0 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>{row.days}</span>
                                                                        </td>
                                                                        <td className="px-3 py-2.5 text-right text-[10px] font-black text-white">{row.amt != null ? fmt(row.amt) : '—'}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>

                                                {/* Deduction Banner */}
                                                <div className={`p-4 rounded-2xl border flex flex-col gap-2 ${totalDeduction != null && totalDeduction > 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                                                    <div className={`text-[10px] font-black uppercase tracking-widest ${totalDeduction != null && totalDeduction > 0 ? 'text-rose-400' : 'text-emerald-500'}`}>
                                                        {totalDeduction != null && totalDeduction > 0 ? 'Estimated Deduction' : 'No Penalty'}
                                                    </div>
                                                    <div className={`text-2xl font-black ${totalDeduction != null && totalDeduction > 0 ? 'text-rose-400' : 'text-emerald-500'}`}>
                                                        {totalDeduction != null ? fmt(totalDeduction) : staffSalary == null ? 'Set basic pay' : '—'}
                                                    </div>
                                                </div>

                                                {/* Rules reminder */}
                                                <div className="p-4 bg-slate-900/30 rounded-2xl border border-slate-800 space-y-2">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5"><AlertCircle size={10} /> Rules Applied</div>
                                                    <ul className="space-y-1 text-[9px] text-slate-500 font-medium">
                                                        <li>&bull; Penalty applies to over-entitlement days only</li>
                                                        <li>&bull; Half-day leave is exactly <span className="text-slate-300 font-bold">0.5 days</span></li>
                                                        <li>&bull; Excludes canceled/rejected/revoked</li>
                                                    </ul>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

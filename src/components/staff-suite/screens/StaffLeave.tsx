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
    ArrowRight
} from 'lucide-react';
import { StaffMaster, LeaveRequest, LeavePolicy } from '../../../types/accounting';
import { fetchLeaveBalances, fetchLeaveRequests, upsertLeaveRequest, fetchActiveLeavePolicy, requestCancelLeave, revokeLeave } from '../../../lib/supabase';
import { toast } from 'react-hot-toast';

interface StaffLeaveProps {
    staff: StaffMaster;
}

type Tab = 'balances' | 'history';
type ApplyTiming = 'TODAY' | 'FUTURE';
type ApplyType = 'SINGLE' | 'CONSECUTIVE';
type ApplyDuration = 'FULL' | 'HALF';

export default function StaffLeave({ staff }: StaffLeaveProps) {
    const [activeTab, setActiveTab] = useState<Tab>('balances');
    const [balances, setBalances] = useState<any[]>([]);
    const [requests, setRequests] = useState<any[]>([]);
    const [activePolicy, setActivePolicy] = useState<LeavePolicy | null>(null);
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

    // History Filters & Pagination
    const [historyFrom, setHistoryFrom] = useState('');
    const [historyTo, setHistoryTo] = useState('');
    const [historyPage, setHistoryPage] = useState(1);
    const REQ_PAGE_SIZE = 5;

    // Balance Drill-down Drawer
    const [selectedBalance, setSelectedBalance] = useState<any>(null);
    const [drawerTab, setDrawerTab] = useState<'history' | 'penalty'>('history');
    const [penaltyMonth, setPenaltyMonth] = useState(new Date().toISOString().slice(0, 7));

    const loadLeaveData = async () => {
        setIsLoading(true);
        try {
            const year = new Date().getFullYear();
            const [balanceData, requestData, policyData] = await Promise.all([
                fetchLeaveBalances(year, staff.id),
                fetchLeaveRequests({ staffId: staff.id }),
                fetchActiveLeavePolicy()
            ]);

            setBalances(balanceData);
            setRequests(requestData);
            setActivePolicy(policyData);
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

    const handleApply = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const startDate = applyTiming === 'TODAY' ? new Date().toISOString().split('T')[0] : formData.from_date;
            const endDate = (applyTiming === 'TODAY' || applyType === 'SINGLE') ? startDate : formData.to_date;

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
                staff_id: staff.id,
                from_date: startDate,
                to_date: endDate,
                days_count: finalDays,
                start_day_type: startDayType,
                end_day_type: endDayType,
                leave_type: 'PAID', // Backend engine handles allocation
                reason: formData.reason,
                status: 'PENDING'
            };

            await upsertLeaveRequest(request);

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
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Tabs */}
            <div className="flex bg-[#0f172a]/80 backdrop-blur-md p-1 rounded-2xl border border-slate-800/50 sticky top-0 z-10">
                <button
                    onClick={() => setActiveTab('balances')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'balances' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <FileText size={14} /> Balances
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'history' ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    <History size={14} /> History
                </button>
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
                                <div key={b.id} className="contents">
                                    <div
                                        className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 relative overflow-hidden group cursor-pointer hover:border-brand-500/30 transition-all"
                                        onClick={() => {
                                            setSelectedBalance(b);
                                            setDrawerTab('history');
                                        }}
                                    >
                                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1.5 bg-emerald-500/20 rounded-lg">
                                                <FileText size={14} className="text-emerald-400" />
                                            </div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Paid Remaining</p>
                                        </div>
                                        <p className="text-2xl font-black text-white">{b.paid_balance}</p>
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Days Available</p>
                                    </div>
                                    <div
                                        className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 relative overflow-hidden group cursor-pointer hover:border-brand-500/30 transition-all"
                                        onClick={() => {
                                            setSelectedBalance(b);
                                            setDrawerTab('history');
                                        }}
                                    >
                                        <div className="absolute -right-4 -top-4 w-16 h-16 bg-amber-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="p-1.5 bg-amber-500/20 rounded-lg">
                                                <History size={14} className="text-amber-400" />
                                            </div>
                                            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total Taken</p>
                                        </div>
                                        <p className="text-2xl font-black text-white">{b.total_leaves_taken || 0}</p>
                                        <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Days YTD</p>
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
            ) : (
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
            )}

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

                                // Local simulation state
                                let totalPaid = 0;
                                let totalUnpaid = 0;
                                let totalPenaltyDays = 0;
                                let totalDaysCount = 0;
                                let currentMultiplier = activePolicy.penalty_slab1_mult || 1;

                                const bal = balances[0];
                                if (!bal) return null;

                                let tempPaid = Number(bal.paid_balance);
                                let tempUnpaid = Number(bal.unpaid_balance);
                                let tempPenalty = Number(bal.penalty_count || 0);

                                const effectiveMonthCap = Number(activePolicy.monthly_paid_cap) >= 0 ? Number(activePolicy.monthly_paid_cap) : Infinity;
                                const monthlyUsed = 0;

                                const diffTime = (end.getTime() - start.getTime());
                                const calendarDays = Math.max(1, Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1);

                                for (let d = 0; d < calendarDays; d++) {
                                    let dayWeight = 1.0;
                                    if (applyTiming === 'TODAY' || applyType === 'SINGLE') {
                                        dayWeight = applyDuration === 'HALF' ? 0.5 : 1.0;
                                    } else {
                                        if (d === 0 && formData.start_day_type === 'HALF') dayWeight = 0.5;
                                        else if (d === calendarDays - 1 && formData.end_day_type === 'HALF') dayWeight = 0.5;
                                    }

                                    const overCap = (monthlyUsed + totalPaid + dayWeight) > effectiveMonthCap;

                                    if (tempPaid >= dayWeight && !overCap) {
                                        totalPaid += dayWeight;
                                        tempPaid -= dayWeight;
                                    } else if (tempUnpaid >= dayWeight) {
                                        if (overCap && activePolicy.cap_type === 'HARD') continue;
                                        totalUnpaid += dayWeight;
                                        tempUnpaid -= dayWeight;
                                    } else {
                                        if (overCap && activePolicy.cap_type === 'HARD') continue;
                                        totalPenaltyDays += dayWeight;
                                        tempPenalty += dayWeight;
                                        if (tempPenalty <= activePolicy.penalty_slab1_limit) currentMultiplier = activePolicy.penalty_slab1_mult;
                                        else if (tempPenalty <= activePolicy.penalty_slab2_limit) currentMultiplier = activePolicy.penalty_slab2_mult;
                                        else currentMultiplier = activePolicy.penalty_slab3_mult;
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
                                                <p className="text-lg font-black text-rose-500">{currentMultiplier}x</p>
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

                        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-4 px-4 pb-20">
                            {drawerTab === 'history' ? (
                                <div className="space-y-3">
                                    {requests
                                        .filter(r => new Date(r.from_date).getFullYear() === selectedBalance.year && r.status === 'APPROVED')
                                        .length === 0 ? (
                                        <div className="py-10 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                                            <p className="text-[10px] font-black text-slate-500 uppercase">No approved leaves this year</p>
                                        </div>
                                    ) : (
                                        requests
                                            .filter(r => new Date(r.from_date).getFullYear() === selectedBalance.year && r.status === 'APPROVED')
                                            .map(r => (
                                                <div key={r.id} className="p-4 bg-slate-900/50 rounded-2xl border border-slate-800/50 flex justify-between items-center">
                                                    <div>
                                                        <p className="text-[10px] font-black text-white uppercase">{new Date(r.from_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
                                                        <p className="text-[8px] font-black text-slate-500 uppercase mt-0.5">{r.leave_type}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-[12px] font-black text-white">{r.days_count} d</p>
                                                    </div>
                                                </div>
                                            ))
                                    )}
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Select Month</p>
                                            <input
                                                type="month"
                                                value={penaltyMonth}
                                                onChange={e => setPenaltyMonth(e.target.value)}
                                                className="bg-slate-900 border border-slate-800 text-white rounded-lg px-2 py-1 text-[10px] font-black uppercase outline-none"
                                            />
                                        </div>

                                        <div className="p-5 rounded-3xl bg-rose-500/5 border border-rose-500/10 space-y-4">
                                            <div className="flex items-center gap-2">
                                                <AlertCircle size={14} className="text-rose-500" />
                                                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Progressive Penalty</p>
                                            </div>

                                            {(() => {
                                                const staffSalary = (staff as any).basic_pay || 0;
                                                const penaltyDaysInMonth = requests
                                                    .filter(r => r.from_date.startsWith(penaltyMonth) && r.leave_type === 'PENALTY' && r.status === 'APPROVED')
                                                    .reduce((sum, r) => sum + r.days_count, 0);

                                                const slab1Limit = activePolicy?.penalty_slab1_limit || 5;
                                                const slab2Limit = activePolicy?.penalty_slab2_limit || 10;
                                                const slab1Mult = activePolicy?.penalty_slab1_mult || 1.5;
                                                const slab2Mult = activePolicy?.penalty_slab2_mult || 2;
                                                const slab3Mult = activePolicy?.penalty_slab3_mult || 3;

                                                const perDayBase = staffSalary / 30;

                                                const s1Days = Math.min(penaltyDaysInMonth, slab1Limit);
                                                const s2Days = Math.max(0, Math.min(penaltyDaysInMonth - slab1Limit, slab2Limit - slab1Limit));
                                                const s3Days = Math.max(0, penaltyDaysInMonth - slab2Limit);

                                                const totalDeduction = (s1Days * perDayBase * slab1Mult) + (s2Days * perDayBase * slab2Mult) + (s3Days * perDayBase * slab3Mult);

                                                return (
                                                    <div className="space-y-5">
                                                        <div className="grid grid-cols-3 gap-2">
                                                            <div className="text-center">
                                                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Slab 1 ({slab1Mult}x)</p>
                                                                <p className="text-xs font-black text-rose-400">{s1Days}</p>
                                                            </div>
                                                            <div className="text-center">
                                                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Slab 2 ({slab2Mult}x)</p>
                                                                <p className="text-xs font-black text-rose-400">{s2Days}</p>
                                                            </div>
                                                            <div className="text-center">
                                                                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Slab 3 ({slab3Mult}x)</p>
                                                                <p className="text-xs font-black text-rose-400">{s3Days}</p>
                                                            </div>
                                                        </div>

                                                        {staffSalary > 0 ? (
                                                            <div className="pt-4 border-t border-rose-500/10 flex justify-between items-center">
                                                                <div>
                                                                    <p className="text-[8px] font-black text-slate-500 uppercase">Estimated Deduction</p>
                                                                    <p className="text-xl font-black text-rose-500">₹{totalDeduction.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
                                                                </div>
                                                                <div className="text-right">
                                                                    <p className="text-[8px] font-black text-slate-500 uppercase">Base Rate</p>
                                                                    <p className="text-[10px] font-bold text-slate-400">₹{perDayBase.toLocaleString('en-IN', { maximumFractionDigits: 0 })}/d</p>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="pt-4 border-t border-rose-500/10">
                                                                <p className="text-[8px] font-black text-slate-500 uppercase text-center">No salary data for calculation</p>
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
                    </div>
                </div>
            )}
        </div>
    );
}

import { useState, useEffect } from 'react';
import {
    Calendar,
    Plus,
    History,
    FileText
} from 'lucide-react';
import { StaffProfile } from '../../../types/accounting';
import { fetchLeaveBalances, fetchLeaveRequests } from '../../../lib/supabase';

interface StaffLeaveProps {
    staff: StaffProfile;
}

export default function StaffLeave({ staff }: StaffLeaveProps) {
    const [balances, setBalances] = useState<any[]>([]);
    const [requests, setRequests] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isApplying, setIsApplying] = useState(false);

    useEffect(() => {
        const loadLeaveData = async () => {
            setIsLoading(true);
            try {
                const year = new Date().getFullYear();
                const [balanceData, requestData] = await Promise.all([
                    fetchLeaveBalances(year),
                    fetchLeaveRequests({ staffId: staff.id })
                ]);

                setBalances(balanceData.filter((b: any) => b.staff_id === staff.id));
                setRequests(requestData);
            } catch (error) {
                console.error('Failed to load leave data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadLeaveData();
    }, [staff.id]);

    const getStatusStyles = (status: string) => {
        switch (status) {
            case 'APPROVED': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'REJECTED': return 'text-red-400 bg-red-500/10 border-red-500/20';
            case 'PENDING': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Balance Overview */}
            <div>
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2 mb-4">Leave Balances</h3>
                <div className="grid grid-cols-2 gap-4">
                    {isLoading ? (
                        [1, 2].map(i => (
                            <div key={i} className="h-32 bg-slate-800/20 rounded-3xl border border-slate-800 animate-pulse" />
                        ))
                    ) : balances.length === 0 ? (
                        <div className="col-span-2 p-6 bg-slate-800/20 rounded-3xl border border-dashed border-slate-800 text-center">
                            <p className="text-xs font-bold text-slate-500">No leave policies assigned</p>
                        </div>
                    ) : (
                        balances.map((b) => (
                            <div key={b.id} className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 relative overflow-hidden group">
                                <div className="absolute -right-4 -top-4 w-16 h-16 bg-brand-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="p-1.5 bg-brand-500/20 rounded-lg">
                                        <FileText size={14} className="text-brand-400" />
                                    </div>
                                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 truncate">
                                        {b.leave_types?.type_name || 'Leave'}
                                    </p>
                                </div>
                                <p className="text-2xl font-black text-white">{b.remaining_balance}</p>
                                <p className="text-[8px] font-black uppercase tracking-widest text-slate-500">Days Available</p>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Quick Actions */}
            <button
                onClick={() => setIsApplying(true)}
                className="w-full py-4 bg-brand-600 hover:bg-brand-500 text-white rounded-[1.5rem] font-black uppercase tracking-[0.2em] shadow-glow shadow-brand-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
            >
                <Plus size={18} /> Apply for Leave
            </button>

            {/* Request History */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em]">Request History</h3>
                    <History size={14} className="text-slate-600" />
                </div>

                {isLoading ? (
                    <div className="space-y-3">
                        {[1, 2, 3].map(i => (
                            <div key={i} className="h-20 bg-slate-800/20 rounded-3xl animate-pulse" />
                        ))}
                    </div>
                ) : requests.length === 0 ? (
                    <div className="py-10 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                        <Calendar size={24} className="mx-auto text-slate-700 mb-3" />
                        <p className="text-xs font-bold text-slate-500">No recent requests</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {requests.map((req) => (
                            <div key={req.id} className="bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="text-center min-w-[50px]">
                                        <p className="text-[10px] font-black text-slate-500 uppercase">
                                            {req.total_days} {req.total_days === 1 ? 'day' : 'days'}
                                        </p>
                                        <p className="text-[10px] font-black text-white uppercase mt-1">
                                            {new Date(req.start_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                        </p>
                                    </div>
                                    <div className="h-8 w-px bg-slate-800" />
                                    <div>
                                        <p className="text-[10px] font-black text-white uppercase tracking-widest mb-1">
                                            {req.leave_types?.type_name}
                                        </p>
                                        <p className="text-[9px] text-slate-500 font-bold truncate max-w-[120px]">
                                            {req.reason || 'No reason provided'}
                                        </p>
                                    </div>
                                </div>

                                <span className={`px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(req.status)}`}>
                                    {req.status}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Application Modal (Placeholder) */}
            {isApplying && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[100] flex items-end md:items-center justify-center p-4">
                    <div className="bg-[#0f172a] w-full max-w-sm rounded-[2rem] border border-slate-800 p-8 space-y-6 shadow-2xl animate-in slide-in-from-bottom-10 fade-in duration-300">
                        <h2 className="text-xl font-black text-white uppercase tracking-widest">Apply for Leave</h2>
                        <div className="space-y-4">
                            <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                                Self-service leave application form is coming in the next update.
                                For now, please coordinate with your manager.
                            </p>
                            <button
                                onClick={() => setIsApplying(false)}
                                className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest transition-all"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

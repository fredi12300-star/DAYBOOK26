import {
    Calendar,
    Clock,
    AlertCircle,
    ArrowRight,
    Briefcase,
    ShieldCheck
} from 'lucide-react';
import { StaffMaster, AttendanceRecord } from '../../../types/accounting';

interface StaffDashboardProps {
    staff: StaffMaster | null;
    todayAttendance: AttendanceRecord | null;
    leaveBalance: any[];
    onNavigate: (tab: string) => void;
}

export default function StaffDashboard({
    staff,
    todayAttendance,
    leaveBalance: _leaveBalance,
    onNavigate
}: StaffDashboardProps) {
    const formatTime = (isoString: string | null) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Welcome Section */}
            <div>
                <p className="text-slate-400 text-xs font-black uppercase tracking-[0.2em] mb-1">Welcome back,</p>
                <h2 className="text-2xl font-black text-white">{staff?.full_name || 'Staff Member'}</h2>
                <div className="flex items-center gap-2 mt-2">
                    <span className="px-3 py-1 bg-brand-500/10 border border-brand-500/20 rounded-full text-[10px] font-black uppercase tracking-widest text-brand-400">
                        {staff?.department || 'Operations'}
                    </span>
                    <span className="px-3 py-1 bg-slate-800 rounded-full text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {staff?.employment_type || 'Specialist'}
                    </span>
                </div>
            </div>

            {/* Today's Stats Grid */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-brand-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                    <Clock size={20} className="text-brand-500 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">In Time</p>
                    <p className="text-xl font-black text-white">{formatTime(todayAttendance?.punch_in || null)}</p>
                </div>
                <div className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 relative overflow-hidden group">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-emerald-500/5 rounded-full group-hover:scale-150 transition-transform duration-500" />
                    <ShieldCheck size={20} className="text-emerald-500 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Status</p>
                    <p className="text-sm font-black text-white uppercase tracking-tight truncate">
                        {todayAttendance?.status || 'NOT MARKED'}
                    </p>
                </div>
            </div>

            {/* Quick Summary Card */}
            <div className="bg-gradient-to-br from-brand-600/20 to-brand-900/10 p-6 rounded-[2rem] border border-brand-500/20 shadow-glow shadow-brand-500/5">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-brand-500/20 rounded-xl">
                            <Calendar size={18} className="text-brand-400" />
                        </div>
                        <h3 className="font-black uppercase tracking-widest text-xs">Leave Balance</h3>
                    </div>
                    <button
                        onClick={() => onNavigate('leave')}
                        className="text-[10px] font-black text-brand-400 uppercase tracking-widest flex items-center gap-1 group"
                    >
                        Apply <ArrowRight size={12} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                </div>
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-xs font-bold">Annual Leaves</span>
                        <div className="flex items-baseline gap-1">
                            <span className="text-lg font-black text-white">12</span>
                            <span className="text-[10px] text-slate-500 uppercase">days</span>
                        </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-500 w-[60%] rounded-full shadow-glow shadow-brand-500/30" />
                    </div>
                </div>
            </div>

            {/* Quick Actions / Notices */}
            <div className="space-y-4">
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2">Important Alerts</h3>

                <div className="flex items-start gap-4 p-5 bg-red-500/5 border border-red-500/10 rounded-3xl group cursor-default">
                    <div className="p-2 bg-red-500/10 rounded-xl">
                        <AlertCircle size={18} className="text-red-500" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest mb-1">Mis-Punch detected</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-bold">Your punch-out for Yesterday is missing. Please raise a correction request.</p>
                    </div>
                </div>

                <div className="flex items-start gap-4 p-5 bg-blue-500/5 border border-blue-500/10 rounded-3xl">
                    <div className="p-2 bg-blue-500/10 rounded-xl">
                        <Briefcase size={18} className="text-blue-400" />
                    </div>
                    <div className="flex-1">
                        <h4 className="text-xs font-black text-slate-200 uppercase tracking-widest mb-1">New Holiday</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-bold">Upcoming: 15 Aug - Independence Day (Public Holiday)</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

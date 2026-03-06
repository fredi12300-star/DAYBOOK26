import { useState, useEffect } from 'react';
import {
    Calendar as CalendarIcon,
    Clock,
    AlertCircle,
    ChevronLeft,
    ChevronRight,
    Search
} from 'lucide-react';
import { AttendanceRecord, StaffProfile } from '../../../types/accounting';
import { fetchStaffAttendanceHistory } from '../../../lib/supabase';

interface StaffAttendanceProps {
    staff: StaffProfile;
}

export default function StaffAttendance({ staff }: StaffAttendanceProps) {
    const [history, setHistory] = useState<AttendanceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());

    useEffect(() => {
        const loadHistory = async () => {
            setIsLoading(true);
            try {
                const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).toISOString().split('T')[0];
                const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).toISOString().split('T')[0];
                const data = await fetchStaffAttendanceHistory(staff.id, start, end);
                setHistory(data);
            } catch (error) {
                console.error('Failed to load attendance history:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadHistory();
    }, [staff.id, currentMonth]);

    const formatTime = (isoString: string | null) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'PRESENT': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
            case 'ABSENT': return 'text-red-400 bg-red-500/10 border-red-500/20';
            case 'LATE_PRESENT': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            case 'HALF_DAY': return 'text-orange-400 bg-orange-500/10 border-orange-500/20';
            case 'WEEKLY_OFF': return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
            default: return 'text-slate-500 bg-slate-500/5 border-slate-500/10';
        }
    };

    const stats = {
        present: history.filter(h => h.status === 'PRESENT' || h.status === 'LATE_PRESENT').length,
        absent: history.filter(h => h.status === 'ABSENT').length,
        late: history.filter(h => h.status === 'LATE_PRESENT').length,
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
            {/* Header / Filter */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))}
                        className="p-2 bg-slate-800 rounded-xl border border-slate-700 hover:bg-slate-700 transition-colors"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <div className="text-center min-w-[120px]">
                        <h3 className="text-sm font-black uppercase tracking-widest text-white">
                            {currentMonth.toLocaleString('default', { month: 'long', year: 'numeric' })}
                        </h3>
                    </div>
                    <button
                        onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))}
                        className="p-2 bg-slate-800 rounded-xl border border-slate-700 hover:bg-slate-700 transition-colors"
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-slate-800/50 text-center">
                    <p className="text-xl font-black text-emerald-400">{stats.present}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mt-1">Present</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-slate-800/50 text-center">
                    <p className="text-xl font-black text-red-500">{stats.absent}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mt-1">Absent</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-slate-800/50 text-center">
                    <p className="text-xl font-black text-amber-500">{stats.late}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mt-1">Late</p>
                </div>
            </div>

            {/* History List */}
            <div className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2 flex items-center justify-between">
                    Daily Logs
                    <Search size={12} />
                </h3>

                {isLoading ? (
                    <div className="py-10 flex justify-center">
                        <div className="w-6 h-6 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
                    </div>
                ) : history.length === 0 ? (
                    <div className="py-10 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                        <CalendarIcon size={24} className="mx-auto text-slate-700 mb-3" />
                        <p className="text-xs font-bold text-slate-500">No records for this month</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {history.map((record) => (
                            <div
                                key={record.attendance_date}
                                className="bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50 flex items-center justify-between group active:scale-[0.98] transition-all"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="text-center min-w-[40px]">
                                        <p className="text-[10px] font-black text-slate-500 uppercase">
                                            {new Date(record.attendance_date).toLocaleString('default', { weekday: 'short' })}
                                        </p>
                                        <p className="text-lg font-black text-white">
                                            {new Date(record.attendance_date).getDate()}
                                        </p>
                                    </div>
                                    <div className="h-8 w-px bg-slate-800" />
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${getStatusColor(record.status)}`}>
                                                {record.status.replace('_', ' ')}
                                            </span>
                                            {record.late_minutes > 0 && (
                                                <span className="flex items-center gap-1 text-[8px] font-bold text-amber-500">
                                                    <AlertCircle size={10} /> {record.late_minutes}m Late
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <Clock size={10} /> {formatTime(record.punch_in)}
                                            </span>
                                            <span>-</span>
                                            <span>{formatTime(record.punch_out)}</span>
                                        </div>
                                    </div>
                                </div>

                                <button className="p-2 opacity-0 group-hover:opacity-100 bg-slate-800 rounded-xl border border-slate-700 transition-all">
                                    <AlertCircle size={14} className="text-slate-400" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

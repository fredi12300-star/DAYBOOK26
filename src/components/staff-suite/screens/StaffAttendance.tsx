import { useState, useEffect } from 'react';
import {
    Calendar as CalendarIcon,
    Clock, AlertCircle, ChevronLeft, ChevronRight, Search
} from 'lucide-react';
import { StaffMaster, AttendanceRecord, ShiftGroup } from '../../../types/accounting';
import { fetchStaffAttendanceHistory, fetchShiftGroups } from '../../../lib/supabase';
import { getMonthRangeLocal } from '../../../lib/attendanceUtils';

interface StaffAttendanceProps {
    staff: StaffMaster;
}

export default function StaffAttendance({ staff }: StaffAttendanceProps) {
    const [history, setHistory] = useState<AttendanceRecord[]>([]);
    const [shiftGroups, setShiftGroups] = useState<ShiftGroup[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [currentMonth, setCurrentMonth] = useState(new Date());

    const parseLocalDate = (dateStr: string) => {
        // Appends midnight in local time to avoid UTC shift
        return new Date(dateStr + 'T00:00:00');
    };
    useEffect(() => {
        const loadHistory = async () => {
            setIsLoading(true);
            try {
                const { start, end } = getMonthRangeLocal(currentMonth.getFullYear(), currentMonth.getMonth());
                const [data, groups] = await Promise.all([
                    fetchStaffAttendanceHistory(staff.id, start, end),
                    fetchShiftGroups()
                ]);
                setHistory(data);
                setShiftGroups(groups);
            } catch (error) {
                console.error('Failed to load attendance history:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadHistory();
    }, [staff.id, currentMonth]);

    const formatTime = (timeString: string | null, attendanceDate: string) => {
        if (!timeString) return '--:--';
        if (timeString.includes('T')) {
            const d = new Date(timeString);
            return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : timeString;
        }
        const d = new Date(`${attendanceDate}T${timeString}Z`);
        return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : timeString;
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

    const parseTimeToMins = (timeInput: string | null, isUtc: boolean = false) => {
        if (!timeInput) return null;
        if (timeInput.includes('T')) {
            const date = new Date(timeInput);
            if (isNaN(date.getTime())) return null;
            return date.getHours() * 60 + date.getMinutes();
        }
        const parts = timeInput.split(':');
        if (parts.length >= 2) {
            let mins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            if (isUtc) {
                const offset = new Date().getTimezoneOffset();
                mins = mins - offset;
                if (mins < 0) mins += 24 * 60;
                if (mins >= 24 * 60) mins -= 24 * 60;
            }
            return mins;
        }
        return null;
    };

    const stats = {
        present: history.filter(h => h.status === 'PRESENT' || h.status === 'LATE_PRESENT' || h.status === 'EARLY_OUT').length,
        absent: history.filter(h => h.status === 'ABSENT').length,
    };

    const profileMetrics = (() => {
        const defaultMetrics = { late: 0, early: 0, overBreak: 0, overTime: 0 };
        const shiftGroup = staff.shift_group || shiftGroups.find(g => g.id === staff.shift_group_id);
        if (!shiftGroup) return defaultMetrics;

        let late = 0;
        let early = 0;
        let overBreak = 0;
        let overTime = 0;

        const shiftStart = parseTimeToMins(shiftGroup.start_time);
        const shiftEnd = parseTimeToMins(shiftGroup.end_time);
        const graceIn = shiftGroup.grace_in_minutes || 0;
        const graceOut = shiftGroup.grace_out_minutes || 0;
        const breakDur = shiftGroup.break_duration_minutes || 0;

        history.forEach(hr => {
            if (hr.status === 'HOLIDAY' || hr.status === 'LEAVE' || hr.status === 'WEEKLY_OFF') return;

            const pi = parseTimeToMins(hr.punch_in, true);
            const po = parseTimeToMins(hr.punch_out, true);
            const li = parseTimeToMins(hr.lunch_in, true);
            const lo = parseTimeToMins(hr.lunch_out, true);

            if (shiftStart !== null && pi !== null && pi > shiftStart + graceIn) {
                const excuse = hr.excused_late_minutes || 0;
                const lateMins = (pi - (shiftStart + graceIn)) - excuse;
                if (lateMins > 0) late += lateMins;
            }

            if (shiftEnd !== null && po !== null && po < shiftEnd - graceOut) {
                const earlyMins = (shiftEnd - graceOut) - po;
                if (earlyMins > 0) early += earlyMins;
            }

            if (shiftEnd !== null && po !== null && po > shiftEnd) {
                const overTimeMins = po - shiftEnd;
                overTime += overTimeMins;
            }

            if (li !== null && lo !== null && li > lo) {
                const taken = li - lo;
                if (taken > breakDur) {
                    const overMins = taken - breakDur;
                    overBreak += overMins;
                }
            }
        });

        return { late, early, overBreak, overTime };
    })();

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
                        onClick={() => {
                            const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
                            const today = new Date();
                            // Only allow navigation if the next month is not strictly after current month
                            if (nextMonth <= new Date(today.getFullYear(), today.getMonth(), 1)) {
                                setCurrentMonth(nextMonth);
                            }
                        }}
                        disabled={new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1) > new Date()}
                        className={`p-2 bg-slate-800 rounded-xl border border-slate-700 hover:bg-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed`}
                    >
                        <ChevronRight size={16} />
                    </button>
                </div>
            </div>

            {/* Stats Summary */}
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-slate-800/50 text-center">
                    <p className="text-xl font-black text-emerald-400">{stats.present}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mt-1">Days Present</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-slate-800/50 text-center">
                    <p className="text-xl font-black text-red-500">{stats.absent}</p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mt-1">Days Absent</p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-rose-500/20 text-center">
                    <p className="text-xl font-black text-rose-400">{profileMetrics.late}<span className="text-[8px] text-rose-500/50 ml-1">mins</span></p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-rose-500 mt-1">Total Late</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-orange-500/20 text-center">
                    <p className="text-xl font-black text-orange-400">{profileMetrics.early}<span className="text-[8px] text-orange-500/50 ml-1">mins</span></p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-orange-500 mt-1">Early Out</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-amber-500/20 text-center">
                    <p className="text-xl font-black text-amber-400">{profileMetrics.overBreak}<span className="text-[8px] text-amber-500/50 ml-1">mins</span></p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-amber-500 mt-1">Excess Break</p>
                </div>
                <div className="bg-[#0f172a]/50 p-4 rounded-2xl border border-emerald-500/20 text-center">
                    <p className="text-xl font-black text-emerald-400">{profileMetrics.overTime}<span className="text-[8px] text-emerald-500/50 ml-1">mins</span></p>
                    <p className="text-[8px] font-black uppercase tracking-widest text-emerald-500 mt-1">Over Time</p>
                </div>
            </div>

            {/* History List */}
            <div className="space-y-3">
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2 flex items-center justify-between">
                    Daily Logs
                    <Search size={12} />
                </h3>

                {(() => {
                    if (isLoading) {
                        return (
                            <div className="py-10 flex justify-center">
                                <div className="w-6 h-6 border-2 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
                            </div>
                        );
                    }

                    const filteredHistory = history.filter(record => {
                        if (record.punch_in || record.punch_out) return true;
                        if (record.status === 'LEAVE' || record.status === 'HOLIDAY' || record.status === 'HALF_DAY') return true;
                        return false;
                    });

                    if (filteredHistory.length === 0) {
                        return (
                            <div className="py-10 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                                <CalendarIcon size={24} className="mx-auto text-slate-700 mb-3" />
                                <p className="text-xs font-bold text-slate-500">No records to show for this month</p>
                            </div>
                        );
                    }

                    return (
                        <div className="space-y-3">
                            {filteredHistory.map((record) => (
                                <div
                                    key={record.attendance_date}
                                    className="bg-[#0f172a]/50 p-4 rounded-3xl border border-slate-800/50 flex items-center justify-between group active:scale-[0.98] transition-all"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="text-center min-w-[40px]">
                                            <p className="text-[10px] font-black text-slate-500 uppercase">
                                                {parseLocalDate(record.attendance_date).toLocaleString('default', { weekday: 'short' })}
                                            </p>
                                            <p className="text-lg font-black text-white">
                                                {parseLocalDate(record.attendance_date).getDate()}
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
                                            <div className="flex flex-col gap-1.5 mt-2">
                                                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-300">
                                                    <span className="flex items-center gap-1 w-[45px] text-slate-500 uppercase tracking-widest text-[8px]">
                                                        <Clock size={10} className="text-emerald-400" /> Shift
                                                    </span>
                                                    <span className="text-white bg-slate-800/50 px-2 py-0.5 rounded">{formatTime(record.punch_in, record.attendance_date)}</span>
                                                    <span className="text-slate-600">-</span>
                                                    <span className="text-white bg-slate-800/50 px-2 py-0.5 rounded">{formatTime(record.punch_out, record.attendance_date)}</span>
                                                </div>
                                                {(record.lunch_out || record.lunch_in) && (
                                                    <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400">
                                                        <span className="flex items-center gap-1 w-[45px] text-slate-500 uppercase tracking-widest text-[8px]">
                                                            <Clock size={10} className="text-amber-400" /> Break
                                                        </span>
                                                        <span className="text-rose-300 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">{formatTime(record.lunch_out, record.attendance_date)}</span>
                                                        <span className="text-slate-600">-</span>
                                                        <span className="text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">{formatTime(record.lunch_in, record.attendance_date)}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <button className="p-2 opacity-0 group-hover:opacity-100 bg-slate-800 rounded-xl border border-slate-700 transition-all">
                                        <AlertCircle size={14} className="text-slate-400" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
}

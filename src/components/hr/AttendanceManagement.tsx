import { useState, useEffect, useMemo, useRef } from 'react';
import {
    Users,
    CheckCircle2,
    X,
    Coffee,
    AlertCircle,
    ShieldAlert,
    Calendar,
    Clock, Search,
    History as HistoryIcon,
    User,
    Save,
    Settings,
    Plus,
    Trash2,
    Edit3,
    Lock
} from 'lucide-react';
import {
    AttendanceRecord, StaffMaster, ShiftGroup
} from '../../types/accounting';
import {
    fetchAttendanceRecords, fetchStaffMasters, fetchShiftGroups,
    upsertAttendanceRecords, fetchDelayIncidents, fetchLeaveDaysForDate,
    fetchStaffAttendanceHistory, verifyDayRPC,
    resolveAttendanceIncidentRPC, fetchAttendanceCorrections,
    requestAttendanceCorrectionRPC, resolveAttendanceCorrectionRPC,
    getDailyMusterSummaryRPC, getLateReportRPC, fetchAttendanceAuditLogs,
    upsertShiftGroup, deleteShiftGroup,
    fetchMonthlySnapshots
} from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import DelayIncidentModal from './DelayIncidentModal';
import { combineDateAndTimeWithBoundary, formatISOToLocalTime, getYesterdayISO } from '../../lib/attendanceUtils';

// Helper for timezone-safe local month string (YYYY-MM)
const getLocalMonthString = (date: Date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

// Helper for weekday name from YYYY-MM-DD
const getWeekday = (dateStr: string) => {
    if (!dateStr) return 'Select Date';
    const [y, m, d] = dateStr.split('-').map(Number);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '-';
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' });
};

/**
 * Compact 12-hour AM/PM time picker.
 * Uses styled number inputs — no native select dropdowns, no long lists.
 * Accepts and emits value in "HH:mm" (24h) format.
 */
function TimeInput12({
    value,
    onChange,
    disabled,
    className,
}: {
    value: string;      // HH:mm (24h)
    onChange: (val: string) => void;
    disabled?: boolean;
    className?: string;
}) {
    const isEmpty = !value;

    const parse = (v: string): { h12: number; min: number; ampm: 'AM' | 'PM' } => {
        if (!v) return { h12: 12, min: 0, ampm: 'AM' };
        const [h, m] = v.split(':').map(Number);
        return {
            ampm: h >= 12 ? 'PM' : 'AM',
            h12: h % 12 === 0 ? 12 : h % 12,
            min: isNaN(m) ? 0 : m,
        };
    };

    const { h12, min, ampm } = parse(value);

    const emit = (h: number, m: number, ap: 'AM' | 'PM') => {
        let h24 = h % 12;
        if (ap === 'PM') h24 += 12;
        onChange(`${String(h24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    };

    // Digit buffers for direct typing
    const hBuf = useRef('');
    const mBuf = useRef('');
    const minRef = useRef<HTMLInputElement>(null);

    const cellCls = `w-8 bg-transparent text-center text-[13px] font-black outline-none caret-transparent
        select-none focus:bg-brand-500/10 rounded focus:text-brand-400 transition-colors
        ${isEmpty ? 'text-slate-600' : 'text-white'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`;

    const handleWheel = (field: 'h' | 'm', e: React.WheelEvent) => {
        if (disabled) return;
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        if (field === 'h') {
            const next = ((h12 - 1 + dir + 12) % 12) + 1;
            emit(next, min, ampm);
        } else {
            const next = (min + dir + 60) % 60;
            emit(h12, next, ampm);
        }
    };

    const handleKeyDown = (field: 'h' | 'm', e: React.KeyboardEvent<HTMLInputElement>) => {
        if (disabled) return;

        // Arrow key increment/decrement
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const dir = e.key === 'ArrowUp' ? 1 : -1;
            if (field === 'h') emit(((h12 - 1 + dir + 12) % 12) + 1, min, ampm);
            else emit(h12, (min + dir + 60) % 60, ampm);
            return;
        }

        // Tab to move between fields
        if (e.key === 'Tab' && field === 'h') {
            hBuf.current = '';
            return; // let browser handle focus
        }

        // Digit typing
        if (/^\d$/.test(e.key)) {
            e.preventDefault();
            if (field === 'h') {
                const buf = hBuf.current + e.key;
                const num = parseInt(buf, 10);
                if (buf.length === 1) {
                    if (num === 0) {
                        // wait for second digit
                        hBuf.current = buf;
                        emit(12, min, ampm); // show 12 as placeholder
                    } else if (num >= 2 && num <= 9) {
                        // single digit 2-9 is unambiguous
                        hBuf.current = '';
                        emit(num, min, ampm);
                        minRef.current?.focus();
                    } else {
                        // digit is 1 — wait for second
                        hBuf.current = buf;
                        emit(num, min, ampm);
                    }
                } else {
                    // second digit
                    hBuf.current = '';
                    const clamped = Math.min(Math.max(num, 1), 12);
                    emit(clamped, min, ampm);
                    minRef.current?.focus();
                }
            } else {
                const buf = mBuf.current + e.key;
                const num = parseInt(buf, 10);
                if (buf.length === 1) {
                    if (num >= 6) {
                        // single digit 6-9 is unambiguous minute tens
                        mBuf.current = '';
                        emit(h12, num, ampm);
                    } else {
                        mBuf.current = buf;
                        emit(h12, num * 10, ampm); // tentative preview
                    }
                } else {
                    mBuf.current = '';
                    const clamped = Math.min(num, 59);
                    emit(h12, clamped, ampm);
                }
            }
        }
    };

    return (
        <div className={`flex items-center ${className || ''}`}>
            <div className={`flex items-center gap-0 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden ${disabled ? 'opacity-50' : 'hover:border-slate-600'} transition-colors`}>
                {/* Hour */}
                <input
                    readOnly
                    disabled={disabled}
                    value={isEmpty ? '--' : String(h12).padStart(2, '0')}
                    tabIndex={0}
                    onWheel={e => handleWheel('h', e)}
                    onKeyDown={e => handleKeyDown('h', e)}
                    className={`${cellCls} pl-2`}
                    style={{ width: 30 }}
                />
                <span className="text-slate-500 font-black text-xs select-none">:</span>
                {/* Minute */}
                <input
                    ref={minRef}
                    readOnly
                    disabled={disabled}
                    value={isEmpty ? '--' : String(min).padStart(2, '0')}
                    tabIndex={0}
                    onWheel={e => handleWheel('m', e)}
                    onKeyDown={e => handleKeyDown('m', e)}
                    className={`${cellCls} pr-1`}
                    style={{ width: 28 }}
                />
                {/* AM/PM toggle */}
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => !disabled && emit(h12, min, ampm === 'AM' ? 'PM' : 'AM')}
                    className={`px-2 py-1 text-[10px] font-black tracking-widest border-l border-slate-700 transition-colors select-none
                        ${isEmpty
                            ? 'text-slate-600 bg-transparent'
                            : ampm === 'AM'
                                ? 'text-sky-400 bg-sky-500/10 hover:bg-sky-500/20'
                                : 'text-orange-400 bg-orange-500/10 hover:bg-orange-500/20'}
                        ${disabled ? 'pointer-events-none' : ''}
                    `}
                >
                    {isEmpty ? '--' : ampm}
                </button>
            </div>
        </div>
    );
}

export default function AttendanceManagement() {
    const [activeTab, setActiveTab] = useState<'update' | 'incidents' | 'profiles' | 'reports' | 'policy'>('update');
    const [selectedDate, setSelectedDate] = useState(getYesterdayISO());
    const [selectedMonth, setSelectedMonth] = useState(getLocalMonthString());
    const [selectedShiftGroupId, setSelectedShiftGroupId] = useState<string>('all');

    // State
    const [staff, setStaff] = useState<StaffMaster[]>([]);
    const [shiftGroups, setShiftGroups] = useState<ShiftGroup[]>([]);
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [corrections, setCorrections] = useState<any[]>([]);
    const [leaveDays, setLeaveDays] = useState<any[]>([]);
    const [isSaving, setIsSaving] = useState(false);

    // Reports State
    const [dailySummary, setDailySummary] = useState<any>(null);
    const [reportData, setReportData] = useState<any[]>([]);
    const [selectedReport, setSelectedReport] = useState<'daily' | 'late' | 'miss_punch'>('daily');

    // Audit State
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [selectedAuditRecordId, setSelectedAuditRecordId] = useState<string | null>(null);

    // Profiles Tab State
    const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [historyRecords, setHistoryRecords] = useState<AttendanceRecord[]>([]);

    // Correction Flow State
    const [correctionModal, setCorrectionModal] = useState<{
        staffId: string;
        field: keyof AttendanceRecord;
        value: any;
        oldValue: any;
    } | null>(null);
    const [correctionReason, setCorrectionReason] = useState('');
    const [isIncidentModalOpen, setIsIncidentModalOpen] = useState(false);
    const [isVerifyModalOpen, setIsVerifyModalOpen] = useState(false);
    const [confirmDate, setConfirmDate] = useState('');

    // Policy Tab State
    const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
    const [editingShift, setEditingShift] = useState<Partial<ShiftGroup> | null>(null);




    // Filtered Staff for Profiles
    const filteredStaffList = useMemo(() => {
        return staff.filter(s =>
            s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.staff_code.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [staff, searchQuery]);

    const { user, canExecute, isSuperAdmin } = useAuth();
    const canManageAttendance = canExecute('hr_attendance', 'manage_attendance');
    const canApproveCorrection = canExecute('hr_attendance', 'approve_correction');

    useEffect(() => {
        loadData();
        if (activeTab === 'reports') loadReports();
    }, [selectedDate, activeTab, selectedReport, selectedMonth]);

    useEffect(() => {
        if (activeTab === 'profiles' && selectedStaffId) loadHistory();
    }, [activeTab, selectedStaffId, selectedMonth]);

    useEffect(() => {
        if (selectedDate) {
            setSelectedMonth(selectedDate.substring(0, 7));
        }
    }, [selectedDate]);

    // Tracking lock for current viewing context (Date or Month)
    const viewedMonth = useMemo(() => {
        if (selectedDate) return selectedDate.substring(0, 7);
        return getLocalMonthString();
    }, [activeTab, selectedMonth, selectedDate]);

    const [isPeriodLocked, setIsPeriodLocked] = useState(false);

    useEffect(() => {
        const checkLockStatus = async () => {
            try {
                const [year, month] = viewedMonth.split('-').map(Number);
                const snapshots = await fetchMonthlySnapshots(year, month);
                setIsPeriodLocked(snapshots.some(s => s.is_locked));
            } catch (err) {
                console.error('Failed to check lock status:', err);
            }
        };
        checkLockStatus();
    }, [viewedMonth]);

    const isWriteDisabled = isPeriodLocked && !isSuperAdmin;



    async function loadData() {
        try {
            const [staffData, groupsData, incidentsData, correctionsData] = await Promise.all([
                fetchStaffMasters(),
                fetchShiftGroups(),
                selectedDate ? fetchDelayIncidents(selectedDate) : Promise.resolve([]),
                selectedDate ? fetchAttendanceCorrections(selectedDate) : Promise.resolve([])
            ]);
            setStaff(staffData.filter(s => s.is_active));
            setShiftGroups(groupsData);
            setIncidents(incidentsData);
            setCorrections(correctionsData);

            if (selectedDate) {
                const [recordsData, leavesData] = await Promise.all([
                    fetchAttendanceRecords(selectedDate),
                    fetchLeaveDaysForDate(selectedDate)
                ]);
                setRecords(recordsData);
                setLeaveDays(leavesData);
            } else {
                setRecords([]);
                setLeaveDays([]);
            }
        } catch (error) {
            console.error('Error loading data:', error);
        }
    }

    async function loadReports() {
        try {
            if (selectedReport === 'daily' && selectedDate) {
                const summary = await getDailyMusterSummaryRPC(selectedDate);
                setDailySummary(summary);
            } else if (selectedReport === 'late') {
                const year = parseInt(selectedMonth.split('-')[0]);
                const month = parseInt(selectedMonth.split('-')[1]);
                const start = `${selectedMonth}-01`;
                const lastDay = new Date(year, month, 0).getDate();
                const end = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
                const data = await getLateReportRPC(start, end);
                setReportData(data || []);
            }
        } catch (error) {
            console.error('Error loading reports:', error);
        }
    }

    async function loadHistory() {
        if (!selectedStaffId) return;
        try {
            const year = parseInt(selectedMonth.split('-')[0]);
            const month = parseInt(selectedMonth.split('-')[1]);
            const start = `${selectedMonth}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const end = `${selectedMonth}-${String(lastDay).padStart(2, '0')}`;
            const data = await fetchStaffAttendanceHistory(selectedStaffId, start, end);

            // Client-side fallback filter for "empty placeholder" days
            // and explicit descending sort by date
            const meaningfulData = data.filter((ar: any) =>
                ar.punch_in ||
                ar.punch_out ||
                ar.notes ||
                (ar as any).incident_id ||
                ar.is_verified ||
                ar.status === 'HOLIDAY' ||
                ar.status === 'LEAVE'
            ).sort((a: any, b: any) => new Date(b.attendance_date).getTime() - new Date(a.attendance_date).getTime());

            setHistoryRecords(meaningfulData);
        } catch (error: any) {
            console.error('Error loading history:', error);
            alert(error.message || 'Failed to load attendance history.');
        }
    }

    async function handleSave(isVerification = false) {
        if (!selectedDate) return;
        if (isVerification && confirmDate !== selectedDate) return;

        // Operational Integrity: Ensure all overrides have reasons
        const recordsWithMissingReasons = records.filter(r =>
            (r.punch_in !== r.raw_punch_in || r.punch_out !== r.raw_punch_out) &&
            (r.raw_punch_in || r.raw_punch_out) &&
            !r.correction_reason
        );

        if (recordsWithMissingReasons.length > 0) {
            alert(`Operational Integrity Error: ${recordsWithMissingReasons.length} record(s) have manual time overrides without a mandatory correction reason. Please provide reasons for all flagged records before saving.`);
            return;
        }

        try {
            setIsSaving(true);
            const recordsToSave = records.map(r => ({
                ...r,
                attendance_date: selectedDate,
                is_verified: isVerification ? true : r.is_verified,
                verified_by: isVerification ? user?.id : r.verified_by
            }));

            await upsertAttendanceRecords(recordsToSave);
            if (isVerification) await verifyDayRPC({
                p_date: selectedDate,
                p_verified_by: user?.id || '',
                ...(selectedShiftGroupId !== 'all' && { p_shift_group_id: selectedShiftGroupId }),
            });

            await loadData();
            setIsVerifyModalOpen(false);
            setConfirmDate('');
            alert(isVerification ? 'Day Verified Successfully' : 'Changes Saved Successfully');
        } catch (error: any) {
            console.error('Error saving attendance:', error);
            alert(error.message || 'Error saving changes');
        } finally {
            setIsSaving(false);
        }
    }



    const updateRecordLocal = (staffId: string, field: keyof AttendanceRecord, value: any, reason?: string) => {
        if (isWriteDisabled) return;

        const staffMember = staff.find(s => s.id === staffId);
        const record = records.find(r => r.staff_id === staffId);
        const oldValue = record ? record[field] : null;

        // Convert time input (HH:mm) to Full ISO if field is a punch field
        let finalValue = value;
        if (['punch_in', 'punch_out', 'lunch_in', 'lunch_out', 'break_start', 'break_end'].includes(field as string)) {
            const boundary = staffMember?.shift_group?.boundary_start_time || '06:00';
            finalValue = combineDateAndTimeWithBoundary(selectedDate, value, boundary);
        }

        // For HR Managers with direct approval rights
        if (canManageAttendance) {
            setRecords(prev => {
                const exists = prev.find(r => r.staff_id === staffId);
                const updatedFields: any = { [field]: finalValue };

                // If a reason is provided (passed from the UI), attach it to the local state
                if (reason !== undefined) {
                    updatedFields.correction_reason = reason;
                }

                if (exists) {
                    return prev.map(r => r.staff_id === staffId ? { ...r, ...updatedFields } : r);
                }
                return [...prev, { staff_id: staffId, ...updatedFields } as AttendanceRecord];
            });
            return;
        }

        // For standard users/managers - open the correction request modal
        if (!canApproveCorrection) {
            setCorrectionModal({ staffId, field, value: finalValue, oldValue });
            setCorrectionReason('');
        }
    };

    async function submitCorrection(staffId: string, field: string, value: any, reason: string) {
        try {
            setIsSaving(true);
            const impact: any = {};
            if (field === 'status') impact.status = value;
            else if (field === 'punch_in') impact.punch_in = value;
            else if (field === 'punch_out') impact.punch_out = value;
            // ... add others as needed

            await requestAttendanceCorrectionRPC({
                p_staff_id: staffId,
                p_date: selectedDate,
                p_type: field === 'status' ? 'STATUS_DISPUTE' : 'OTHER',
                p_reason: reason,
                p_proposed_impact: impact
            });
            await loadData();
        } catch (error: any) {
            alert(error.message);
        } finally {
            setIsSaving(false);
        }
    }

    const stats = useMemo(() => {
        const filteredStaff = selectedShiftGroupId === 'all'
            ? staff
            : staff.filter(s => s.shift_group_id === selectedShiftGroupId);
        const filteredStaffIds = new Set(filteredStaff.map(s => s.id));

        const filteredRecords = records.filter(r => filteredStaffIds.has(r.staff_id));
        const filteredLeaveDays = leaveDays.filter(ld => filteredStaffIds.has(ld.staff_id));
        const filteredIncidents = incidents.filter(i => filteredStaffIds.has(i.staff_id));
        const filteredCorrections = corrections.filter(c => filteredStaffIds.has(c.staff_id));

        const leaveStaffIds = new Set(filteredLeaveDays.map(ld => ld.staff_id));

        return {
            total: filteredStaff.length,
            present: filteredRecords.filter(r => ['PRESENT', 'LATE_PRESENT', 'EARLY_OUT'].includes(r.status)).length,
            absent: filteredStaff.length - leaveStaffIds.size - filteredRecords.filter(r => r.status && r.status !== 'ABSENT').length,
            leave: filteredLeaveDays.length,
            missPunch: filteredRecords.filter(r => r.status === 'MISS_PUNCH').length,
            incidents: filteredIncidents.filter(i => i.status === 'PENDING').length,
            corrections: filteredCorrections.filter(c => c.status === 'SUBMITTED' || c.status === 'MANAGER_REVIEW').length
        };
    }, [staff, records, incidents, leaveDays, corrections, selectedShiftGroupId]);

    const groupedStaff = useMemo(() => {
        const filtered = selectedShiftGroupId === 'all' ? staff : staff.filter(s => s.shift_group_id === selectedShiftGroupId);
        const groups: Record<string, StaffMaster[]> = {};
        filtered.forEach(s => {
            const name = s.shift_group?.name || 'Unassigned';
            if (!groups[name]) groups[name] = [];
            groups[name].push(s);
        });
        return groups;
    }, [staff, selectedShiftGroupId]);

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
                // Apply local timezone offset (offset is in minutes, e.g., -330 for IST which is UTC+5:30)
                // getTimezoneOffset() returns difference in minutes from local time to UTC.
                // For IST (UTC+5:30), it returns -330.
                // So local = UTC - offset
                const offset = new Date().getTimezoneOffset();
                mins = mins - offset;

                // Handle day wrap-around
                if (mins < 0) mins += 24 * 60;
                if (mins >= 24 * 60) mins -= 24 * 60;
            }
            return mins;
        }

        return null;
    };

    const profileMetrics = useMemo(() => {
        if (!selectedStaffId) return { late: 0, early: 0, overBreak: 0 };
        const s = staff.find(staff => staff.id === selectedStaffId);
        if (!s) return { late: 0, early: 0, overBreak: 0 };

        // Prefer the joined shift_group on the staff record, fall back to shiftGroups state
        const shiftGroup = s.shift_group || shiftGroups.find(g => g.id === s.shift_group_id);
        if (!shiftGroup) return { late: 0, early: 0, overBreak: 0 };

        let late = 0;
        let early = 0;
        let overBreak = 0;
        let overTime = 0;

        const shiftStart = parseTimeToMins(shiftGroup.start_time);
        const shiftEnd = parseTimeToMins(shiftGroup.end_time);
        const graceIn = shiftGroup.grace_in_minutes || 0;
        const graceOut = shiftGroup.grace_out_minutes || 0;
        const breakDur = shiftGroup.break_duration_minutes || 0;

        historyRecords.forEach(hr => {
            if (hr.status === 'HOLIDAY' || hr.status === 'LEAVE' || hr.status === 'WEEKLY_OFF') return;

            // Database time columns are returned as UTC strings without a timezone indicator (e.g., "03:30:00" for 9:00 AM IST)
            const pi = parseTimeToMins(hr.punch_in, true);
            const po = parseTimeToMins(hr.punch_out, true);
            const li = parseTimeToMins(hr.lunch_in, true);
            const lo = parseTimeToMins(hr.lunch_out, true);

            if (shiftStart !== null && pi !== null && pi > shiftStart + graceIn) {
                const excuse = hr.excused_late_minutes || 0;
                // Late minutes = how far past the grace window, minus any excused time
                const lateMins = (pi - (shiftStart + graceIn)) - excuse;
                if (lateMins > 0) late += lateMins;
            }

            if (shiftEnd !== null && po !== null && po < shiftEnd - graceOut) {
                // Early out minutes = how far before the grace-out cutoff
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
    }, [historyRecords, staff, shiftGroups, selectedStaffId]);

    return (
        <div className="flex flex-col h-full bg-[#020617] overflow-hidden">
            <div className="px-8 py-6 bg-slate-900/40 border-b border-slate-800 backdrop-blur-md">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div>
                        <h1 className="text-2xl font-black text-white uppercase tracking-[0.2em] flex items-center gap-4">
                            <Clock className="w-8 h-8 text-brand-500" /> Attendance Management
                        </h1>
                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-[0.3em] mt-2 ml-1">
                            Operational Hub • {activeTab === 'update' ? selectedDate : selectedMonth}
                        </p>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800">
                            {[
                                { id: 'update', label: 'Muster Roll' },
                                { id: 'incidents', label: 'Incidents Hub' },
                                { id: 'profiles', label: 'Staff Profiles' },
                                { id: 'reports', label: 'Reports Pack' },
                                { id: 'policy', label: 'Policy Settings' }
                            ].map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`px-6 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-white'}`}>
                                    {tab.label}
                                    {tab.id === 'incidents' && stats.incidents > 0 && (
                                        <span className="ml-2 px-1.5 py-0.5 bg-rose-500 text-white text-[8px] rounded-full font-black">{stats.incidents}</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {activeTab === 'update' && (
                    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex flex-wrap items-start gap-4">
                            <div className="flex items-start gap-3">
                                <div className="flex flex-col gap-1.5">
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        max={getYesterdayISO()}
                                        onChange={e => setSelectedDate(e.target.value)}
                                        className="input-base !py-2.5 !px-4 text-[12px] font-black tracking-widest bg-slate-900 border-slate-700 w-44"
                                    />
                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest pl-1">
                                        {getWeekday(selectedDate)}
                                    </div>
                                </div>
                                {isWriteDisabled && (
                                    <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest mt-0">
                                        <Lock className="w-3 h-3" /> Locked
                                    </div>
                                )}
                            </div>
                            <select value={selectedShiftGroupId} onChange={e => setSelectedShiftGroupId(e.target.value)} className="input-base !py-2.5 !px-4 text-[12px] font-black tracking-widest bg-slate-900 border-slate-700 w-48 appearance-none mt-0">
                                <option value="all">All Shifts</option>
                                {shiftGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                            {canManageAttendance && (
                                <button
                                    onClick={() => setIsIncidentModalOpen(true)}
                                    disabled={isWriteDisabled}
                                    className="flex items-center justify-center gap-2 px-5 py-2.5 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all ml-auto disabled:opacity-50 disabled:hover:bg-rose-500/10 disabled:hover:text-rose-500 mt-0"
                                >
                                    <ShieldAlert className="w-4 h-4" /> {isWriteDisabled ? 'Locked' : 'Report Incident'}
                                </button>
                            )}
                            {canManageAttendance && (
                                <button
                                    onClick={() => setIsVerifyModalOpen(true)}
                                    disabled={isSaving || isWriteDisabled}
                                    className="btn-primary !py-2 disabled:opacity-50"
                                >
                                    {isSaving ? <div className="spinner !w-4 !h-4" /> : <Save className="w-4 h-4" />}
                                    {isWriteDisabled ? 'Period Locked' : 'Save & Verify Day'}
                                </button>
                            )}
                        </div>

                        {!selectedDate ? (
                            <div className="surface-card py-32 flex flex-col items-center justify-center text-center space-y-4 border-dashed border-slate-800">
                                <div className="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800 animate-pulse">
                                    <Calendar className="w-8 h-8 text-slate-700" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Awaiting Date Selection</h3>
                                    <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-2 max-w-xs mx-auto leading-relaxed">
                                        Please select an operational date from the picker above to load the attendance muster roll.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                                    {[
                                        { label: 'Active Staff', value: stats.total, icon: Users, color: 'text-slate-400' },
                                        { label: 'Present', value: stats.present, icon: CheckCircle2, color: 'text-emerald-500' },
                                        { label: 'Absent', value: stats.absent, icon: X, color: 'text-rose-500' },
                                        { label: 'Leave', value: stats.leave, icon: Coffee, color: 'text-indigo-400' },
                                        { label: 'Miss Punch', value: stats.missPunch, icon: AlertCircle, color: 'text-amber-500' },
                                        { label: 'Incidents', value: stats.incidents, icon: ShieldAlert, color: 'text-rose-400' },
                                    ].map((stat, i) => (
                                        <div key={i} className="surface-card p-4 border border-slate-800 flex items-center gap-4">
                                            <div className={`p-2 rounded-lg bg-slate-900 ${stat.color}`}>
                                                <stat.icon size={16} />
                                            </div>
                                            <div>
                                                <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest">{stat.label}</div>
                                                <div className="text-lg font-black text-white">{stat.value}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-6">
                                    {Object.entries(groupedStaff).map(([shiftName, members]) => (
                                        <div key={shiftName} className="space-y-4">
                                            <div className="flex items-center gap-4">
                                                <div className="h-px flex-1 bg-slate-800" />
                                                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">{shiftName} Strategy ({members.length})</h3>
                                                <div className="h-px flex-1 bg-slate-800" />
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                                {members.map(s => {
                                                    const record = records.find(r => r.staff_id === s.id);
                                                    const status = record?.status || 'ABSENT';
                                                    const isLeave = leaveDays.some(l => l.staff_id === s.id);

                                                    return (
                                                        <div key={s.id} className={`surface-card p-4 border transition-all ${isLeave ? 'border-indigo-500/30' : 'border-slate-800'}`}>
                                                            <div className="flex items-start justify-between mb-4">
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-xs font-black text-brand-400">
                                                                        {s.full_name?.[0]}
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-xs font-black text-white flex items-center gap-2">
                                                                            {s.full_name}
                                                                            {record?.has_pending_correction && (
                                                                                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" title="Correction Pending" />
                                                                            )}
                                                                        </div>
                                                                        <div className="text-[8px] font-black text-slate-500 uppercase">{s.staff_code}</div>
                                                                    </div>
                                                                </div>
                                                                {record?.is_verified && <CheckCircle2 size={14} className="text-emerald-500" />}
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 mb-4">
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Punch In</label>
                                                                        {record?.punch_in && record?.raw_punch_in && record.punch_in !== record.raw_punch_in && (
                                                                            <span className="text-[6px] font-black text-amber-500 uppercase px-1 bg-amber-500/10 rounded border border-amber-500/20">Override</span>
                                                                        )}
                                                                        {record?.punch_in === record?.raw_punch_in && record?.raw_punch_in && (
                                                                            <span className="text-[6px] font-black text-slate-600 uppercase">Captured</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="relative group/time">
                                                                        <TimeInput12
                                                                            disabled={isWriteDisabled || isLeave}
                                                                            value={formatISOToLocalTime(record?.punch_in || null)}
                                                                            onChange={val => updateRecordLocal(s.id, 'punch_in', val)}
                                                                            className="w-full"
                                                                        />
                                                                        {(record?.late_minutes || 0) > 0 && (
                                                                            <div className="absolute -top-1 -right-1 flex gap-1">
                                                                                <span className={`px-1 rounded text-[7px] font-black ${record?.excused_late_minutes ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                                                                                    {record?.late_minutes}m
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[7px] font-black text-slate-500 uppercase tracking-widest">Punch Out</label>
                                                                        {record?.punch_out && record?.raw_punch_out && record.punch_out !== record.raw_punch_out && (
                                                                            <span className="text-[6px] font-black text-amber-500 uppercase px-1 bg-amber-500/10 rounded border border-amber-500/20">Override</span>
                                                                        )}
                                                                        {record?.punch_out === record?.raw_punch_out && record?.raw_punch_out && (
                                                                            <span className="text-[6px] font-black text-slate-600 uppercase">Captured</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="relative group/time">
                                                                        <TimeInput12
                                                                            disabled={isWriteDisabled || isLeave}
                                                                            value={formatISOToLocalTime(record?.punch_out || null)}
                                                                            onChange={val => updateRecordLocal(s.id, 'punch_out', val)}
                                                                            className="w-full"
                                                                        />
                                                                        {(record?.early_out_minutes || 0) > 0 && (
                                                                            <div className="absolute -top-1 -right-1 flex gap-1">
                                                                                <span className={`px-1 rounded text-[7px] font-black ${record?.excused_early_out_minutes ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>
                                                                                    {record?.early_out_minutes}m
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[7px] font-black text-rose-400 uppercase tracking-widest">Lunch Out</label>
                                                                    <TimeInput12
                                                                        disabled={isWriteDisabled || isLeave}
                                                                        value={formatISOToLocalTime(record?.lunch_out || null)}
                                                                        onChange={val => updateRecordLocal(s.id, 'lunch_out', val)}
                                                                        className="w-full"
                                                                    />
                                                                </div>
                                                                <div className="space-y-1">
                                                                    <label className="text-[7px] font-black text-emerald-400 uppercase tracking-widest">Lunch In</label>
                                                                    <TimeInput12
                                                                        disabled={isWriteDisabled || isLeave}
                                                                        value={formatISOToLocalTime(record?.lunch_in || null)}
                                                                        onChange={val => updateRecordLocal(s.id, 'lunch_in', val)}
                                                                        className="w-full"
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* Operational Auditing: Show Correction Reason if Overridden */}
                                                            {(record?.punch_in !== record?.raw_punch_in || record?.punch_out !== record?.raw_punch_out) && (record?.raw_punch_in || record?.raw_punch_out) && (
                                                                <div className="mb-4 space-y-1 animate-in slide-in-from-top-1 duration-300">
                                                                    <div className="flex items-center justify-between">
                                                                        <label className="text-[7px] font-black text-amber-500 uppercase tracking-widest flex items-center gap-1">
                                                                            <AlertCircle size={8} /> Mandatory Correction Reason
                                                                        </label>
                                                                        {!record?.correction_reason && <span className="text-[6px] text-rose-500 font-black animate-pulse uppercase">Required</span>}
                                                                    </div>
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Why was this manually changed?"
                                                                        disabled={isWriteDisabled}
                                                                        value={record?.correction_reason || ''}
                                                                        onChange={e => updateRecordLocal(s.id, 'correction_reason', e.target.value, e.target.value)}
                                                                        className={`w-full bg-amber-500/5 border ${!record?.correction_reason ? 'border-rose-500/30 animate-pulse' : 'border-amber-500/20'} rounded-lg px-2 py-1.5 text-[10px] text-white outline-none focus:border-amber-500`}
                                                                    />
                                                                </div>
                                                            )}

                                                            {record?.excused_late_minutes && (
                                                                <div className="mb-4 p-2 bg-emerald-500/5 border border-emerald-500/10 rounded-lg flex flex-col gap-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[7px] font-black text-emerald-500 uppercase">Excused Lateness</span>
                                                                        <span className="text-[8px] font-black text-emerald-400">-{record.excused_late_minutes}m</span>
                                                                    </div>
                                                                    <div className="text-[7px] text-slate-500 font-bold italic truncate">
                                                                        {record.incident?.resolution_reason || 'Manager Approved'}
                                                                    </div>
                                                                </div>
                                                            )}

                                                            <div className="flex items-center justify-between gap-2">
                                                                <select
                                                                    value={status}
                                                                    disabled={isWriteDisabled || isLeave}
                                                                    onChange={e => updateRecordLocal(s.id, 'status', e.target.value)}
                                                                    className={`flex-1 text-[9px] font-black uppercase tracking-widest p-2 rounded-lg border border-slate-800 outline-none transition-all ${status === 'PRESENT' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                                        status === 'ABSENT' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                                            'bg-slate-900 text-slate-400'
                                                                        }`}
                                                                >
                                                                    <option value="PRESENT" className="bg-slate-950 text-slate-300">Present</option>
                                                                    <option value="ABSENT" className="bg-slate-950 text-slate-300">Absent</option>
                                                                    <option value="HALF_DAY" className="bg-slate-950 text-slate-300">Half Day</option>
                                                                    <option value="MISS_PUNCH" className="bg-slate-950 text-slate-300">Miss Punch</option>
                                                                    <option value="LATE_PRESENT" className="bg-slate-950 text-slate-300">Late Present</option>
                                                                    <option value="EARLY_OUT" className="bg-slate-950 text-slate-300">Early Out</option>
                                                                </select>

                                                                <button
                                                                    onClick={() => {
                                                                        setSelectedAuditRecordId(record?.id || null);
                                                                        if (record?.id) {
                                                                            fetchAttendanceAuditLogs(record.id).then(setAuditLogs);
                                                                        }
                                                                    }}
                                                                    className="p-2 hover:bg-slate-800 rounded-lg text-slate-500 transition-colors"
                                                                >
                                                                    <HistoryIcon size={14} />
                                                                </button>
                                                            </div>

                                                            {isLeave && (
                                                                <div className="mt-3 p-2 bg-indigo-500/5 border border-indigo-500/10 rounded-lg flex items-center gap-2">
                                                                    <Coffee size={10} className="text-indigo-400" />
                                                                    <span className="text-[8px] font-black text-indigo-400 uppercase">On Approved Leave</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {activeTab === 'incidents' && (
                    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                                    <ShieldAlert className="w-6 h-6 text-rose-500" /> Incidents Hub
                                </h2>
                                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">Resolve and track operational delays</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            {incidents.length === 0 ? (
                                <div className="surface-card py-20 flex flex-col items-center justify-center text-center border-dashed border-slate-800">
                                    <CheckCircle2 className="w-12 h-12 text-slate-800 mb-4" />
                                    <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">No Pending Incidents</h3>
                                </div>
                            ) : (
                                incidents.map(incident => (
                                    <div key={incident.id} className="surface-card p-6 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-0.5 text-[8px] font-black rounded-full uppercase tracking-widest border ${incident.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                    incident.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                        'bg-brand-500/10 text-brand-500 border-brand-500/20'
                                                    }`}>
                                                    {incident.incident_type} Request
                                                </span>
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{incident.attendance_date}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-black text-brand-400">
                                                    {incident.staff?.full_name?.[0]}
                                                </div>
                                                <div>
                                                    <div className="text-xs font-black text-white">{incident.staff?.full_name}</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase">{incident.staff?.staff_code}</div>
                                                </div>
                                            </div>
                                            <h4 className="text-sm font-black text-white uppercase tracking-tight italic">"{incident.staff_reason}"</h4>
                                            <div className="flex flex-wrap gap-2 pt-2">
                                                {Object.entries(incident.impact_data || {}).map(([key, val]: [string, any]) => (
                                                    <div key={key} className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                                        {key.replace(/_/g, ' ')}: {val}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {incident.status === 'PENDING' && canManageAttendance && (
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Approval Reason (Optional):');
                                                        try {
                                                            await resolveAttendanceIncidentRPC({ p_incident_id: incident.id, p_status: 'APPROVED', p_reason: reason || 'Approved' });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Rejection Reason (Optional):');
                                                        try {
                                                            await resolveAttendanceIncidentRPC({ p_incident_id: incident.id, p_status: 'REJECTED', p_reason: reason || 'Rejected' });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-slate-800 text-slate-400 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-500 hover:text-white transition-all"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Corrections Section */}
                        <div className="flex items-center justify-between mt-12">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                                    <HistoryIcon className="w-6 h-6 text-indigo-500" /> Correction Hub
                                </h2>
                                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">Manual Adjustments & Disputes</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            {corrections.length === 0 ? (
                                <div className="surface-card py-20 flex flex-col items-center justify-center text-center border-dashed border-slate-800">
                                    <CheckCircle2 className="w-12 h-12 text-slate-800 mb-4" />
                                    <h3 className="text-xs font-black text-slate-600 uppercase tracking-widest">No Pending Corrections</h3>
                                </div>
                            ) : (
                                corrections.map(corr => (
                                    <div key={corr.id} className="surface-card p-6 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-3">
                                                <span className={`px-2 py-0.5 text-[8px] font-black rounded-full uppercase tracking-widest border ${corr.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                    corr.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                        'bg-indigo-500/10 text-indigo-500 border-indigo-500/20'
                                                    }`}>
                                                    {corr.type} Correction ({corr.status})
                                                </span>
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{corr.attendance_date}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-black text-brand-400">
                                                    {corr.staff?.full_name?.[0]}
                                                </div>
                                                <div>
                                                    <div className="text-xs font-black text-white">{corr.staff?.full_name}</div>
                                                    <div className="text-[8px] font-bold text-slate-500 uppercase">{corr.staff?.staff_code}</div>
                                                </div>
                                            </div>
                                            <h4 className="text-sm font-black text-white uppercase tracking-tight italic">"{corr.reason}"</h4>
                                            <div className="flex flex-wrap gap-2 pt-2">
                                                {Object.entries(corr.proposed_impact || {}).map(([key, val]: [string, any]) => (
                                                    <div key={key} className="px-3 py-1 bg-slate-900 border border-slate-800 rounded-lg text-[9px] font-black text-indigo-400 uppercase tracking-widest">
                                                        {key.replace(/_/g, ' ')}: {val}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Manager Approval Stage */}
                                        {corr.status === 'SUBMITTED' && (canManageAttendance || canApproveCorrection) && (
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Review Reason (Optional):');
                                                        try {
                                                            await resolveAttendanceCorrectionRPC({ p_correction_id: corr.id, p_action: 'MANAGER_APPROVE', p_reason: reason || 'Reviewed' });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-indigo-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-500/20"
                                                >
                                                    Mgr Approve
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Rejection Reason (Required):');
                                                        if (!reason) return;
                                                        try {
                                                            await resolveAttendanceCorrectionRPC({ p_correction_id: corr.id, p_action: 'MANAGER_REJECT', p_reason: reason });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/20"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        )}

                                        {/* HR Final Approval Stage */}
                                        {corr.status === 'MANAGER_REVIEW' && canManageAttendance && (
                                            <div className="flex items-center gap-3">
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Review Reason (Optional):');
                                                        try {
                                                            await resolveAttendanceCorrectionRPC({ p_correction_id: corr.id, p_action: 'HR_APPROVE', p_reason: reason || 'Reviewed' });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                                                >
                                                    Final Approve
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        const reason = prompt('Rejection Reason (Required):');
                                                        if (!reason) return;
                                                        try {
                                                            await resolveAttendanceCorrectionRPC({ p_correction_id: corr.id, p_action: 'HR_REJECT', p_reason: reason });
                                                            loadData();
                                                        } catch (e: any) { alert(e.message); }
                                                    }}
                                                    className="px-6 py-2 bg-rose-500 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-500/20"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'profiles' && (
                    <div className="flex h-full animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
                        <div className="w-80 border-r border-slate-800 bg-slate-900/20 flex flex-col">
                            <div className="p-6 border-b border-slate-800">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Search Staff..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-xl py-2 pl-10 pr-4 text-[10px] text-white outline-none focus:border-brand-500"
                                    />
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {filteredStaffList.length === 0 ? (
                                    <div className="p-10 text-center text-[10px] font-black text-slate-600 uppercase">No Staff Found</div>
                                ) : (
                                    filteredStaffList.map(s => (
                                        <button
                                            key={s.id}
                                            onClick={() => setSelectedStaffId(s.id)}
                                            className={`w-full p-4 flex items-center gap-3 border-b border-slate-800/50 transition-all ${selectedStaffId === s.id ? 'bg-brand-500/10 border-r-2 border-r-brand-500' : 'hover:bg-slate-800/30'}`}
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-[10px] font-black text-brand-400 uppercase">
                                                {s.full_name?.[0] || '?'}
                                            </div>
                                            <div className="text-left">
                                                <div className="text-[10px] font-black text-white uppercase">{s.full_name}</div>
                                                <div className="text-[8px] font-bold text-slate-500 uppercase">{s.staff_code}</div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/20">
                            {!selectedStaffId || !staff.find(s => s.id === selectedStaffId) ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
                                    <div className="w-16 h-16 rounded-full bg-slate-900 flex items-center justify-center border border-slate-800">
                                        <User className="w-6 h-6 text-slate-700" />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest">Select a staff member</h3>
                                        <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-1">To view complete attendance history</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 flex flex-col overflow-hidden">
                                    <div className="p-8 border-b border-slate-800 flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-sm font-black text-brand-400">
                                                {staff.find(s => s.id === selectedStaffId)?.full_name?.[0] || '?'}
                                            </div>
                                            <div>
                                                <h2 className="text-lg font-black text-white uppercase tracking-tight">{staff.find(s => s.id === selectedStaffId)?.full_name || 'Selected Staff'}</h2>
                                                <div className="flex items-center gap-3 mt-1">
                                                    <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{staff.find(s => s.id === selectedStaffId)?.staff_code || '---'}</span>
                                                    <span className="w-1 h-1 rounded-full bg-slate-800" />
                                                    <span className="text-[9px] font-black text-brand-400 uppercase tracking-widest">{staff.find(s => s.id === selectedStaffId)?.shift_group?.name || 'Standard Shift'}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-2 text-[10px] font-black text-white outline-none focus:border-brand-500" />
                                        </div>
                                    </div>

                                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                                            <div className="surface-card p-6 border border-rose-500/20 bg-rose-500/5 rounded-2xl flex flex-col justify-center transform hover:scale-105 hover:border-rose-500/40 transition-all duration-300 shadow-xl shadow-rose-500/5">
                                                <div className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Total Late</div>
                                                <div className="text-4xl font-display font-black text-rose-400">{profileMetrics.late}<span className="text-xs text-rose-500/50 uppercase ml-2 tracking-widest font-bold">mins</span></div>
                                            </div>
                                            <div className="surface-card p-6 border border-orange-500/20 bg-orange-500/5 rounded-2xl flex flex-col justify-center transform hover:scale-105 hover:border-orange-500/40 transition-all duration-300 shadow-xl shadow-orange-500/5">
                                                <div className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">Total Early Out</div>
                                                <div className="text-4xl font-display font-black text-orange-400">{profileMetrics.early}<span className="text-xs text-orange-500/50 uppercase ml-2 tracking-widest font-bold">mins</span></div>
                                            </div>
                                            <div className="surface-card p-6 border border-amber-500/20 bg-amber-500/5 rounded-2xl flex flex-col justify-center transform hover:scale-105 hover:border-amber-500/40 transition-all duration-300 shadow-xl shadow-amber-500/5">
                                                <div className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Excess Break</div>
                                                <div className="text-4xl font-display font-black text-amber-400">{profileMetrics.overBreak}<span className="text-xs text-amber-500/50 uppercase ml-2 tracking-widest font-bold">mins</span></div>
                                            </div>
                                            <div className="surface-card p-6 border border-emerald-500/20 bg-emerald-500/5 rounded-2xl flex flex-col justify-center transform hover:scale-105 hover:border-emerald-500/40 transition-all duration-300 shadow-xl shadow-emerald-500/5">
                                                <div className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Over Time</div>
                                                <div className="text-4xl font-display font-black text-emerald-400">{profileMetrics.overTime}<span className="text-xs text-emerald-500/50 uppercase ml-2 tracking-widest font-bold">mins</span></div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-4">
                                            {historyRecords.length === 0 ? (
                                                <div className="surface-card py-20 text-center border-dashed border-slate-800">
                                                    <Calendar className="w-12 h-12 text-slate-800 mx-auto mb-4" />
                                                    <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-widest">No Records Found</h3>
                                                </div>
                                            ) : (
                                                <div className="surface-card border border-slate-800 overflow-hidden">
                                                    <table className="w-full text-left border-collapse">
                                                        <thead>
                                                            <tr className="bg-slate-900/50 border-b border-slate-800">
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">In</th>
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">L-Out</th>
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">L-In</th>
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Out</th>
                                                                <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {historyRecords.map((hr, idx) => (
                                                                <tr key={`${hr.attendance_date}-${idx}`} className="border-b border-slate-800/50">
                                                                    <td className="px-6 py-4 text-[10px] font-bold text-slate-300">{hr.attendance_date}</td>
                                                                    <td className="px-6 py-4 text-[10px] text-white">
                                                                        {hr.punch_in ? (() => {
                                                                            if (hr.punch_in.includes('T')) return new Date(hr.punch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                                                            const d = new Date(`${hr.attendance_date}T${hr.punch_in}Z`);
                                                                            return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : hr.punch_in;
                                                                        })() : '--:--'}
                                                                    </td>
                                                                    <td className="px-6 py-4 text-[10px] text-rose-400">
                                                                        {hr.lunch_out ? (() => {
                                                                            if (hr.lunch_out.includes('T')) return new Date(hr.lunch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                                                            const d = new Date(`${hr.attendance_date}T${hr.lunch_out}Z`);
                                                                            return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : hr.lunch_out;
                                                                        })() : '--:--'}
                                                                    </td>
                                                                    <td className="px-6 py-4 text-[10px] text-emerald-400">
                                                                        {hr.lunch_in ? (() => {
                                                                            if (hr.lunch_in.includes('T')) return new Date(hr.lunch_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                                                            const d = new Date(`${hr.attendance_date}T${hr.lunch_in}Z`);
                                                                            return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : hr.lunch_in;
                                                                        })() : '--:--'}
                                                                    </td>
                                                                    <td className="px-6 py-4 text-[10px] text-white">
                                                                        {hr.punch_out ? (() => {
                                                                            if (hr.punch_out.includes('T')) return new Date(hr.punch_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
                                                                            const d = new Date(`${hr.attendance_date}T${hr.punch_out}Z`);
                                                                            return !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : hr.punch_out;
                                                                        })() : '--:--'}
                                                                    </td>
                                                                    <td className="px-6 py-4">
                                                                        <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase ${hr.status === 'PRESENT' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                                                                            {hr.status}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'reports' && (
                    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 overflow-y-auto custom-scrollbar h-full">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-6">
                                <button onClick={() => setSelectedReport('daily')} className={`text-xs font-black uppercase tracking-widest pb-2 border-b-2 transition-all ${selectedReport === 'daily' ? 'border-brand-500 text-white' : 'border-transparent text-slate-500'}`}>Daily Summary</button>
                                <button onClick={() => setSelectedReport('late')} className={`text-xs font-black uppercase tracking-widest pb-2 border-b-2 transition-all ${selectedReport === 'late' ? 'border-brand-500 text-white' : 'border-transparent text-slate-500'}`}>Late Report</button>
                            </div>
                        </div>

                        {selectedReport === 'daily' && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                <div className="surface-card p-6 border border-slate-800">
                                    <div className="text-[8px] font-black text-slate-500 uppercase tracking-widest mb-2">Total Staff</div>
                                    <div className="text-3xl font-black text-white">{dailySummary?.total_staff || 0}</div>
                                </div>
                                <div className="surface-card p-6 border border-emerald-500/20 bg-emerald-500/5">
                                    <div className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-2">Present</div>
                                    <div className="text-3xl font-black text-emerald-400">{dailySummary?.present_count || 0}</div>
                                </div>
                                <div className="surface-card p-6 border border-rose-500/20 bg-rose-500/5">
                                    <div className="text-[8px] font-black text-rose-500 uppercase tracking-widest mb-2">Absent</div>
                                    <div className="text-3xl font-black text-rose-400">{dailySummary?.absent_count || 0}</div>
                                </div>
                                <div className="surface-card p-6 border border-indigo-500/20 bg-indigo-500/5">
                                    <div className="text-[8px] font-black text-indigo-500 uppercase tracking-widest mb-2">On Leave</div>
                                    <div className="text-3xl font-black text-indigo-400">{dailySummary?.leave_count || 0}</div>
                                </div>
                            </div>
                        )}

                        {selectedReport === 'late' && (
                            <div className="surface-card border border-slate-800 overflow-hidden">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-900 border-b border-slate-800">
                                            <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Staff Name</th>
                                            <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Date</th>
                                            <th className="px-6 py-4 text-[8px] font-black text-slate-500 uppercase tracking-widest">Late Mins</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {reportData.map((row, idx) => (
                                            <tr key={idx} className="border-b border-slate-800/50">
                                                <td className="px-6 py-4 text-[10px] font-black text-white uppercase">{row.full_name}</td>
                                                <td className="px-6 py-4 text-[10px] text-slate-400">{row.attendance_date}</td>
                                                <td className="px-6 py-4 text-[10px] font-black text-rose-500">{row.late_minutes}m</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}



                {activeTab === 'policy' && (
                    <div className="p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-black text-white uppercase tracking-widest flex items-center gap-3">
                                    <Settings className="w-6 h-6 text-brand-500" /> Attendance Policies
                                </h2>
                                <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">Configure shifts and operational rules</p>
                            </div>
                            <button
                                onClick={() => { setEditingShift({}); setIsShiftModalOpen(true); }}
                                className="btn-primary !py-2"
                            >
                                <Plus className="w-4 h-4" /> Add New Shift
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {shiftGroups.map(shift => (
                                <div key={shift.id} className="surface-card p-6 border border-slate-800 space-y-4 hover:border-brand-500/30 transition-all group">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <h4 className="text-sm font-black text-white uppercase tracking-tight group-hover:text-brand-400 transition-colors">{shift.name}</h4>
                                            <div className="flex items-center gap-2 mt-1">
                                                <Clock className="w-3 h-3 text-slate-500" />
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{shift.start_time} - {shift.end_time}</span>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-[8px] font-black uppercase ${shift.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-slate-800 text-slate-600'}`}>
                                            {shift.is_active ? 'Active' : 'Deactivated'}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-800/50">
                                        <div>
                                            <div className="text-[7px] font-black text-slate-600 uppercase tracking-widest">Grace Period (In/Out)</div>
                                            <div className="text-[10px] font-black text-slate-300 uppercase">{shift.grace_in_minutes}m / {shift.grace_out_minutes}m</div>
                                        </div>
                                        <div>
                                            <div className="text-[7px] font-black text-slate-600 uppercase tracking-widest">Break Duration</div>
                                            <div className="text-[10px] font-black text-slate-300 uppercase">{shift.break_duration_minutes}m</div>
                                        </div>
                                        <div>
                                            <div className="text-[7px] font-black text-slate-600 uppercase tracking-widest">Min Hrs (Full/Half)</div>
                                            <div className="text-[10px] font-black text-slate-300 uppercase">{shift.min_hours_present}h / {shift.min_hours_half_day}h</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 pt-2">
                                        <button
                                            onClick={() => { setEditingShift(shift); setIsShiftModalOpen(true); }}
                                            className="flex-1 py-2 bg-slate-900 border border-slate-800 text-slate-400 text-[9px] font-black uppercase tracking-widest hover:text-white hover:border-slate-700 transition-all flex items-center justify-center gap-2 rounded-lg"
                                        >
                                            <Edit3 className="w-3 h-3" /> Edit
                                        </button>
                                        <button
                                            onClick={async () => {
                                                if (confirm(`Delete shift "${shift.name}"?`)) {
                                                    try { await deleteShiftGroup(shift.id); await loadData(); }
                                                    catch (e: any) { alert(e.message); }
                                                }
                                            }}
                                            className="px-3 py-2 bg-rose-500/10 text-rose-500 border border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all rounded-lg"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {isShiftModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="surface-card w-full max-w-lg border border-slate-800 shadow-2xl p-8 space-y-8 animate-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] flex items-center gap-3">
                                <Settings className="w-5 h-5 text-brand-500" /> {editingShift?.id ? 'Edit Shift Strategy' : 'Create New Shift'}
                            </h3>
                            <button onClick={() => setIsShiftModalOpen(false)} className="text-slate-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="col-span-2 space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Shift Nomenclature</label>
                                <input
                                    type="text"
                                    value={editingShift?.name || ''}
                                    onChange={e => setEditingShift({ ...editingShift, name: e.target.value })}
                                    className="input-base"
                                    placeholder="e.g., General Shift, Night Shift"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Commencement Time</label>
                                <input
                                    type="time"
                                    value={editingShift?.start_time || ''}
                                    onChange={e => setEditingShift({ ...editingShift, start_time: e.target.value })}
                                    className="input-base"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Conclusion Time</label>
                                <input
                                    type="time"
                                    value={editingShift?.end_time || ''}
                                    onChange={e => setEditingShift({ ...editingShift, end_time: e.target.value })}
                                    className="input-base"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Grace In (Mins)</label>
                                <input
                                    type="number"
                                    value={editingShift?.grace_in_minutes === undefined || editingShift?.grace_in_minutes === 0 ? '' : editingShift?.grace_in_minutes}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, grace_in_minutes: e.target.value === '' ? 0 : parseInt(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="0"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Grace Out (Mins)</label>
                                <input
                                    type="number"
                                    value={editingShift?.grace_out_minutes === undefined || editingShift?.grace_out_minutes === 0 ? '' : editingShift?.grace_out_minutes}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, grace_out_minutes: e.target.value === '' ? 0 : parseInt(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="0"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-brand-500 uppercase tracking-widest block ml-1">Boundary Start</label>
                                <input
                                    type="time"
                                    value={editingShift?.boundary_start_time || ''}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, boundary_start_time: e.target.value } : null)}
                                    className="input-base border-brand-500/20"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Min Hrs (Full)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={editingShift?.min_hours_present === undefined || editingShift?.min_hours_present === 0 ? '' : editingShift?.min_hours_present}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, min_hours_present: e.target.value === '' ? 0 : parseFloat(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="8"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Min Hrs (Half)</label>
                                <input
                                    type="number"
                                    step="0.5"
                                    value={editingShift?.min_hours_half_day === undefined || editingShift?.min_hours_half_day === 0 ? '' : editingShift?.min_hours_half_day}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, min_hours_half_day: e.target.value === '' ? 0 : parseFloat(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="4"
                                />
                            </div>

                            <div className="col-span-2 space-y-3 p-4 bg-slate-900/50 border border-slate-800 rounded-xl">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Weekly Off Strategy</label>
                                <div className="flex flex-wrap gap-2">
                                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                                        <button
                                            key={day}
                                            onClick={() => {
                                                const current = editingShift?.weekly_off || [];
                                                const next = current.includes(idx) ? current.filter(d => d !== idx) : [...current, idx];
                                                setEditingShift({ ...editingShift!, weekly_off: next });
                                            }}
                                            className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${(editingShift?.weekly_off || []).includes(idx)
                                                ? 'bg-brand-500/20 border-brand-500 text-brand-500'
                                                : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-white'
                                                }`}
                                        >
                                            {day}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-rose-500 uppercase tracking-widest block ml-1">Penalty / Min</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={editingShift?.penalty_per_minute === undefined ? '' : editingShift?.penalty_per_minute}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, penalty_per_minute: e.target.value === '' ? 0 : parseFloat(e.target.value) } : null)}
                                    className="input-base border-rose-500/10"
                                    placeholder="0.00"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Max Penalty %</label>
                                <input
                                    type="number"
                                    value={editingShift?.max_monthly_penalty_pct === undefined ? '' : editingShift?.max_monthly_penalty_pct}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, max_monthly_penalty_pct: e.target.value === '' ? 10 : parseFloat(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="10"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Break Duration (Mins)</label>
                                <input
                                    type="number"
                                    value={editingShift?.break_duration_minutes === undefined || editingShift?.break_duration_minutes === 0 ? '' : editingShift?.break_duration_minutes}
                                    onChange={e => setEditingShift(prev => prev ? { ...prev, break_duration_minutes: e.target.value === '' ? 0 : parseInt(e.target.value) } : null)}
                                    className="input-base"
                                    placeholder="0"
                                />
                            </div>

                            <div className="space-y-2 flex items-end">
                                <label className="flex items-center gap-3 cursor-pointer group p-3 bg-slate-900 border border-slate-800 rounded-xl w-full">
                                    <input
                                        type="checkbox"
                                        checked={editingShift?.is_active ?? true}
                                        onChange={e => setEditingShift(prev => prev ? { ...prev, is_active: e.target.checked } : null)}
                                        className="sr-only"
                                    />
                                    <div className={`w-10 h-5 rounded-full p-1 transition-colors ${editingShift?.is_active ?? true ? 'bg-brand-500' : 'bg-slate-800'}`}>
                                        <div className={`w-3 h-3 bg-white rounded-full transition-transform ${editingShift?.is_active ?? true ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </div>
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-white transition-colors">Operational</span>
                                </label>
                            </div>
                        </div>

                        <div className="flex gap-4">
                            <button
                                onClick={async () => {
                                    if (!editingShift?.name || !editingShift?.start_time || !editingShift?.end_time) {
                                        alert('Please fill mandatory fields'); return;
                                    }
                                    try {
                                        setIsSaving(true);
                                        await upsertShiftGroup(editingShift);
                                        await loadData();
                                        setIsShiftModalOpen(false);
                                    } catch (e: any) {
                                        alert(e.message);
                                    } finally { setIsSaving(false); }
                                }}
                                disabled={isSaving}
                                className="flex-1 btn-primary !py-4"
                            >
                                {isSaving ? <div className="spinner !w-4 !h-4" /> : 'Commit Strategy'}
                            </button>
                            <button
                                onClick={() => setIsShiftModalOpen(false)}
                                className="px-8 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <DelayIncidentModal isOpen={isIncidentModalOpen} onClose={() => setIsIncidentModalOpen(false)} onSuccess={loadData} currentDate={selectedDate} />

            {correctionModal && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="surface-card w-full max-w-md border border-slate-800 shadow-2xl p-6 space-y-6">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                <AlertCircle className="w-5 h-5 text-amber-500" /> Manual Correction Setup
                            </h3>
                            <button onClick={() => setCorrectionModal(null)} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-xl space-y-2">
                            <div className="text-[9px] font-black text-slate-500 uppercase mb-1">Changing {correctionModal?.field}</div>
                            <div className="text-xs text-white">From <span className="text-slate-500">{String(correctionModal?.oldValue || 'Empty')}</span> to <span className="text-brand-400 font-black">{String(correctionModal?.value)}</span></div>
                        </div>
                        <div className="space-y-2">
                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block">Adjustment Reason (Mandatory)</label>
                            <textarea value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} placeholder="Explain why this change is needed..." className="w-full bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-white h-32 outline-none focus:ring-1 focus:ring-brand-500" />
                        </div>
                        <button
                            onClick={async () => {
                                if (!correctionModal || !correctionReason.trim()) return;
                                await submitCorrection(correctionModal.staffId, correctionModal.field as string, correctionModal.value, correctionReason);
                                setCorrectionModal(null);
                            }}
                            disabled={!correctionReason.trim()}
                            className="w-full btn-primary !py-3 disabled:opacity-50"
                        >
                            Save Correction
                        </button>
                    </div>
                </div>
            )}

            {selectedAuditRecordId && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="surface-card w-full max-w-lg border border-slate-800 shadow-2xl p-6 flex flex-col max-h-[80vh]">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                                <HistoryIcon className="w-5 h-5 text-brand-500" /> Audit Correction Ledger
                            </h3>
                            <button onClick={() => setSelectedAuditRecordId(null)} className="text-slate-500 hover:text-white"><X className="w-6 h-6" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-4 pr-2 custom-scrollbar">
                            {auditLogs.length === 0 ? (
                                <div className="text-center py-20 text-slate-600 font-black uppercase text-[10px]">No manual adjustments found.</div>
                            ) : (
                                auditLogs.map(log => (
                                    <div key={log.id} className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl relative overflow-hidden">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-[10px] font-black text-brand-400 uppercase tracking-widest">{log.field_name.replace('_', ' ')}</span>
                                            <span className="text-[8px] text-slate-600 font-bold">{new Date(log.created_at).toLocaleString()}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-xs mb-3">
                                            <span className="text-rose-500/50 line-through font-bold">{log.old_value || 'NULL'}</span>
                                            <div className="h-px w-4 bg-slate-800" />
                                            <span className="text-emerald-500 font-black">{log.new_value || 'NULL'}</span>
                                        </div>
                                        <div className="pt-3 border-t border-slate-800/50">
                                            <p className="text-[10px] text-slate-400 font-medium italic underline decoration-slate-800 underline-offset-4 mb-2">"{log.reason}"</p>
                                            <div className="text-[8px] font-black text-slate-600 uppercase">Edited by: {log.editor_email || 'System Admin'}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
            {isVerifyModalOpen && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
                    <div className="surface-card w-full max-w-md border border-slate-800 shadow-2xl p-8 space-y-8 animate-in zoom-in-95 duration-200">
                        <div className="text-center space-y-3">
                            <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20 mx-auto mb-6">
                                <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                            </div>
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Final Verification</h3>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest leading-relaxed">
                                You are about to save and verify attendance for <span className="text-white">{selectedDate}</span>.
                                Please re-select the operational date to confirm.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block ml-1">Confirm Operational Date</label>
                                <input
                                    type="date"
                                    value={confirmDate}
                                    onChange={e => setConfirmDate(e.target.value)}
                                    className={`w-full bg-slate-900 border ${confirmDate && confirmDate !== selectedDate ? 'border-rose-500' : 'border-slate-800'} rounded-xl p-4 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-brand-500 transition-all`}
                                />
                                {confirmDate && confirmDate !== selectedDate && (
                                    <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest mt-2 animate-in fade-in slide-in-from-top-1 ml-1">
                                        Date mismatch! Please select {selectedDate}
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 pt-4">
                            <button
                                onClick={() => handleSave(true)}
                                disabled={confirmDate !== selectedDate || isSaving}
                                className="w-full btn-primary !py-4 shadow-xl shadow-brand-500/20 disabled:opacity-30 flex items-center justify-center gap-3"
                            >
                                {isSaving ? <div className="spinner !w-4 !h-4" /> : <><Save className="w-4 h-4" /> Save & Verify Day</>}
                            </button>
                            <button
                                onClick={() => setIsVerifyModalOpen(false)}
                                className="w-full py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white transition-all"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}




        </div>
    );
}

import { useState, useEffect } from 'react';
import {
    ShieldAlert, Check, X,
    AlertCircle, Info, Save, Clock, Search
} from 'lucide-react';
import { StaffMaster, ShiftGroup, AttendanceIncidentType } from '../../types/accounting';
import {
    createDelayIncidentRPC, fetchStaffMasters, fetchShiftGroups
} from '../../lib/supabase';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    currentDate: string;
}

export default function DelayIncidentModal({ isOpen, onClose, onSuccess, currentDate }: Props) {
    const [staff, setStaff] = useState<StaffMaster[]>([]);
    const [shiftGroups, setShiftGroups] = useState<ShiftGroup[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const [incidentData, setIncidentData] = useState({
        reason: '',
        responsible_staff_ids: [] as string[],
        excuse_minutes: 30,
        p_start_time: '09:00',
        p_end_time: '09:30',
        incident_type: 'LATE' as AttendanceIncidentType,
        shift_group_id: null as string | null
    });

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    async function loadData() {
        try {
            const [staffData, groupsData] = await Promise.all([
                fetchStaffMasters(),
                fetchShiftGroups()
            ]);
            setStaff(staffData.filter((s: StaffMaster) => s.is_active));
            setShiftGroups(groupsData);
        } catch (error) {
            console.error('Error loading modal data:', error);
        }
    }

    async function handleSubmit() {
        if (!incidentData.reason) {
            alert('Please provide a reason.');
            return;
        }

        try {
            setIsSaving(true);
            
            await createDelayIncidentRPC({
                p_incident_date: currentDate,
                p_reason: incidentData.reason,
                p_responsible_staff_ids: incidentData.responsible_staff_ids,
                p_excuse_minutes: incidentData.excuse_minutes,
                p_shift_group_id: incidentData.shift_group_id,
                p_start_time: incidentData.p_start_time,
                p_end_time: incidentData.p_end_time
            });

            onSuccess();
            onClose();
        } catch (error: any) {
            console.error('Error creating incident:', error);
            alert(`Failed to create incident: ${error.message || 'Unknown error'}`);
        } finally {
            setIsSaving(false);
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="surface-card w-full max-w-2xl border border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
                <div className="px-8 py-6 border-b border-slate-800 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-display font-black text-white uppercase tracking-widest flex items-center gap-3">
                            <ShieldAlert className="w-6 h-6 text-rose-500" />
                            Report Delay Incident
                        </h2>
                        <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mt-1">
                            Penalty Reallocation for {new Date(currentDate).toLocaleDateString()}
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-500 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Warning Box */}
                    <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex gap-4">
                        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        <div>
                            <div className="text-[11px] font-black text-rose-500 uppercase tracking-widest mb-1">Strict Penalty Policy</div>
                            <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                                Excused late minutes for affected staff will be automatically calculated and deducted as a monetary penalty from the responsible staff's salary.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Reason & Time */}
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Incident Reason</label>
                                <textarea
                                    value={incidentData.reason}
                                    onChange={e => setIncidentData({ ...incidentData, reason: e.target.value })}
                                    className="input-base w-full h-32 resize-none !text-[13px] !font-medium"
                                    placeholder="e.g. Security arrived late at 9:25 AM, opening the branch gate late."
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Excuse Up To (Mins)</label>
                                <div className="flex items-center gap-4">
                                    <input
                                        type="range"
                                        min="5"
                                        max="120"
                                        step="5"
                                        value={incidentData.excuse_minutes}
                                        onChange={e => setIncidentData({ ...incidentData, excuse_minutes: parseInt(e.target.value) })}
                                        className="flex-1 accent-brand-500"
                                    />
                                    <span className="w-16 text-center py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-black text-white">
                                        {incidentData.excuse_minutes}m
                                    </span>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl space-y-4">
                                <div className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-brand-500" /> Auto-Scope Affected Staff
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-black text-slate-500 uppercase">From</label>
                                        <input
                                            type="time"
                                            value={incidentData.p_start_time}
                                            onChange={e => setIncidentData({ ...incidentData, p_start_time: e.target.value })}
                                            className="input-base w-full !py-1 text-xs appearance-none"
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[9px] font-black text-slate-500 uppercase">To</label>
                                        <input
                                            type="time"
                                            value={incidentData.p_end_time}
                                            onChange={e => setIncidentData({ ...incidentData, p_end_time: e.target.value })}
                                            className="input-base w-full !py-1 text-xs appearance-none"
                                        />
                                    </div>
                                </div>
                                <p className="text-[8px] text-slate-500 font-bold uppercase italic">
                                    * Staff punching in between these times will be automatically included.
                                </p>
                            </div>
                        </div>

                        {/* Responsible Staff Selection */}
                        <div className="space-y-4">
                            <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Responsible Staff</label>
                            <div className="surface-card bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden h-64 flex flex-col">
                                <div className="p-3 border-b border-slate-800 bg-slate-900/80 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                                    <input
                                        type="text"
                                        placeholder="Search staff..."
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        className="w-full bg-transparent border-none text-[11px] font-bold text-white placeholder:text-slate-600 focus:ring-0 pl-9 py-2"
                                    />
                                </div>
                                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                                    {staff.filter(s => s.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || s.staff_code.toLowerCase().includes(searchQuery.toLowerCase())).map((s: StaffMaster) => (
                                        <button
                                            key={s.id}
                                            onClick={() => {
                                                const current = incidentData.responsible_staff_ids || [];
                                                if (current.includes(s.id)) {
                                                    setIncidentData({ ...incidentData, responsible_staff_ids: current.filter((id: string) => id !== s.id) });
                                                } else {
                                                    setIncidentData({ ...incidentData, responsible_staff_ids: [...current, s.id] });
                                                }
                                            }}
                                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-all ${incidentData.responsible_staff_ids?.includes(s.id) ? 'bg-brand-500/10 border border-brand-500/20' : 'hover:bg-white/[0.02] border border-transparent'}`}
                                        >
                                            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-black text-slate-400 border border-slate-700">
                                                {s.full_name?.charAt(0) || '?'}
                                            </div>
                                            <div className="text-left">
                                                <div className={`text-[11px] font-bold ${incidentData.responsible_staff_ids?.includes(s.id) ? 'text-brand-400' : 'text-slate-300'}`}>{s.full_name}</div>
                                                <div className="text-[9px] text-slate-600 font-black uppercase tracking-widest">{s.staff_code}</div>
                                            </div>
                                            {incidentData.responsible_staff_ids?.includes(s.id) && (
                                                <Check className="w-4 h-4 ml-auto text-brand-500" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 bg-slate-900/50 border border-slate-800 rounded-2xl flex items-center gap-4">
                        <Info className="w-5 h-5 text-brand-500 shrink-0" />
                        <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                            This incident will apply to the **{incidentData.shift_group_id ? shiftGroups.find((g: ShiftGroup) => g.id === incidentData.shift_group_id)?.name : 'All Shifts'}** for this branch. Staff who punched in late within the excuse window will have their penalties transferred.
                        </p>
                    </div>
                </div>

                <div className="px-8 py-6 bg-slate-900/50 border-t border-slate-800 flex items-center justify-end gap-3">
                    <button onClick={onClose} className="btn-secondary">
                        Discard
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSaving || !incidentData.reason || (!incidentData.responsible_staff_ids?.length && !incidentData.p_start_time)}
                        className="btn-primary"
                    >
                        {isSaving ? <div className="spinner !w-4 !h-4 !border-2" /> : <Save className="w-4 h-4" />}
                        Submit & Reallocate Penalty
                    </button>
                </div>
            </div>
        </div>
    );
}

import React, { useState, useEffect } from 'react';
import {
    Users, UserPlus, Shield,
    Search, ShieldCheck,
    Building2, Wifi, WifiOff, Loader2, Lock, X,
    FileText, Calendar, Info
} from 'lucide-react';
import {
    fetchStaffMasters, fetchRoles,
    upsertStaffMaster, fetchUserOrgAccess, upsertUserOrgAccess, revokeUserOrgAccess,
    provisionStaffAccount, fetchLatestExitCase, disconnectStaffAccount,
    fetchShiftGroups, fetchDeviceDepartments
} from '../../lib/supabase';
import { supabase } from '../../lib/supabase';
import { StaffMaster, Role, UserOrgAccess, ExitCase, ShiftGroup, DeviceDepartment } from '../../types/accounting';
import Modal from '../ui/Modal';

const StaffManagement: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'staff' | 'roles' | 'history'>('staff');
    const [staff, setStaff] = useState<StaffMaster[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [shiftGroups, setShiftGroups] = useState<ShiftGroup[]>([]);
    const [departments, setDepartments] = useState<DeviceDepartment[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Modals
    const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
    const [staffModalTab, setStaffModalTab] = useState<'IDENTITY' | 'EMPLOYMENT' | 'COMPLIANCE' | 'ACCOUNT' | 'RELIEVEMENT'>('IDENTITY');
    const [isRoleAssignmentModalOpen, setIsRoleAssignmentModalOpen] = useState(false);
    const [editingStaff, setEditingStaff] = useState<StaffMaster | null>(null);
    const [selectedRoleForAssignment, setSelectedRoleForAssignment] = useState<Role | null>(null);
    const [linkedUserId, setLinkedUserId] = useState<string | null>(null);
    const [loadingAccess, setLoadingAccess] = useState(false);
    const [latestExitCase, setLatestExitCase] = useState<ExitCase | null>(null);
    const [loadingExitCase, setLoadingExitCase] = useState(false);
    const [userOrgAccess, setUserOrgAccess] = useState<UserOrgAccess[]>([]);
    const [userProfiles, setUserProfiles] = useState<{ id: string, staff_id: string | null }[]>([]);

    // Assign Role Form State
    const [assigningRole, setAssigningRole] = useState(false);
    const [newRoleScope, setNewRoleScope] = useState<'GLOBAL'>('GLOBAL');

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        if (editingStaff) {
            const profile = userProfiles.find(p => p.staff_id === editingStaff.id);
            setLinkedUserId(profile ? profile.id : null);
        } else {
            setLinkedUserId(null);
        }
    }, [editingStaff, userProfiles]);

    useEffect(() => {
        const fetchDetails = async () => {
            if (editingStaff) {
                // Fetch linked user ID
                const { data: profile } = await supabase
                    .from('user_profiles')
                    .select('id')
                    .eq('staff_id', editingStaff.id)
                    .maybeSingle();
                setLinkedUserId(profile?.id || null);

                // Fetch exit details if relieved
                if (editingStaff.is_active === false) {
                    setLoadingExitCase(true);
                    try {
                        const exitData = await fetchLatestExitCase(editingStaff.id);
                        setLatestExitCase(exitData);
                    } catch (err) {
                        console.error('Error fetching exit details:', err);
                    } finally {
                        setLoadingExitCase(false);
                    }
                } else {
                    setLatestExitCase(null);
                }
            } else {
                setLinkedUserId(null);
                setLatestExitCase(null);
            }
        };

        if (isStaffModalOpen) {
            fetchDetails();
        }
    }, [editingStaff, isStaffModalOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [staffData, rolesData, accessData, groupsData, deptsData] = await Promise.all([
                fetchStaffMasters(),
                fetchRoles(),
                fetchUserOrgAccess(),
                fetchShiftGroups(),
                fetchDeviceDepartments()
            ]);

            // Fetch user profiles to map staff to users
            const { data: profiles } = await supabase
                .from('user_profiles')
                .select('id, staff_id');

            setStaff(staffData);
            setRoles(rolesData);
            setUserOrgAccess(accessData);
            setShiftGroups(groupsData);
            setDepartments(deptsData);
            setUserProfiles(profiles || []);
        } catch (error) {
            console.error('Error loading staff data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSaveStaff = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        // Manual Validation for required fields across tabs
        const full_name = (formData.get('full_name') as string)?.trim();
        const primary_mobile = (formData.get('primary_mobile') as string)?.trim();
        const department_id = (formData.get('department_id') as string)?.trim();
        const departmentName = departments.find(d => d.id === department_id)?.name || '';

        if (!full_name) {
            setStaffModalTab('IDENTITY');
            setTimeout(() => {
                const el = document.getElementsByName('full_name')[0];
                el?.focus();
                alert('Full Name is required protocol.');
            }, 100);
            return;
        }

        if (!primary_mobile) {
            setStaffModalTab('IDENTITY');
            setTimeout(() => {
                const el = document.getElementsByName('primary_mobile')[0];
                el?.focus();
                alert('Primary Mobile is required for communication protocol.');
            }, 100);
            return;
        }

        if (!department_id) {
            setStaffModalTab('EMPLOYMENT');
            setTimeout(() => {
                const el = document.getElementsByName('department_id')[0];
                el?.focus();
                alert('Department selection is required for organizational mapping.');
            }, 100);
            return;
        }

        const email = (formData.get('email') as string)?.trim() || null;

        // Client-side pre-save validation for duplicate email
        if (email) {
            const isDuplicate = staff.some(s =>
                s.email?.toLowerCase() === email.toLowerCase() &&
                s.id !== editingStaff?.id
            );
            if (isDuplicate) {
                setStaffModalTab('IDENTITY');
                setTimeout(() => {
                    const el = document.getElementsByName('email')[0];
                    el?.focus();
                    alert(`The email "${email}" is already assigned to another staff member. Please use a unique email protocol.`);
                }, 100);
                return;
            }
        }

        const staffData: Partial<StaffMaster> = {
            id: editingStaff?.id,
            staff_code: editingStaff?.staff_code || `EMP-${Math.floor(100000 + Math.random() * 900000)}`,

            // Identity Tab
            full_name: full_name || editingStaff?.full_name || '',
            gender: (formData.get('gender') as any) || editingStaff?.gender || null,
            dob: (formData.get('dob') as string) || editingStaff?.dob || null,
            blood_group: (formData.get('blood_group') as string) || editingStaff?.blood_group || null,
            marital_status: (formData.get('marital_status') as any) || editingStaff?.marital_status || null,
            primary_mobile: primary_mobile || editingStaff?.primary_mobile || '',
            secondary_mobile: (formData.get('secondary_mobile') as string) || editingStaff?.secondary_mobile || null,
            email: email,
            permanent_address: (formData.get('permanent_address') as string) || editingStaff?.permanent_address || null,
            current_address: (formData.get('current_address') as string) || editingStaff?.current_address || null,

            // Employment Tab
            department: departmentName || editingStaff?.department || '',
            department_id: department_id || editingStaff?.department_id || null,
            shift_group_id: (formData.get('shift_group_id') as string) || editingStaff?.shift_group_id || null,
            basic_pay: formData.get('basic_pay') ? Number(formData.get('basic_pay')) : (editingStaff?.basic_pay || null),
            doj: (formData.get('doj') as string) || editingStaff?.doj || null,
            employment_type: (formData.get('employment_type') as any) || editingStaff?.employment_type || null,

            // Compliance Tab
            offer_letter_collected: formData.has('offer_letter_collected') ? formData.get('offer_letter_collected') === 'on' : (editingStaff?.offer_letter_collected || false),
            id_proof_collected: formData.has('id_proof_collected') ? formData.get('id_proof_collected') === 'on' : (editingStaff?.id_proof_collected || false),
            address_proof_collected: formData.has('address_proof_collected') ? formData.get('address_proof_collected') === 'on' : (editingStaff?.address_proof_collected || false),
            agreement_signed: formData.has('agreement_signed') ? formData.get('agreement_signed') === 'on' : (editingStaff?.agreement_signed || false),
            allow_session_posting_override: formData.has('allow_session_posting_override') ? formData.get('allow_session_posting_override') === 'on' : (editingStaff?.allow_session_posting_override || false),
            bg_check_completed: formData.has('bg_check_completed') ? formData.get('bg_check_completed') === 'on' : (editingStaff?.bg_check_completed || false),

            status: editingStaff?.status || 'ACTIVE'
        };

        try {
            await upsertStaffMaster(staffData);
            setIsStaffModalOpen(false);
            setEditingStaff(null);
            setStaffModalTab('IDENTITY');
            loadData();
        } catch (error: any) {
            console.error('Staff save error:', error);
            if (error.code === '23505') {
                alert('Conflict detected: A staff member with this identity (Email or Staff Code) already exists in the registry.');
            } else {
                alert('Error saving staff profile: ' + (error.message || 'Unknown protocol failure.'));
            }
        }
    };

    const handleAssignRole = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!linkedUserId) return alert("Must link a User Account first.");

        const formData = new FormData(e.currentTarget);
        const role_id = formData.get('role_id') as string;
        const isJobRole = roles.some(r => r.id === role_id && r.category === 'JOB');
        if (!isJobRole) return alert('Only operational job roles can be assigned to staff identifiers.');
        const scope_type = newRoleScope;
        const scope_id = formData.get('scope_id') as string || null;

        try {
            await upsertUserOrgAccess({
                user_id: linkedUserId,
                role_id,
                scope_type,
                scope_id,
                is_active: true
            });
            // Refresh
            setAssigningRole(false);
            loadData();
        } catch (error: any) {
            alert(error.message || 'Error assigning role');
        }
    };

    const handleRevokeRole = async (accessId: string) => {
        if (!confirm('Are you sure you want to revoke this access?')) return;
        try {
            await revokeUserOrgAccess(accessId);
            loadData();
        } catch (error) {
            alert('Error revoking access');
        }
    };

    const handleToggleStaffAssignment = async (staffId: string, roleId: string, assigned: boolean) => {
        try {
            const profile = userProfiles.find(p => p.staff_id === staffId);
            if (!profile) {
                alert("This staff member does not have a linked User Account.");
                return;
            }

            if (assigned) {
                const mapping = userOrgAccess.find(a => a.user_id === profile.id && a.role_id === roleId);
                if (mapping) {
                    await revokeUserOrgAccess(mapping.id);
                }
            } else {
                // Check if role is already occupied
                const existingAssignment = userOrgAccess.find(a => a.role_id === roleId);
                if (existingAssignment) {
                    const assignedProfile = userProfiles.find(p => p.id === existingAssignment.user_id);
                    const assignedStaff = staff.find(s => s.id === assignedProfile?.staff_id);
                    alert(`This role is already assigned to ${assignedStaff?.full_name || 'another staff member'}. Please revoke their access first.`);
                    return;
                }

                await upsertUserOrgAccess({
                    user_id: profile.id,
                    role_id: roleId,
                    scope_type: 'GLOBAL',
                    is_active: true
                });
            }
            await loadData();
        } catch (error: any) {
            alert('Error updating assignment: ' + error.message);
        }
    };

    const handleProvisionAccount = async () => {
        if (!editingStaff || !editingStaff.email) return;
        setLoadingAccess(true);
        try {
            await provisionStaffAccount(editingStaff.id, editingStaff.email);
            // Refresh both local state and modal view
            await loadData();
            // The useEffect will handle the setLinkedUserId sync
        } catch (error: any) {
            alert(error.message || 'Error connecting account');
        } finally {
            setLoadingAccess(false);
        }
    };

    const filteredStaff = staff.filter(s => {
        const matchesSearch = s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.department?.toLowerCase().includes(searchTerm.toLowerCase());

        if (activeTab === 'history') return matchesSearch && s.is_active === false;
        if (activeTab === 'staff') return matchesSearch && s.is_active !== false;
        return matchesSearch;
    });
    const jobRoles = roles.filter(role => role.category === 'JOB');

    return (
        <div className="space-y-12 pb-10">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 px-1">
                <div className="space-y-2">
                    <h1 className="text-4xl font-display font-black text-white uppercase tracking-tight leading-none flex items-center gap-4">
                        <Users className="w-10 h-10 text-brand-500" />
                        Human Resources
                    </h1>
                    <p className="text-slate-500 font-medium text-sm max-w-xl">
                        Manage personnel, regional assignments, and granular access control across the enterprise network.
                    </p>
                </div>

                <div className="flex items-center gap-3">
                    <div className="relative group">
                        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-brand-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search identities..."
                            className="pl-11 pr-6 py-3 bg-slate-900/50 border border-slate-800 rounded-2xl text-[13px] font-medium text-white focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500/50 outline-none w-64 transition-all"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {activeTab === 'staff' && (
                        <button
                            onClick={() => setIsStaffModalOpen(true)}
                            className="btn-primary"
                        >
                            <UserPlus className="w-4 h-4" />
                            Enroll Staff
                        </button>
                    )}
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 p-1.5 bg-[#0f172a] border border-slate-800 rounded-2xl w-fit">
                <button
                    onClick={() => setActiveTab('staff')}
                    className={`px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-xl ${activeTab === 'staff' ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Staff Directory
                </button>
                <button
                    onClick={() => setActiveTab('history')}
                    className={`px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-xl ${activeTab === 'history' ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Staff History
                </button>
                <button
                    onClick={() => setActiveTab('roles')}
                    className={`px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] transition-all rounded-xl ${activeTab === 'roles' ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'text-slate-500 hover:text-slate-300'}`}
                >
                    Assign Roles
                </button>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-24 gap-4">
                    <div className="spinner !w-8 !h-8 border-brand-500"></div>
                </div>
            ) : (activeTab === 'staff' || activeTab === 'history') ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredStaff.map(s => {
                        const linkedProfile = userProfiles.find(p => p.staff_id === s.id);
                        const assignedRoleMapping = linkedProfile ? userOrgAccess.find(a => a.user_id === linkedProfile.id && roles.find(r => r.id === a.role_id)?.category === 'JOB') : null;
                        const assignedRole = assignedRoleMapping ? roles.find(r => r.id === assignedRoleMapping.role_id) : null;

                        return (
                            <div key={s.id} className={`surface-card p-6 border border-slate-800/10 hover:shadow-glow shadow-brand-500/5 transition-all group flex flex-col justify-between ${s.is_active === false ? 'grayscale-[0.5] opacity-80' : ''}`}>
                                <div>
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg border shadow-lg group-hover:scale-110 transition-transform ${s.is_active === false ? 'bg-slate-800 text-slate-500 border-slate-700' : 'bg-brand-500/10 text-brand-500 border-brand-500/20 shadow-brand-500/5'}`}>
                                                {s.full_name.charAt(0)}
                                            </div>
                                            <div className="space-y-0.5">
                                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{s.staff_code}</div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="text-lg font-display font-black text-white uppercase tracking-tight">{s.full_name}</h3>
                                                    {s.is_active === false && (
                                                        <span className="px-1.5 py-0.5 bg-rose-500/10 text-rose-500 text-[8px] font-black uppercase tracking-widest border border-rose-500/20 rounded-md">Relieved</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3 mb-8">
                                        {assignedRole && (
                                            <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-xl border border-slate-800/50">
                                                <div className="flex items-center gap-3">
                                                    <ShieldCheck className="w-4 h-4 text-slate-600" />
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Job Role</span>
                                                </div>
                                                <span className="text-[10px] font-black text-brand-400 uppercase tracking-widest">
                                                    {assignedRole.role_name}
                                                </span>
                                            </div>
                                        )}

                                        {s.is_active === false && (
                                            <div className="flex items-center justify-between p-3 bg-rose-500/5 rounded-xl border border-rose-500/10">
                                                <div className="flex items-center gap-3">
                                                    <Calendar className="w-4 h-4 text-rose-500/60" />
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Relieved Date</span>
                                                </div>
                                                <span className="text-[10px] font-black text-rose-500 uppercase tracking-widest">
                                                    {s.exit_cases?.find(ec => ec.status === 'CLOSED')?.final_lwd || 'Archived'}
                                                </span>
                                            </div>
                                        )}

                                        <div className="flex items-center justify-between p-3 bg-slate-950/40 rounded-xl border border-slate-800/50">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-1.5 h-1.5 rounded-full ${s.is_active !== false && linkedProfile ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]'}`} />
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</span>
                                            </div>
                                            {s.is_active !== false && linkedProfile ? (
                                                <span className="text-[9px] font-black text-emerald-500 uppercase tracking-[0.2em]">Connected</span>
                                            ) : (
                                                <span className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em]">Disconnected</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <button
                                    onClick={() => { setEditingStaff(s); setIsStaffModalOpen(true); }}
                                    className="w-full p-3 bg-slate-900 border border-slate-800 rounded-xl text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-white hover:border-slate-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                                >
                                    <Building2 className="w-3.5 h-3.5" />
                                    Modify Protocol
                                </button>
                            </div>
                        )
                    })}
                    {filteredStaff.length === 0 && (
                        <div className="col-span-full py-24 text-center surface-card border-dashed border-slate-800/50">
                            <p className="text-[11px] font-black text-slate-700 uppercase tracking-[0.3em]">No personnel records matched.</p>
                        </div>
                    )}
                </div>
            ) : (
                /* Roles List */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {jobRoles.map(role => {
                        const assignedCount = userOrgAccess.filter(a => a.role_id === role.id).length;
                        return (
                            <div key={role.id} className={`surface-card flex flex-col border hover:shadow-glow shadow-brand-500/5 transition-all group ${assignedCount === 0 ? 'border-rose-500/30' : 'border-slate-800/10'}`}>
                                <div className="p-8 border-b border-white/5 flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${assignedCount === 0 ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'}`}>
                                            <ShieldCheck className="w-6 h-6" />
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <h3 className="text-xl font-display font-black text-white uppercase tracking-tight">{role.role_name}</h3>
                                            {assignedCount === 0 && (
                                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)] animate-pulse" />
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="p-8 flex-1 flex flex-col">
                                    <p className="text-[13px] font-medium text-slate-400 leading-relaxed mb-8 flex-1">{role.description || 'No descriptive protocol provided for this classification.'}</p>

                                    <div className="space-y-6">
                                        <div className="space-y-4">
                                            <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Authorized Modules</h4>
                                            <div className="flex flex-wrap gap-2">
                                                {Object.entries(role.permissions).slice(0, 6).map(([mod]) => (
                                                    <span key={mod} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">
                                                        {mod}
                                                    </span>
                                                ))}
                                                {Object.keys(role.permissions).length > 6 && (
                                                    <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest ml-1">+{Object.keys(role.permissions).length - 6} more</span>
                                                )}
                                            </div>
                                        </div>

                                        {assignedCount > 0 && (
                                            <div className="space-y-4">
                                                <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Assigned Personnel</h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {userOrgAccess
                                                        .filter(a => a.role_id === role.id)
                                                        .map(access => {
                                                            const profile = userProfiles.find(p => p.id === access.user_id);
                                                            const s = staff.find(st => st.id === profile?.staff_id);
                                                            if (!s) return null;
                                                            return (
                                                                <div key={access.id} className="w-full flex items-center gap-3 p-3 bg-brand-500/5 border border-brand-500/10 rounded-2xl group/staff">
                                                                    <div className="w-8 h-8 rounded-lg bg-brand-500/10 flex items-center justify-center text-brand-500 font-black text-xs border border-brand-500/20">
                                                                        {s.full_name.charAt(0)}
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="text-[11px] font-bold text-white truncate uppercase tracking-tight">{s.full_name}</div>
                                                                        <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{s.staff_code}</div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => { setSelectedRoleForAssignment(role); setIsRoleAssignmentModalOpen(true); }}
                                            className="w-full py-3 bg-brand-600/10 border border-brand-600/20 rounded-xl text-[10px] font-black text-brand-400 uppercase tracking-widest hover:bg-brand-600 hover:text-white transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            <Users className="w-3.5 h-3.5" />
                                            Manage Assignments
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Staff Modal */}
            <Modal
                isOpen={isStaffModalOpen}
                onClose={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffModalTab('IDENTITY'); }}
            >
                <div
                    className="relative w-full max-w-3xl bg-slate-950 border border-slate-800 flex flex-col shadow-2xl overflow-hidden rounded-[2.5rem] animate-slide-down mx-auto mt-[10vh]"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="p-8 border-b border-white/5 flex items-start justify-between gap-4 shrink-0 bg-white/[0.01]">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 bg-brand-500/10 rounded-xl flex items-center justify-center border border-brand-500/20">
                                    <UserPlus className="w-4.5 h-4.5 text-brand-500" />
                                </div>
                                <h2 className="text-2xl font-display font-black text-white uppercase tracking-tight">
                                    {editingStaff ? 'Modify Protocol' : 'Enroll Personnel'}
                                </h2>
                            </div>
                            <p className="text-[12px] text-slate-500 font-medium uppercase tracking-widest px-1">Identity & Employment Registration</p>
                        </div>
                        <div className="flex flex-col items-end gap-3">
                            <button
                                onClick={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffModalTab('IDENTITY'); }}
                                className="p-2 rounded-xl text-slate-500 hover:text-white hover:bg-slate-800 transition-all shrink-0"
                            >
                                <X className="w-5 h-5" />
                            </button>
                            <div className="flex bg-slate-900/60 rounded-xl p-1 border border-slate-800/60 overflow-x-auto scrollbar-hidden max-w-[50vw]">
                                {(() => {
                                    const tabs = ['IDENTITY', 'EMPLOYMENT', 'COMPLIANCE'];
                                    if (editingStaff) {
                                        if (editingStaff.is_active !== false) {
                                            tabs.push('ACCOUNT');
                                        } else {
                                            tabs.push('RELIEVEMENT');
                                        }
                                    }
                                    return tabs.map(tab => (
                                        <button
                                            key={tab}
                                            type="button"
                                            onClick={() => setStaffModalTab(tab as any)}
                                            className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${staffModalTab === tab ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/20' : 'text-slate-500 hover:text-slate-300'}`}
                                        >
                                            {tab}
                                        </button>
                                    ));
                                })()}
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto scrollbar-hidden p-8 max-h-[70vh]">
                        <form onSubmit={handleSaveStaff} className={(staffModalTab === 'ACCOUNT' || staffModalTab === 'RELIEVEMENT') ? 'hidden' : 'space-y-8'}>
                            <div className={staffModalTab !== 'IDENTITY' ? 'hidden' : 'space-y-4 animate-fade-in'}>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Full Name *</label>
                                    <input name="full_name" defaultValue={editingStaff?.full_name} className="input-field" placeholder="e.g. John Doe" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Gender</label>
                                        <select name="gender" defaultValue={editingStaff?.gender || ''} className="select-field">
                                            <option value="">Select</option>
                                            <option value="MALE">Male</option>
                                            <option value="FEMALE">Female</option>
                                            <option value="OTHER">Other</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Date of Birth</label>
                                        <input type="date" name="dob" defaultValue={editingStaff?.dob || ''} className="input-field" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Primary Mobile *</label>
                                        <input name="primary_mobile" defaultValue={editingStaff?.primary_mobile} className="input-field" placeholder="10-digit number" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Email</label>
                                        <input type="email" name="email" defaultValue={editingStaff?.email || ''} className="input-field" placeholder="name@company.com" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Current Address</label>
                                    <textarea name="current_address" defaultValue={editingStaff?.current_address || ''} className="input-field min-h-[80px]" placeholder="Residential address..." />
                                </div>
                            </div>

                            <div className={staffModalTab !== 'EMPLOYMENT' ? 'hidden' : 'space-y-4 animate-fade-in'}>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Department *</label>
                                    <select name="department_id" defaultValue={editingStaff?.department_id || ''} className="select-field">
                                        <option value="">None / Unassigned</option>
                                        {departments.length === 0 && <option disabled value="">No departments found. Create them in Device Settings.</option>}
                                        {departments.map(dept => (
                                            <option key={dept.id} value={dept.id}>{dept.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Employment Type</label>
                                        <select name="employment_type" defaultValue={editingStaff?.employment_type || ''} className="select-field">
                                            <option value="">Select</option>
                                            <option value="PERMANENT">Permanent</option>
                                            <option value="CONTRACT">Contract</option>
                                            <option value="INTERN">Intern</option>
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Date of Joining</label>
                                        <input type="date" name="doj" defaultValue={editingStaff?.doj || ''} className="input-field" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Basic Pay</label>
                                        <input type="number" step="0.01" name="basic_pay" defaultValue={editingStaff?.basic_pay || ''} className="input-field" placeholder="0.00" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Assigned Shift Group</label>
                                        <select name="shift_group_id" defaultValue={editingStaff?.shift_group_id || ''} className="select-field">
                                            <option value="">No Shift Assigned</option>
                                            {shiftGroups.map(g => (
                                                <option key={g.id} value={g.id}>{g.name} ({g.start_time} - {g.end_time})</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="p-5 bg-brand-500/5 border border-brand-500/10 rounded-2xl space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-0.5">
                                            <div className="text-[10px] font-black text-brand-500 uppercase tracking-widest leading-none">Posting Governance</div>
                                            <div className="text-[11px] font-bold text-slate-300">Allow Session Posting Audit</div>
                                        </div>
                                        <input
                                            type="checkbox"
                                            name="allow_session_posting_override"
                                            defaultChecked={editingStaff?.allow_session_posting_override}
                                            className="w-5 h-5 rounded border border-slate-700 bg-slate-900 checked:bg-brand-500 checked:border-brand-500 transition-all appearance-none flex items-center justify-center before:content-[''] before:w-2.5 before:h-2.5 before:bg-white before:rounded-sm before:opacity-0 checked:before:opacity-100"
                                        />
                                    </div>
                                    <p className="text-[9px] text-slate-500 italic leading-snug">
                                        Enable this to allow this staff member to be selected as "Personnel on Duty" during transaction finalization, bypassing department-level restrictions.
                                    </p>
                                </div>
                                <p className="text-[9px] text-slate-500 mt-1 ml-1 italic">Determines attendance rules, grace periods, and half-day thresholds.</p>
                            </div>


                            <div className={staffModalTab !== 'COMPLIANCE' ? 'hidden' : 'space-y-3 animate-fade-in bg-slate-900/40 p-5 rounded-3xl border border-slate-800'}>
                                {[
                                    { id: 'offer_letter_collected', label: 'Offer Letter Signed & Collected' },
                                    { id: 'id_proof_collected', label: 'Government ID Proof Verified' },
                                    { id: 'address_proof_collected', label: 'Address Proof Collected' },
                                    { id: 'bg_check_completed', label: 'Background Check Completed' },
                                    { id: 'agreement_signed', label: 'NDA / Employment Agreement Signed' }
                                ].map(doc => (
                                    <label key={doc.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-800 cursor-pointer transition-colors">
                                        <span className="text-[11px] font-bold text-slate-300 tracking-tight">{doc.label}</span>
                                        <input type="checkbox" name={doc.id} defaultChecked={editingStaff?.[doc.id as keyof StaffMaster] as boolean} className="w-5 h-5 rounded border border-slate-700 bg-slate-900 checked:bg-brand-500 checked:border-brand-500 transition-all appearance-none flex items-center justify-center before:content-[''] before:w-2.5 before:h-2.5 before:bg-white before:rounded-sm before:opacity-0 checked:before:opacity-100" />
                                    </label>
                                ))}
                            </div>

                            <div className="flex justify-end gap-3 pt-6 border-t border-white/5 mt-8">
                                <button
                                    type="button"
                                    onClick={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffModalTab('IDENTITY'); }}
                                    className="btn-ghost"
                                >
                                    Cancel
                                </button>
                                <button type="submit" className="btn-primary">
                                    {editingStaff ? 'Update Protocol' : 'Finalize Enrollment'}
                                </button>
                            </div>
                        </form>

                        {staffModalTab === 'ACCOUNT' && (
                            <div className="space-y-8 animate-fade-in">
                                <div className="p-6 bg-slate-950/40 rounded-[2rem] border border-slate-800/50 flex flex-col gap-1">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest leading-none mb-2">Network Credentials</h4>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-slate-950/60 rounded-2xl border border-slate-800/50">
                                        <div className="flex items-center gap-3">
                                            {linkedUserId ? <Wifi className="w-4 h-4 text-brand-500" /> : <WifiOff className="w-4 h-4 text-slate-600" />}
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Network Status</span>
                                        </div>
                                        {loadingAccess ? (
                                            <div className="flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
                                                <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Checking...</span>
                                            </div>
                                        ) : linkedUserId ? (
                                            <span className="text-[9px] font-black text-brand-500 uppercase tracking-[0.2em] px-2">Connected</span>
                                        ) : (
                                            <div className="flex items-center gap-3">
                                                <span className="text-[9px] font-black text-rose-500 uppercase tracking-[0.2em]">Offline</span>
                                                <button
                                                    onClick={handleProvisionAccount}
                                                    className="px-4 py-2 bg-brand-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-brand-500/20 hover:scale-105 active:scale-95 transition-all"
                                                >
                                                    Provision Account
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] font-medium text-slate-500 mt-2 px-1 italic">
                                        Active accounts allow personnel to log in and interact with their assigned modules.
                                    </p>
                                </div>

                                <div className="space-y-5">
                                    <div className="flex justify-between items-center px-1">
                                        <h4 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.3em]">Privilege Stack</h4>
                                        {linkedUserId && !assigningRole && (
                                            <button
                                                type="button"
                                                onClick={() => setAssigningRole(true)}
                                                className="text-[10px] font-black text-brand-500 uppercase tracking-widest hover:text-brand-400"
                                            >
                                                + Assign New Role
                                            </button>
                                        )}
                                    </div>

                                    {loadingAccess ? (
                                        <div className="flex flex-col items-center justify-center py-10 gap-3">
                                            <div className="spinner !w-6 !h-6 border-brand-500"></div>
                                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Retrieving Scopes...</span>
                                        </div>
                                    ) : assigningRole ? (
                                        <form onSubmit={handleAssignRole} className="p-8 bg-slate-900 border border-slate-800 rounded-[2.5rem] space-y-6 animate-slide-down">
                                            <h5 className="text-[11px] font-black text-white uppercase tracking-widest mb-2">New Privilege Mapping</h5>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Classification Role</label>
                                                <select name="role_id" required className="select-field">
                                                    <option value="">Select Job Role...</option>
                                                    {jobRoles
                                                        .filter(r => !userOrgAccess.some(a => a.role_id === r.id))
                                                        .map(r => <option key={r.id} value={r.id} className="bg-slate-900">{r.role_name}</option>)}
                                                </select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Operational Scope</label>
                                                <div className="flex gap-4 p-2 bg-[#020617]/50 border border-slate-800 rounded-2xl">
                                                    {['GLOBAL'].map((scope) => (
                                                        <label key={scope} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl cursor-pointer transition-all hover:bg-slate-800 border border-transparent has-[:checked]:bg-brand-600/10 has-[:checked]:border-brand-600/30">
                                                            <input
                                                                type="radio"
                                                                checked={newRoleScope === scope}
                                                                onChange={() => setNewRoleScope(scope as any)}
                                                                className="hidden"
                                                            />
                                                            <span className={`text-[10px] font-black uppercase tracking-widest ${newRoleScope === scope ? 'text-brand-400' : 'text-slate-600'}`}>
                                                                {scope}
                                                            </span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex justify-end gap-3 pt-4">
                                                <button type="button" onClick={() => setAssigningRole(false)} className="btn-ghost !py-2.5">Abort</button>
                                                <button type="submit" className="btn-primary !py-2.5">Commit Assignment</button>
                                            </div>
                                        </form>
                                    ) : (() => {
                                        const staffAccess = (linkedUserId ? userOrgAccess.filter(a => a.user_id === linkedUserId) : []) as (UserOrgAccess & { role?: Role })[];
                                        return staffAccess.length === 0 ? (
                                            <div className="text-center py-10 bg-slate-950/20 rounded-[2rem] border border-dashed border-slate-800/50">
                                                <p className="text-[11px] font-black text-slate-700 uppercase tracking-[0.2em]">No privileges currently active.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {staffAccess.map(a => (
                                                    <div key={a.id} className="flex items-center justify-between p-5 bg-slate-900 border border-slate-800 rounded-2xl group hover:border-brand-500/30 transition-all">
                                                        <div className="space-y-1">
                                                            <div className="text-[13px] font-bold text-white tracking-tight">{a.role?.role_name}</div>
                                                            <div className="text-[9px] text-slate-500 font-black tracking-[0.2em] flex items-center gap-2 uppercase">
                                                                <Building2 className="w-3 h-3 text-slate-600" />
                                                                SCOPE: {a.scope_type}
                                                            </div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleRevokeRole(a.id)}
                                                            className="px-4 py-2 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[10px] font-black text-rose-500 uppercase tracking-widest hover:bg-rose-500 hover:text-white transition-all active:scale-95"
                                                        >
                                                            Revoke
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>

                                <div className="p-6 bg-brand-500/5 border border-brand-500/10 rounded-[2rem]">
                                    <div className="flex gap-4">
                                        <Shield className="w-5 h-5 text-brand-500 shrink-0" />
                                        <div className="space-y-1">
                                            <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-500">Privilege Protocol</h5>
                                            <p className="text-[11px] text-slate-400 leading-relaxed font-bold">
                                                Changes to classification or operational scope take effect across the enterprise cluster immediately. Scale regional inheritance with caution.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-4">
                                    <button
                                        type="button"
                                        onClick={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffModalTab('IDENTITY'); }}
                                        className="btn-ghost"
                                    >
                                        Close Management
                                    </button>
                                </div>
                            </div>
                        )}

                        {staffModalTab === 'RELIEVEMENT' && (
                            <div className="space-y-8 animate-fade-in">
                                {loadingExitCase ? (
                                    <div className="py-12 flex flex-col items-center justify-center gap-4">
                                        <div className="spinner !w-6 !h-6 border-brand-500"></div>
                                        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Retrieving Exit Protocol...</p>
                                    </div>
                                ) : latestExitCase ? (
                                    <div className="space-y-6">
                                        <div className="p-8 bg-rose-500/5 border border-rose-500/10 rounded-[2.5rem] relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-8 opacity-10">
                                                <UserPlus className="w-24 h-24 -rotate-12" />
                                            </div>
                                            <div className="relative z-10 flex items-center gap-6 mb-8">
                                                <div className="w-16 h-16 bg-rose-500/10 rounded-2xl flex items-center justify-center border border-rose-500/20 shadow-lg shadow-rose-500/10">
                                                    <Calendar className="w-8 h-8 text-rose-500" />
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-black text-rose-500/60 uppercase tracking-[0.3em] mb-1">Final Last Working Day</div>
                                                    <div className="text-3xl font-display font-black text-white tracking-tight">
                                                        {latestExitCase.final_lwd || latestExitCase.initiated_date}
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/5">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Exit Classification</div>
                                                    <div className="text-[11px] font-black text-white uppercase tracking-wider">{latestExitCase.exit_type}</div>
                                                </div>
                                                <div className="p-4 bg-slate-950/60 rounded-2xl border border-white/5">
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Reason Category</div>
                                                    <div className="text-[11px] font-black text-white uppercase tracking-wider">{latestExitCase.reason_category || 'General / Personal'}</div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex items-center gap-2 px-1">
                                                <Info className="w-3.5 h-3.5 text-slate-500" />
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Protocol Remarks</span>
                                            </div>
                                            <div className="p-6 bg-slate-900/40 border border-slate-800/60 rounded-3xl text-[13px] text-slate-400 leading-relaxed italic">
                                                "{latestExitCase.notes || 'No specific remarks were entered for this exit protocol.'}"
                                            </div>
                                        </div>

                                        <div className="p-6 bg-slate-950 border border-slate-800 rounded-[2rem] flex flex-col sm:flex-row items-center justify-between gap-6">
                                            <div className="flex items-center gap-4 text-center sm:text-left">
                                                <div className="w-12 h-12 bg-brand-500/10 rounded-xl flex items-center justify-center border border-brand-500/20">
                                                    <FileText className="w-6 h-6 text-brand-500" />
                                                </div>
                                                <div>
                                                    <div className="text-[11px] font-black text-white uppercase tracking-tight">Experience Certificate</div>
                                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest mt-0.5">Verification & Service Letter</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <span className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[8px] font-black text-slate-500 uppercase tracking-widest">
                                                    ID: CERT-{latestExitCase.id.substring(0, 8).toUpperCase()}
                                                </span>
                                                <button className="px-5 py-2.5 bg-brand-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-brand-500/20 hover:scale-105 active:scale-95 transition-all">
                                                    Download
                                                </button>
                                            </div>
                                        </div>

                                        <div className="p-6 bg-rose-500/5 border border-rose-500/10 rounded-[2rem] flex items-start gap-5">
                                            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center shrink-0 border border-rose-500/20">
                                                <Lock className="w-6 h-6 text-rose-500" />
                                            </div>
                                            <div className="flex-1">
                                                <h5 className="text-[11px] font-black text-white uppercase tracking-tight mb-1">Security Status: {linkedUserId ? 'Connection Active' : 'Access Revoked'}</h5>
                                                <p className="text-[10px] text-slate-400 leading-relaxed italic">
                                                    {linkedUserId
                                                        ? "This historical record is still linked to a software account. You should revoke access to ensure security."
                                                        : "Personnel account has been successfully disconnected and all internal permissions have been cleared."}
                                                </p>
                                                {linkedUserId && (
                                                    <button
                                                        onClick={async () => {
                                                            if (confirm('Are you sure you want to PERMANENTLY revoke this account connection? This will clear all permissions and unlink the user profile.')) {
                                                                try {
                                                                    await disconnectStaffAccount(latestExitCase.staff_id);
                                                                    setLinkedUserId(null);
                                                                    alert('Personnel account successfully disconnected from the software.');
                                                                } catch (e: any) {
                                                                    alert('Failed: ' + e.message);
                                                                }
                                                            }
                                                        }}
                                                        className="mt-4 px-4 py-2 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded-xl text-[10px] font-black text-rose-500 uppercase tracking-widest transition-all"
                                                    >
                                                        Revoke Connection Now
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="py-12 text-center surface-card border-dashed border-slate-800/50">
                                        <p className="text-[11px] font-black text-slate-700 uppercase tracking-[0.3em]">No exit protocol record found in history.</p>
                                    </div>
                                )}
                                <div className="flex justify-end pt-4">
                                    <button
                                        type="button"
                                        onClick={() => { setIsStaffModalOpen(false); setEditingStaff(null); setStaffModalTab('IDENTITY'); }}
                                        className="btn-ghost"
                                    >
                                        Close History
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Access Control Modal - REMOVED AS IT WAS MERGED */}
            {/* Role Assignment Modal */}
            <Modal
                isOpen={isRoleAssignmentModalOpen}
                onClose={() => setIsRoleAssignmentModalOpen(false)}
            >
                <div className="relative w-full max-w-2xl h-[800px] max-h-[90vh] bg-slate-950 border border-slate-800 flex flex-col shadow-2xl overflow-hidden rounded-[2.5rem] animate-slide-down">
                    {/* Fixed Header */}
                    <div className="px-10 py-10 bg-slate-900/50 border-b border-white/5 shrink-0">
                        <div className="flex items-center gap-6">
                            <div className="w-16 h-16 bg-brand-500/10 rounded-[2rem] flex items-center justify-center border border-brand-500/20 shadow-glow shadow-brand-500/5">
                                <Users className="w-8 h-8 text-brand-500" />
                            </div>
                            <div className="space-y-1">
                                <h2 className="text-2xl font-display font-black text-white uppercase tracking-tight">
                                    Personnel Assignment
                                </h2>
                                <div className="flex items-center gap-3">
                                    <span className="text-[11px] font-black text-brand-500 uppercase tracking-[0.2em]">{selectedRoleForAssignment?.role_name}</span>
                                    <div className="w-1 h-1 rounded-full bg-slate-700" />
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.2em]">Active Protocol</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-y-auto p-10 space-y-8 scrollbar-hidden">
                        <div className="space-y-3">
                            {(() => {
                                const isRoleFilled = userOrgAccess.some(a => a.role_id === selectedRoleForAssignment?.id);
                                const assignedAccess = userOrgAccess.find(a => a.role_id === selectedRoleForAssignment?.id);
                                const assignedProfile = userProfiles.find(p => p.id === assignedAccess?.user_id);
                                const assignedStaffData = staff.find(s => s.id === assignedProfile?.staff_id);

                                const displayStaff = isRoleFilled && assignedStaffData
                                    ? [assignedStaffData]
                                    : staff.filter(s => s.is_active !== false && userProfiles.some(p => p.staff_id === s.id));

                                if (displayStaff.length === 0) {
                                    return (
                                        <div className="text-center py-24 bg-slate-950/20 rounded-[3rem] border border-dashed border-slate-800/50">
                                            <p className="text-[11px] font-black text-slate-700 uppercase tracking-[0.3em]">No personnel records found.</p>
                                        </div>
                                    );
                                }

                                return displayStaff.map(s => {
                                    const profileId = userProfiles.find(p => p.staff_id === s.id)?.id;
                                    const isAssigned = profileId ? userOrgAccess.some(a => a.user_id === profileId && a.role_id === selectedRoleForAssignment?.id) : false;
                                    const isLinked = !!profileId;

                                    return (
                                        <div key={s.id} className={`flex items-center justify-between p-7 bg-slate-900 border rounded-3xl group transition-all ${isLinked ? 'border-slate-800 hover:border-brand-500/30 shadow-lg shadow-black/20' : 'border-slate-800/50 opacity-60'}`}>
                                            <div className="flex items-center gap-5">
                                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg border transition-all ${isAssigned ? 'bg-brand-500/10 text-brand-500 border-brand-500/20 shadow-glow shadow-brand-500/5' : 'bg-slate-800 text-slate-600 border-slate-700'}`}>
                                                    {s.full_name.charAt(0)}
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="text-sm font-bold text-white tracking-tight">{s.full_name}</div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="text-[10px] text-slate-500 font-black tracking-[0.2em] uppercase">{s.department}</div>
                                                        {!isLinked && (
                                                            <span className="text-[9px] bg-rose-500/10 text-rose-500 px-2 py-0.5 rounded-lg border border-rose-500/20 uppercase font-black tracking-widest">No Account</span>
                                                        )}
                                                        {isRoleFilled && !isAssigned && isLinked && (
                                                            <span className="text-[9px] bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded-lg border border-amber-500/20 uppercase font-black tracking-widest">Role Occupied</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {isLinked ? (
                                                <button
                                                    onClick={() => handleToggleStaffAssignment(s.id, selectedRoleForAssignment!.id, isAssigned)}
                                                    disabled={isRoleFilled && !isAssigned}
                                                    className={`px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 ${isAssigned
                                                        ? 'bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500 hover:text-white'
                                                        : isRoleFilled
                                                            ? 'bg-slate-800 border border-slate-700 text-slate-600 cursor-not-allowed'
                                                            : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 hover:bg-emerald-500 hover:text-white'
                                                        }`}
                                                >
                                                    {isAssigned ? 'Revoke' : 'Assign'}
                                                </button>
                                            ) : (
                                                <div className="px-5 py-3 bg-slate-950 border border-slate-800 rounded-2xl text-[10px] font-black text-slate-600 uppercase tracking-widest">
                                                    Ineligible
                                                </div>
                                            )}
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        <div className="p-8 bg-brand-500/5 border border-brand-500/10 rounded-[2.5rem] flex gap-5">
                            <Shield className="w-6 h-6 text-brand-500 shrink-0" />
                            <div className="space-y-2">
                                <h5 className="text-[11px] font-black uppercase tracking-[0.2em] text-brand-500">Assignment Policy</h5>
                                <p className="text-[12px] text-slate-400 leading-relaxed font-bold">
                                    Only staff with linked user accounts can be assigned roles. Operational job roles are assigned globally across the enterprise cluster.
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Fixed Footer */}
                    <div className="px-10 py-8 bg-slate-900/50 border-t border-white/5 shrink-0 flex justify-end">
                        <button
                            onClick={() => setIsRoleAssignmentModalOpen(false)}
                            className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all active:scale-95 border border-white/5"
                        >
                            Close Protocol
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default StaffManagement;

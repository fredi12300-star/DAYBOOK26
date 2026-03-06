import {
    User,
    Mail,
    Phone,
    MapPin,
    Briefcase,
    Calendar,
    Shield,
    LogOut,
    ChevronRight,
    Camera
} from 'lucide-react';
import { StaffProfile } from '../../../types/accounting';
import { supabase } from '../../../lib/supabase';

interface StaffProfileProps {
    staff: StaffProfile;
}

export default function StaffProfile({ staff }: StaffProfileProps) {
    const handleLogout = async () => {
        await supabase.auth.signOut();
        window.location.reload();
    };

    const infoGroups = [
        {
            title: 'Personal Information',
            items: [
                { icon: User, label: 'Full Name', value: staff.full_name },
                { icon: Mail, label: 'Email Address', value: staff.email || 'Not provided' },
                { icon: Phone, label: 'Primary Mobile', value: staff.primary_mobile },
                { icon: Calendar, label: 'Date of Birth', value: staff.dob || 'Not provided' },
            ]
        },
        {
            title: 'Employment Details',
            items: [
                { icon: Briefcase, label: 'Department', value: staff.department || 'General' },
                { icon: Shield, label: 'Employment Type', value: staff.employment_type || 'Permanent' },
                { icon: Calendar, label: 'Date of Joining', value: staff.doj || 'Not provided' },
                { icon: User, label: 'Staff Code', value: staff.staff_code },
            ]
        },
        {
            title: 'Address',
            items: [
                { icon: MapPin, label: 'Current Address', value: staff.current_address || 'Not provided' },
            ]
        }
    ];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Profile Header */}
            <div className="flex flex-col items-center py-6">
                <div className="relative group">
                    <div className="w-24 h-24 bg-brand-500/10 rounded-[2rem] border-2 border-brand-500/20 flex items-center justify-center overflow-hidden">
                        {staff.photo_url ? (
                            <img src={staff.photo_url} alt="Profile" className="w-full h-full object-cover" />
                        ) : (
                            <User size={40} className="text-brand-400" />
                        )}
                    </div>
                    <button className="absolute bottom-0 right-0 p-2 bg-brand-600 rounded-xl border border-white/10 text-white shadow-lg active:scale-90 transition-transform">
                        <Camera size={14} />
                    </button>
                </div>
                <h2 className="mt-4 text-xl font-black text-white uppercase tracking-widest">{staff.full_name}</h2>
                <p className="text-[10px] font-black text-brand-400 uppercase tracking-[0.3em] mt-1">{staff.department}</p>
            </div>

            {/* Information Groups */}
            <div className="space-y-6">
                {infoGroups.map((group, idx) => (
                    <div key={idx} className="space-y-3">
                        <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2">{group.title}</h3>
                        <div className="bg-[#0f172a]/50 rounded-[2rem] border border-slate-800/50 overflow-hidden">
                            {group.items.map((item, iidx) => {
                                const Icon = item.icon;
                                return (
                                    <div key={iidx} className={`p-4 flex items-center gap-4 ${iidx !== 0 ? 'border-t border-slate-800/30' : ''}`}>
                                        <div className="p-2 bg-slate-800/50 rounded-lg">
                                            <Icon size={14} className="text-slate-400" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-0.5">{item.label}</p>
                                            <p className="text-[11px] font-bold text-slate-200">{item.value}</p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            {/* Actions */}
            <div className="space-y-3 pt-4">
                <button className="w-full p-5 bg-[#0f172a]/50 hover:bg-slate-800/50 rounded-3xl border border-slate-800/50 flex items-center justify-between group transition-all">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-brand-500/10 rounded-lg">
                            <Shield size={16} className="text-brand-400" />
                        </div>
                        <span className="text-xs font-black uppercase tracking-widest text-white">Security Settings</span>
                    </div>
                    <ChevronRight size={16} className="text-slate-600 group-hover:translate-x-1 transition-transform" />
                </button>

                <button
                    onClick={handleLogout}
                    className="w-full p-5 bg-red-500/5 hover:bg-red-500/10 rounded-3xl border border-red-500/10 flex items-center gap-4 transition-all"
                >
                    <div className="p-2 bg-red-500/10 rounded-lg">
                        <LogOut size={16} className="text-red-500" />
                    </div>
                    <span className="text-xs font-black uppercase tracking-widest text-red-500">Sign Out</span>
                </button>
            </div>

            <p className="text-center text-[8px] font-black uppercase tracking-[0.4em] text-slate-700 py-4">
                Universal Day Book v1.0.0
            </p>
        </div>
    );
}

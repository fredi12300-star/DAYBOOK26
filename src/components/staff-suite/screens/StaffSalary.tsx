import { useState, useEffect } from 'react';
import {
    CreditCard,
    ArrowUpRight,
    TrendingDown,
    AlertCircle,
    ChevronRight,
    Download,
    Eye
} from 'lucide-react';
import { StaffProfile } from '../../../types/accounting';
import { supabase } from '../../../lib/supabase';

interface StaffSalaryProps {
    staff: StaffProfile;
}

export default function StaffSalary({ staff }: StaffSalaryProps) {
    const [salaryInfo, setSalaryInfo] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadSalary = async () => {
            setIsLoading(true);
            try {
                const { data, error } = await supabase
                    .from('staff_salary')
                    .select('*')
                    .eq('staff_id', staff.id)
                    .single();

                if (error) throw error;
                setSalaryInfo(data);
            } catch (error) {
                console.error('Failed to load salary info:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadSalary();
    }, [staff.id]);

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: 'INR',
            maximumFractionDigits: 0
        }).format(amount);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
            {/* Salary Header Card */}
            <div className="bg-gradient-to-br from-indigo-600 to-brand-700 p-8 rounded-[2.5rem] shadow-glow shadow-indigo-500/20 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-3xl" />
                <div className="relative z-10">
                    <p className="text-white/60 text-[10px] font-black uppercase tracking-[0.3em] mb-2">Net Payable (Monthly)</p>
                    <h2 className="text-4xl font-black text-white mb-6">
                        {isLoading ? '...' : formatCurrency(salaryInfo?.basic_salary || 0)}
                    </h2>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/20 rounded-full backdrop-blur-md">
                            <TrendingDown size={14} className="text-white" />
                            <span className="text-[10px] font-black text-white uppercase tracking-widest">No Deductions</span>
                        </div>
                        <button className="p-2 bg-white/20 rounded-full backdrop-blur-md hover:bg-white/30 transition-all">
                            <Eye size={16} className="text-white" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Breakdown List */}
            <div className="space-y-4">
                <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em] px-2">Earning Breakdown</h3>

                <div className="space-y-3">
                    <div className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-brand-500/10 rounded-xl border border-brand-500/20">
                                <CreditCard size={18} className="text-brand-400" />
                            </div>
                            <div>
                                <p className="text-xs font-black text-white uppercase tracking-widest mb-0.5">Basic Pay</p>
                                <p className="text-[10px] text-slate-500 font-bold">Standard Monthly Base</p>
                            </div>
                        </div>
                        <p className="text-sm font-black text-white">{isLoading ? '...' : formatCurrency(salaryInfo?.basic_salary || 0)}</p>
                    </div>

                    <div className="bg-[#0f172a]/50 p-5 rounded-3xl border border-slate-800/50 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                                <ArrowUpRight size={18} className="text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-xs font-black text-white uppercase tracking-widest mb-0.5">Commission</p>
                                <p className="text-[10px] text-slate-500 font-bold">{salaryInfo?.commission_rate || 0}% per profitable txn</p>
                            </div>
                        </div>
                        <p className="text-sm font-black text-emerald-400">+ Variable</p>
                    </div>
                </div>
            </div>

            {/* Deductions Alert */}
            <div className="bg-amber-500/5 border border-amber-500/10 p-6 rounded-3xl flex items-start gap-4">
                <div className="p-2 bg-amber-500/10 rounded-xl">
                    <AlertCircle size={18} className="text-amber-500" />
                </div>
                <div>
                    <h4 className="text-xs font-black text-amber-500 uppercase tracking-widest mb-1">Attendance Impact</h4>
                    <p className="text-[10px] text-slate-500 leading-relaxed font-bold">
                        Unapproved leaves or mis-punches will be deducted in the next payroll cycle.
                        Please ensure all corrections are approved.
                    </p>
                </div>
            </div>

            {/* Archive / Payslips */}
            <div className="space-y-4">
                <div className="flex items-center justify-between px-2">
                    <h3 className="text-[10px] font-black text-slate-600 uppercase tracking-[0.4em]">Payslips Archive</h3>
                    <ChevronRight size={14} className="text-slate-600" />
                </div>

                <div className="py-10 text-center bg-slate-800/20 rounded-3xl border border-dashed border-slate-800">
                    <Download size={24} className="mx-auto text-slate-700 mb-3" />
                    <p className="text-xs font-bold text-slate-500">First payslip will be available on July 1st</p>
                </div>
            </div>
        </div>
    );
}

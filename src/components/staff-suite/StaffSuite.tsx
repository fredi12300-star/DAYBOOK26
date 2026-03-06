import { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import {
    fetchLeaveBalances,
    fetchAttendanceRecords
} from '../../lib/supabase';
import StaffSuiteLayout from './StaffSuiteLayout';
import StaffDashboard from './screens/StaffDashboard';
import StaffAttendance from './screens/StaffAttendance';
import StaffLeave from './screens/StaffLeave';
import StaffSalary from './screens/StaffSalary';
import StaffProfile from './screens/StaffProfile';

type StaffSuiteTab = 'home' | 'attendance' | 'leave' | 'salary' | 'profile';

export default function StaffSuite() {
    const { staff, isLoading: isAuthLoading } = useAuth();
    const [activeTab, setActiveTab] = useState<StaffSuiteTab>('home');
    const [isLoading, setIsLoading] = useState(true);
    const [todayAttendance, setTodayAttendance] = useState<any>(null);
    const [leaveBalances, setLeaveBalances] = useState<any[]>([]);

    useEffect(() => {
        if (isAuthLoading) return; // Wait for Auth context to finish before checking staff

        if (!staff?.id) {
            setIsLoading(false);
            return;
        }

        const loadDashboardData = async () => {
            setIsLoading(true);
            try {
                const today = new Date().toISOString().split('T')[0];
                const [attendance, balances] = await Promise.all([
                    fetchAttendanceRecords(today),
                    fetchLeaveBalances(new Date().getFullYear())
                ]);

                // Filter for current staff member
                const myAttendance = attendance.find((r: any) => r.staff_id === staff.id);
                const myBalances = balances.filter((b: any) => b.staff_id === staff.id);

                setTodayAttendance(myAttendance || null);
                setLeaveBalances(myBalances);
            } catch (error) {
                console.error('Failed to load Staff Suite data:', error);
            } finally {
                setIsLoading(false);
            }
        };

        loadDashboardData();
    }, [staff?.id]);

    const getTitle = () => {
        switch (activeTab) {
            case 'home': return 'Staff Suite';
            case 'attendance': return 'Attendance History';
            case 'leave': return 'Leave Management';
            case 'salary': return 'Salary Summary';
            case 'profile': return 'My Profile';
            default: return 'Staff Suite';
        }
    };

    const renderContent = () => {
        if (isLoading || isAuthLoading) {
            return (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-10 h-10 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Syncing Data...</p>
                </div>
            );
        }

        if (!staff) {
            return (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-6 animate-in fade-in zoom-in duration-500">
                    <div className="w-20 h-20 bg-slate-800/50 rounded-[2rem] border border-slate-700 flex items-center justify-center">
                        <User size={32} className="text-slate-400" />
                    </div>
                    <div className="space-y-2">
                        <h3 className="text-sm font-black uppercase tracking-widest text-white">No Staff Profile Linked</h3>
                        <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                            Your user account is not linked to any staff record.
                            Please link your account in the Staff Management section to use the self-service portal.
                        </p>
                    </div>
                </div>
            );
        }

        switch (activeTab) {
            case 'home':
                return (
                    <StaffDashboard
                        staff={staff}
                        todayAttendance={todayAttendance}
                        leaveBalance={leaveBalances}
                        onNavigate={(tab) => setActiveTab(tab as StaffSuiteTab)}
                    />
                );
            case 'attendance': return <StaffAttendance staff={staff} />;
            case 'leave': return <StaffLeave staff={staff} />;
            case 'salary': return <StaffSalary staff={staff} />;
            case 'profile': return <StaffProfile staff={staff} />;
            default: return <StaffDashboard staff={staff} todayAttendance={todayAttendance} leaveBalance={leaveBalances} onNavigate={(tab) => setActiveTab(tab as StaffSuiteTab)} />;
        }
    };

    return (
        <StaffSuiteLayout
            activeTab={activeTab}
            onTabChange={(tab) => setActiveTab(tab as StaffSuiteTab)}
            title={getTitle()}
            showBack={activeTab !== 'home'}
            onBack={() => setActiveTab('home')}
        >
            {renderContent()}
        </StaffSuiteLayout>
    );
}

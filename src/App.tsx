import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    BookOpen, FileText, BarChart3, Plus, Menu, X,
    PieChart, User, Zap, Settings,
    ChevronRight, Ticket, Landmark, ShieldCheck, ShieldAlert, MonitorSmartphone, KeyRound,
    LogOut, Clock, Database, Calculator, RefreshCw
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import DayBook from './components/DayBook';
import LedgerMaster from './components/LedgerMaster';
import PartyMaster from './components/PartyMaster';
import Reports from './components/Reports';
import SystemSettings from './components/SystemSettings';
import GeneralSettings from './components/GeneralSettings';
import { fetchSystemConfig } from './lib/supabase';
import { useAuth } from './lib/auth';
import type { SystemConfiguration } from './types/accounting';
import TemplatesPage from './components/automation/TemplatesPage';
import VoucherMaster from './components/VoucherMaster';
import VoucherSessionEntry from './components/VoucherSessionEntry';
import BankTransactions from './components/BankTransactions';
import TransactionApprovals from './components/TransactionApprovals';

import StaffManagement from './components/enterprise/StaffManagement';
import RoleManagement from './components/enterprise/RoleManagement';
import DeviceManagement from './components/enterprise/DeviceManagement';
import AuditLogViewer from './components/enterprise/AuditLogViewer';
import ApprovalRequestsHub from './components/enterprise/ApprovalRequestsHub';
import ImportCenter from './components/ImportCenter';
import BankReconciliation from './components/BankReconciliation';
import HRManagement from './components/hr/HRManagement';
import LeaveManagement from './components/hr/LeaveManagement';
import AttendanceManagement from './components/hr/AttendanceManagement';
import { ExitManagement } from './components/hr/ExitManagement';
import PayrollManagement from './components/hr/PayrollManagement';
import UnsavedChangesModal from './components/ui/UnsavedChangesModal';
import SidebarDateIndicator from './components/ui/SidebarDateIndicator';
import LoginPage from './components/auth/LoginPage';
import AccessDenied from './components/auth/AccessDenied';
import { getBusinessDateOverride, setBusinessDateOverride } from './lib/businessDate';
import { supabase } from './lib/supabase';
import { Toaster } from 'react-hot-toast';
import StaffSuite from './components/staff-suite/StaffSuite';
import './index.css';

type Page = 'dashboard' | 'session' | 'daybook' | 'bank_txn' | 'bank_recon' | 'approvals' | 'ledgers' | 'vouchers' | 'parties' | 'reports' | 'templates' | 'core_settings' | 'general_settings' | 'staff_mgmt' | 'role_mgmt' | 'approval_hub' | 'device_mgmt' | 'audit_logs' | 'hr_staff_dir' | 'hr_leave' | 'hr_exit' | 'hr_payroll' | 'hr_attendance' | 'hr_recruitment' | 'hr_onboarding' | 'hr_performance' | 'hr_training' | 'hr_documents' | 'hr_grievance' | 'hr_analytics' | 'hr_settings' | 'import_center' | 'staff_suite';

const navigation = [
    { id: 'dashboard' as Page, name: 'Main Dashboard', icon: BarChart3, group: 'analytics' },
    { id: 'reports' as Page, name: 'Financial Hub', icon: PieChart, group: 'analytics' },
    { id: 'session' as Page, name: 'ADD NEW TXN', icon: Plus, group: 'ops' },
    { id: 'daybook' as Page, name: 'Global Journal', icon: BookOpen, group: 'ops' },
    { id: 'bank_txn' as Page, name: 'Bank Txn', icon: Landmark, group: 'ops' },
    { id: 'bank_recon' as Page, name: 'Bank Recon', icon: RefreshCw, group: 'ops' },
    { id: 'approvals' as Page, name: 'TXN Approvals', icon: ShieldCheck, group: 'ops' },
    { id: 'ledgers' as Page, name: 'Ledger Master', icon: FileText, group: 'masters' },
    { id: 'vouchers' as Page, name: 'Voucher Master', icon: Ticket, group: 'masters' },
    { id: 'parties' as Page, name: 'Party Master', icon: User, group: 'masters' },
    { id: 'templates' as Page, name: 'Automation', icon: Zap, group: 'masters' },
    { id: 'import_center' as Page, name: 'Data Import', icon: Database, group: 'masters' },
    { id: 'staff_suite' as Page, name: 'Staff Suite', icon: MonitorSmartphone, group: 'ops' },
    { id: 'core_settings' as Page, name: 'Core Settings', icon: Settings, group: 'admin' },

    { id: 'staff_mgmt' as Page, name: 'Staff & Roles', icon: User, group: 'user_mgmt' },
    { id: 'role_mgmt' as Page, name: 'User Roles', icon: KeyRound, group: 'user_mgmt' },
    { id: 'device_mgmt' as Page, name: 'Devices', icon: MonitorSmartphone, group: 'user_mgmt' },
    { id: 'approval_hub' as Page, name: 'Approval Hub', icon: ShieldCheck, group: 'user_mgmt' },
    { id: 'audit_logs' as Page, name: 'System Logs', icon: ShieldAlert, group: 'user_mgmt' },
    { id: 'general_settings' as Page, name: 'SETTINGS', icon: Settings, group: 'admin' },

    // HR Management
    { id: 'hr_staff_dir' as Page, name: 'Staff Directory', icon: User, group: 'hr' },
    { id: 'hr_leave' as Page, name: 'Leave Management', icon: FileText, group: 'hr' },
    { id: 'hr_exit' as Page, name: 'Relieving & Exit', icon: ChevronRight, group: 'hr' },
    { id: 'hr_payroll' as Page, name: 'Payroll', icon: Calculator, group: 'hr' },
    { id: 'hr_attendance' as Page, name: 'Attendance Management', icon: Clock, group: 'hr' },
    { id: 'hr_recruitment' as Page, name: 'Recruitment', icon: Plus, group: 'hr' },
    { id: 'hr_onboarding' as Page, name: 'Onboarding', icon: User, group: 'hr' },
    { id: 'hr_performance' as Page, name: 'Performance', icon: PieChart, group: 'hr' },
    { id: 'hr_training' as Page, name: 'Training & Development', icon: Zap, group: 'hr' },
    { id: 'hr_documents' as Page, name: 'Employee Documents', icon: FileText, group: 'hr' },
    { id: 'hr_grievance' as Page, name: 'Grievance & Discipline', icon: ShieldAlert, group: 'hr' },
    { id: 'hr_analytics' as Page, name: 'HR Analytics', icon: BarChart3, group: 'hr' },
    { id: 'hr_settings' as Page, name: 'HR Settings', icon: Settings, group: 'hr' },
];

function App() {
    const { user, profile, access, isLoading, canExecute, isSuperAdmin } = useAuth();
    const [currentPage, setCurrentPage] = useState<Page>('dashboard');
    const [refreshKey, setRefreshKey] = useState(0);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const [config, setConfig] = useState<SystemConfiguration | null>(null);

    const handleLogout = async () => {
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch (error) {
            console.error('Logout failed:', error);
        }
    };

    useEffect(() => {
        if (!user) return; // Only load config if authenticated
        const loadConfig = async () => {
            try {
                const data = await fetchSystemConfig();
                setConfig(data);

                // Synchronize DB business date with local override state
                const dbDate = data?.business_date || null;
                if (dbDate !== getBusinessDateOverride()) {
                    setBusinessDateOverride(dbDate);
                }
            } catch (error) {
                console.error('Failed to load system config in App:', error);
            }
        };

        loadConfig();
        // Polling for config changes to keep sidebar in sync with settings
        const interval = setInterval(loadConfig, 10000);
        return () => clearInterval(interval);
    }, []);

    // Navigation Interception State
    const [isSessionDirty, setIsSessionDirty] = useState(false);
    const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
    const [pendingPage, setPendingPage] = useState<Page | null>(null);
    const [saveDraftTrigger, setSaveDraftTrigger] = useState(0);
    const [reportsContext, setReportsContext] = useState<{
        ledgerId: string;
        partyId: string;
        view: 'list' | 'profile' | 'ledger';
    } | null>(null);

    const canAccessPage = useCallback((page: Page): boolean => {
        if (page === 'approvals' && config?.enable_txn_approvals === false) return false;

        if (page === 'staff_mgmt' && !canExecute('staff_mgmt', 'manage_staff')) return false;
        if (page === 'role_mgmt' && !canExecute('role_mgmt', 'manage_org')) return false;
        if (page === 'core_settings' && !canExecute('role_mgmt', 'manage_org')) return false;
        if (page === 'device_mgmt' && !canExecute('device_mgmt', 'manage_devices')) return false;
        if (page === 'approval_hub' && !canExecute('approval_hub', 'view_approvals')) return false;
        if (page === 'audit_logs' && !canExecute('audit_logs', 'view_audits')) return false;

        if (page === 'staff_suite') {
            console.log('DEBUG: Accessing Staff Suite check:', {
                staffId: profile?.staff?.id,
                isSuperAdmin,
                hasAccess: !!(profile?.staff?.id || isSuperAdmin)
            });
            if (profile?.staff?.id || isSuperAdmin) return true;
        }

        return canExecute(page, 'view');
    }, [canExecute, config?.enable_txn_approvals, profile?.staff?.id, isSuperAdmin]);


    const handleSafeNavigate = useCallback((destination: Page) => {
        if (!canAccessPage(destination)) return;

        // 1. If we are on the session page and it's dirty, we MUST ask before any navigation (including re-click)
        if (currentPage === 'session' && isSessionDirty) {
            setPendingPage(destination);
            setShowUnsavedPrompt(true);
            return;
        }

        // 2. If it's the same page, just refresh
        if (destination === currentPage) {
            setRefreshKey(prev => prev + 1);
            return;
        }

        // 3. Normal navigation
        setCurrentPage(destination);
    }, [canAccessPage, currentPage, isSessionDirty]);


    if (isLoading) {
        return (
            <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
                <div className="w-12 h-12 border-4 border-brand-500/20 border-t-brand-500 rounded-full animate-spin" />
            </div>
        );
    }

    if (!user) {
        return <LoginPage />;
    }

    function renderPage() {
        if (!canAccessPage(currentPage)) {
            return (
                <AccessDenied
                    onNavigateBack={() => {
                        // Attempt to go back to the previous page if possible, 
                        // or just reset to dashboard
                        setCurrentPage('dashboard');
                    }}
                    onGoHome={() => setCurrentPage('dashboard')}
                />
            );
        }

        switch (currentPage) {
            case 'dashboard': return <Dashboard />;
            case 'session': return (
                <VoucherSessionEntry
                    onDirtyChange={setIsSessionDirty}
                    forceSaveDraftTrigger={saveDraftTrigger}
                    onNavigateToReports={(data) => {
                        setReportsContext(data);
                        handleSafeNavigate('reports');
                    }}
                    onSavedSuccessfully={() => {
                        if (pendingPage) {
                            if (pendingPage === currentPage) {
                                setRefreshKey(prev => prev + 1);
                            } else {
                                setCurrentPage(pendingPage);
                            }
                            setPendingPage(null);
                        }
                        setShowUnsavedPrompt(false);
                        setSaveDraftTrigger(0);
                    }}
                />
            );
            case 'daybook': return <DayBook />;
            case 'bank_txn': return <BankTransactions />;
            case 'bank_recon': return <BankReconciliation />;
            case 'approvals': return <TransactionApprovals />;
            case 'ledgers': return <LedgerMaster />;
            case 'vouchers': return <VoucherMaster />;
            case 'parties': return <PartyMaster />;
            case 'reports': return (
                <Reports
                    initialContext={reportsContext}
                    onContextHandled={() => setReportsContext(null)}
                />
            );
            case 'templates': return <TemplatesPage />;
            case 'core_settings': return <SystemSettings config={config} onConfigUpdate={setConfig} />;

            case 'staff_mgmt': return <StaffManagement />;
            case 'role_mgmt': return <RoleManagement />;
            case 'device_mgmt': return <DeviceManagement />;
            case 'approval_hub': return <ApprovalRequestsHub />;
            case 'audit_logs': return <AuditLogViewer />;
            case 'general_settings': return <GeneralSettings />;
            case 'import_center': return <ImportCenter />;

            // HR Management — Staff Directory shows the full StaffManagement component
            case 'hr_staff_dir':
                return <StaffManagement />;

            case 'hr_leave':
                return <LeaveManagement initialTab="requests" />;

            case 'hr_attendance':
                return <AttendanceManagement />;

            case 'hr_exit':
                return <ExitManagement />;

            case 'hr_payroll':
                return <PayrollManagement />;

            case 'hr_recruitment':
                return <AccessDenied />; // Placeholder for now

            // Other HR sub-pages show the HR overview for now
            case 'hr_onboarding':
            case 'hr_performance':
            case 'hr_training':
            case 'hr_documents':
            case 'hr_grievance':
            case 'hr_analytics':
            case 'hr_settings':
                return <HRManagement />;

            case 'staff_suite':
                return <StaffSuite />;

            default: return <Dashboard />;
        }
    }

    const groups = [
        { id: 'analytics', label: 'Intelligence' },
        { id: 'ops', label: 'Operations' },
        { id: 'masters', label: 'Masters' },
        { id: 'user_mgmt', label: 'User Management' },
        { id: 'admin', label: 'Administration' },
        { id: 'hr', label: 'HR Management' },
    ];

    const activeRoles = [
        ...(isSuperAdmin ? ['Super Admin'] : []),
        ...(access?.map(a => {
            const r = a.role;
            if (Array.isArray(r)) {
                return r[0]?.role_name;
            }
            return (r as any)?.role_name;
        }).filter(Boolean) || []),
        ...(profile?.staff?.department ? [profile.staff.department] : [])
    ];


    // De-duplicate roles in case multiple access entries have the same role
    const uniqueRoles = [...new Set(activeRoles)];
    const rolesHeader = uniqueRoles.length > 0 ? uniqueRoles.join(', ') : 'Standard Access';

    // -- STAFF-ONLY SHORTCUT --
    // If the user is a staff member with no broad app access (not super admin,
    // cannot view the main dashboard), send them straight to Staff Suite fullscreen.
    const isStaffOnlyUser = !!(profile?.staff?.id && !isSuperAdmin && !canExecute('dashboard', 'view'));
    if (isStaffOnlyUser) {
        return (
            <div className="min-h-screen bg-[#020617] text-slate-100 font-sans antialiased">
                <StaffSuite />
                <Toaster position="top-right" toastOptions={{
                    duration: 5000,
                    style: { background: '#0f172a', color: '#f1f5f9', border: '1px solid rgba(148,163,184,0.1)', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em' }
                }} />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#020617] flex text-slate-100 selection:bg-brand-500/30 font-sans antialiased">

            {/* Sidebar - Desktop */}
            <aside className="fixed inset-y-0 left-0 w-72 bg-[#0f172a] border-r border-slate-800/20 hidden lg:flex flex-col z-50 transition-all duration-500 ease-in-out">
                <div className="p-8 h-full flex flex-col">
                    {/* Logo */}
                    <div className="flex items-center gap-4 mb-14 px-2">
                        <div className="p-1.5 bg-white rounded-full shadow-glow shadow-brand-500/10 overflow-hidden flex items-center justify-center min-w-[40px] min-h-[40px] max-w-[40px] max-h-[40px] border border-slate-200">
                            {config?.business_logo_url ? (
                                <img src={config.business_logo_url} alt="Logo" className="w-full h-full object-contain scale-90" />
                            ) : (
                                <div className="p-2 bg-brand-600 w-full h-full flex items-center justify-center rounded-full">
                                    <BookOpen size={18} className="text-white" />
                                </div>
                            )}
                        </div>
                        <div>
                            <h1 className="text-sm font-display font-black tracking-tight leading-none uppercase truncate max-w-[180px]" title={config?.business_name || 'Universal'}>
                                {config?.business_name || 'Universal'}
                            </h1>
                            <p className="text-[10px] font-black text-brand-500 tracking-[0.3em] mt-1.5 uppercase">Day Book</p>
                        </div>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 space-y-10 overflow-y-auto no-scrollbar">
                        {groups.map(group => {
                            const groupNavigation = navigation.filter(n => n.group === group.id && canAccessPage(n.id));

                            if (groupNavigation.length === 0) return null;

                            return (
                                <div key={group.id} className="space-y-3">
                                    <h3 className="text-[9px] font-black text-slate-600 uppercase tracking-[0.4em] px-4 font-display opacity-80">{group.label}</h3>
                                    <div className="space-y-1">
                                        {groupNavigation.map(item => {
                                            const Icon = item.icon;
                                            const isActive = currentPage === item.id;
                                            return (
                                                <button
                                                    type="button"
                                                    key={item.id}
                                                    onClick={() => handleSafeNavigate(item.id)}
                                                    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${isActive
                                                        ? 'bg-brand-600/10 text-brand-400 border border-brand-500/10 shadow-glow shadow-brand-500/5 translate-x-1'
                                                        : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-200 border border-transparent'
                                                        } `}
                                                >
                                                    <Icon size={18} strokeWidth={isActive ? 3 : 2} className={isActive ? 'text-brand-400' : 'text-slate-600'} />
                                                    <span className="truncate">{item.name}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </nav>
                    {/* User Status */}
                    <div className="mt-8 pt-8 border-t border-slate-800/30">
                        <div className="p-4 bg-slate-800/20 rounded-2xl border border-slate-800/30 flex items-center justify-between gap-3 group/user">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 bg-brand-600/10 rounded-xl flex items-center justify-center flex-shrink-0">
                                    <User size={14} className="text-brand-500" />
                                </div>
                                <div className="flex flex-col min-w-0">
                                    <div className="text-sm font-semibold text-slate-200">
                                        {profile?.staff?.full_name || user?.email?.split('@')[0] || 'System User'}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest truncate" title={rolesHeader}>
                                            {rolesHeader}
                                        </span>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={handleLogout}
                                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all flex-shrink-0"
                                title="Sign Out"
                            >
                                <LogOut size={16} />
                            </button>
                        </div>

                        {/* Interactive Sidebar Date Control */}
                        <div className="space-y-4">
                            <SidebarDateIndicator />
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Container */}
            <main className="flex-1 lg:pl-72 flex flex-col min-h-screen relative overflow-hidden">

                {/* Mobile Menu Button - Floated since header is removed */}
                <div className="absolute top-4 right-4 z-50 lg:hidden">
                    <button
                        type="button"
                        onClick={() => setMobileMenuOpen(true)}
                        className="p-3 bg-slate-800/50 rounded-xl text-slate-400 hover:text-white transition-colors backdrop-blur-md border border-slate-700/50"
                    >
                        <Menu size={22} />
                    </button>
                </div>

                {/* Workspace Canvas */}
                <div className="flex-1 p-10 overflow-x-hidden overflow-y-auto">
                    <div className="max-w-7xl mx-auto" key={currentPage + refreshKey}>
                        {renderPage()}
                    </div>
                </div>

                {/* Global Footer */}
                <footer className="px-10 py-8 border-t border-slate-800/10 flex flex-col md:flex-row justify-between items-center gap-4 bg-[#020617]/20">
                    <p className="text-[9px] font-black text-slate-700 uppercase tracking-[0.4em] text-center md:text-left">
                        Double-Entry Integrity &bull; Real-Time Aggregation &bull; Enterprise Standard
                    </p>
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-3">
                            <span className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Powered by</span>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b-2 border-brand-600 pb-0.5 transition-all hover:text-brand-500 cursor-default">Supabase Engine</span>
                        </div>
                    </div>
                </footer>
            </main>

            {/* Mobile Drawer */}
            {mobileMenuOpen && createPortal(
                <div className="fixed inset-0 bg-[#020617] z-[100] lg:hidden animate-fade-in flex flex-col">
                    <div className="flex justify-between items-center p-8 mb-4">
                        <div className="flex items-center gap-4">
                            <div className="p-2 bg-brand-600 rounded-xl">
                                <BookOpen size={24} className="text-white" />
                            </div>
                            <span className="text-[11px] font-black uppercase tracking-widest text-slate-200">Workspace Selection</span>
                        </div>
                        <button type="button" onClick={() => setMobileMenuOpen(false)} className="p-3 bg-slate-800 rounded-2xl active:scale-90 transition-transform">
                            <X size={24} />
                        </button>
                    </div>

                    <nav className="flex-1 space-y-3 overflow-y-auto px-8 pb-10">
                        {navigation.filter(item => canAccessPage(item.id)).map(item => (
                            <button
                                type="button"
                                key={item.id}
                                onClick={() => { handleSafeNavigate(item.id); setMobileMenuOpen(false); }}
                                className="w-full text-left p-6 bg-[#0f172a] border border-slate-800 rounded-[2rem] flex items-center justify-between group active:scale-95 transition-all"
                            >
                                <div className="flex items-center gap-5">
                                    <div className="p-3 bg-slate-800 rounded-2xl group-hover:bg-brand-600/20 group-hover:text-brand-400 transition-all">
                                        <item.icon size={22} className="text-slate-500 group-hover:text-brand-400" />
                                    </div>
                                    <span className="text-xs font-black uppercase tracking-widest text-slate-300 group-hover:text-white transition-colors">{item.name}</span>
                                </div>
                                <ChevronRight size={16} className="text-slate-700 group-hover:text-brand-600 group-hover:translate-x-1 transition-all" />
                            </button>
                        ))}
                    </nav>
                </div>,
                document.body
            )}

            {/* Unsaved Changes Prompt */}
            <UnsavedChangesModal
                isOpen={showUnsavedPrompt}
                onClose={() => {
                    setShowUnsavedPrompt(false);
                    setPendingPage(null);
                }}
                onDiscard={() => {
                    if (pendingPage) {
                        setIsSessionDirty(false); // Explicitly clear so next render doesn't block
                        if (pendingPage === currentPage) {
                            setRefreshKey(prev => prev + 1);
                        } else {
                            setCurrentPage(pendingPage);
                        }
                        setPendingPage(null);
                    }
                    setShowUnsavedPrompt(false);
                }}
                onSaveDraft={() => {
                    setSaveDraftTrigger(prev => prev + 1);
                }}
            />

            <Toaster position="top-right" toastOptions={{
                duration: 5000,
                style: {
                    background: '#0f172a',
                    color: '#f1f5f9',
                    border: '1px solid rgba(148, 163, 184, 0.1)',
                    fontSize: '12px',
                    fontWeight: '800',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em'
                }
            }} />
        </div>
    );
}

export default App;

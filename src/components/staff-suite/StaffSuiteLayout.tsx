import React from 'react';
import {
    Home,
    Clock,
    FileText,
    CreditCard,
    User,
    ChevronLeft,
    LogOut
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface StaffSuiteLayoutProps {
    children: React.ReactNode;
    activeTab: string;
    onTabChange: (tab: any) => void;
    title: string;
    showBack?: boolean;
    onBack?: () => void;
}

export default function StaffSuiteLayout({
    children,
    activeTab,
    onTabChange,
    title,
    showBack,
    onBack
}: StaffSuiteLayoutProps) {
    const tabs = [
        { id: 'home', icon: Home, label: 'Home' },
        { id: 'attendance', icon: Clock, label: 'Attendance' },
        { id: 'leave', icon: FileText, label: 'Leave' },
        { id: 'salary', icon: CreditCard, label: 'Salary' },
        { id: 'profile', icon: User, label: 'Profile' }
    ];

    return (
        <div className="flex flex-col h-screen bg-[#020617] text-slate-100 font-sans md:max-w-md md:mx-auto md:border-x md:border-slate-800 shadow-2xl">
            {/* Top Header */}
            <header className="flex-shrink-0 px-6 py-5 bg-[#0f172a]/50 backdrop-blur-xl border-b border-slate-800/50 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-3">
                    {showBack && (
                        <button
                            onClick={onBack}
                            className="p-2 -ml-2 hover:bg-slate-800 rounded-full transition-colors"
                        >
                            <ChevronLeft size={20} />
                        </button>
                    )}
                    <h1 className="text-lg font-black uppercase tracking-widest text-white shadow-glow shadow-white/5">
                        {title}
                    </h1>
                </div>
                <button
                    onClick={async () => {
                        try {
                            await supabase.auth.signOut({ scope: 'local' });
                        } catch (error) {
                            console.error('Logout failed:', error);
                        }
                    }}
                    className="p-2 sm:px-3 sm:py-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                    title="Sign Out"
                >
                    <span className="hidden sm:inline">Sign Out</span>
                    <LogOut size={16} />
                </button>
            </header>

            {/* Content Area */}
            <main className="flex-1 overflow-y-auto px-6 py-8 pb-32 custom-scrollbar">
                {children}
            </main>

            {/* Bottom Navigation */}
            <nav className="flex-shrink-0 px-4 py-3 bg-[#0f172a]/80 backdrop-blur-2xl border-t border-slate-800/50 fixed bottom-0 left-0 right-0 md:max-w-md md:mx-auto z-50">
                <div className="flex items-center justify-around">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={`flex flex-col items-center gap-1.5 p-2 transition-all duration-300 ${isActive
                                    ? 'text-brand-400 scale-110'
                                    : 'text-slate-500 opacity-60'
                                    }`}
                            >
                                <div className={`p-2 rounded-xl transition-all ${isActive ? 'bg-brand-500/10 shadow-glow shadow-brand-500/10' : ''
                                    }`}>
                                    <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                                </div>
                                <span className="text-[9px] font-black uppercase tracking-widest">
                                    {tab.label}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </nav>
        </div>
    );
}

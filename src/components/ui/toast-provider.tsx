"use client";
import { useState, useCallback, createContext, useContext } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy, Phone, Mail, MapPin, FileText } from "lucide-react";

// ═══════════════════════════════════════════════
// Toast Provider + Hook
// ═══════════════════════════════════════════════
interface Toast {
    id: string;
    message: string;
    type?: "success" | "info" | "error" | "warning";
    icon?: "copy" | "phone" | "email" | "address" | "note";
    onUndo?: () => void;
    duration?: number;
}

interface ToastContextValue {
    toast: (message: string, opts?: { type?: Toast["type"]; icon?: Toast["icon"]; onUndo?: () => void; duration?: number }) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => { } });

export function useToast() {
    return useContext(ToastContext);
}

const ICON_MAP = {
    copy: Copy,
    phone: Phone,
    email: Mail,
    address: MapPin,
    note: FileText,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((message: string, opts?: { type?: Toast["type"]; icon?: Toast["icon"]; onUndo?: () => void; duration?: number }) => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const duration = opts?.duration ?? (opts?.onUndo ? 5000 : 2500);
        setToasts(prev => [...prev, { id, message, type: opts?.type || "success", icon: opts?.icon, onUndo: opts?.onUndo, duration }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, duration);
    }, []);

    return (
        <ToastContext.Provider value={{ toast: addToast }}>
            {children}
            {/* Toast container */}
            <div
                aria-atomic="false"
                aria-live="polite"
                className="pointer-events-none fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-4 right-4 z-[200] flex flex-col gap-2 md:bottom-6 md:left-auto md:right-6"
            >
                {toasts.map((t) => {
                    const IconComp = t.icon ? ICON_MAP[t.icon] : Check;
                    return (
                        <div
                            key={t.id}
                            role={t.type === "error" || t.type === "warning" ? "alert" : "status"}
                            className="owner-toast pointer-events-auto flex min-w-[240px] items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium"
                        >
                            <div className={cn(
                                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                                t.type === "success" && "bg-[#0a0a0a] text-[#f2e3c2]",
                                t.type === "info" && "bg-[#f4ead6] text-[#5c4210]",
                                (t.type === "error" || t.type === "warning") && "bg-rose-100 text-rose-800",
                            )}>
                                {t.icon ? <IconComp className="h-3.5 w-3.5" /> : <svg viewBox="0 0 16 16" className="owner-check h-3.5 w-3.5" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </div>
                            <span className="flex-1 text-[13px]">{t.message}</span>
                            {t.onUndo && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        t.onUndo?.();
                                        setToasts(prev => prev.filter(x => x.id !== t.id));
                                    }}
                                    className="shrink-0 cursor-pointer rounded-md border border-[#e6d6b3] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#5c4210] transition-colors hover:bg-[#fbf3e2]"
                                >
                                    Undo
                                </button>
                            )}
                            <span className="owner-toast-bar" style={{ animationDuration: `${t.duration ?? 2500}ms` }} aria-hidden="true" />
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}

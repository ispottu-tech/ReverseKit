import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useGetFridaStatus, getGetFridaStatusQueryKey } from "@workspace/api-client-react";

function LogoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 22V12" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 7l9 5 9-5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" fill="currentColor" opacity="0.6" />
      <path d="M7.5 9.5L12 12l4.5-2.5" stroke="currentColor" strokeWidth="1" opacity="0.4" />
    </svg>
  );
}

function NavIcon({ type, className }: { type: string; className?: string }) {
  const c = className || "w-[18px] h-[18px]";
  switch (type) {
    case "home":
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={c}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" /><path d="M9 21V14h6v7" /></svg>);
    case "binary":
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={c}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h1v6H9z" fill="currentColor" stroke="none" /><path d="M14 9h1v6h-1z" fill="currentColor" stroke="none" /><path d="M4 12h16" strokeOpacity="0.3" /></svg>);
    case "hex":
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={c}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" strokeOpacity="0.25" /><text x="5.5" y="7.5" fontSize="4" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">0F</text><text x="11" y="13.5" fontSize="4" fill="currentColor" stroke="none" fontFamily="monospace" fontWeight="bold">A3</text></svg>);
    case "scripts":
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={c}><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" /><path d="M14 2v6h6" /><path d="M8 13l2 2-2 2M12 17h4" /></svg>);
    case "device":
      return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={c}><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M12 18h.01" strokeWidth="2.5" strokeLinecap="round" /><path d="M9 2h6" strokeOpacity="0.3" /></svg>);
    default:
      return null;
  }
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey(), refetchInterval: 5000 } });
  const isConnected = !!status?.connected;

  const sections = [
    {
      items: [
        { href: "/", label: "Home", icon: "home" },
      ],
    },
    {
      label: "Analysis",
      items: [
        { href: "/binary", label: "Binary Inspector", icon: "binary" },
        { href: "/hex", label: "Hex Viewer", icon: "hex" },
      ],
    },
    {
      label: "Toolkit",
      items: [
        { href: "/scripts", label: "Script Arsenal", icon: "scripts" },
        { href: "/device", label: "Device Manager", icon: "device" },
      ],
    },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans selection:bg-primary/30 dark">
      <aside className="w-[220px] border-r border-border/60 bg-sidebar flex-shrink-0 flex flex-col z-10">
        {/* Logo */}
        <div className="h-16 flex items-center px-5 gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/25 flex items-center justify-center flex-shrink-0">
            <LogoIcon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-[15px] tracking-tight text-sidebar-foreground leading-tight">ReverseKit</span>
            <span className="text-[10px] text-muted-foreground/50 font-medium tracking-wide">iOS ANALYSIS</span>
          </div>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-border/60 to-transparent mx-3" />

        {/* Navigation */}
        <nav className="flex-1 py-4 flex flex-col gap-1 px-3 overflow-y-auto">
          {sections.map((section, si) => (
            <div key={si}>
              {section.label && (
                <div className="px-3 mt-3 mb-1.5">
                  <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/40 font-semibold">{section.label}</span>
                </div>
              )}
              {section.items.map((item) => {
                const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href} className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all duration-200 group relative",
                    isActive
                      ? "bg-primary/10 text-primary glow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  )}>
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-primary" />
                    )}
                    <NavIcon type={item.icon} className={cn("w-[18px] h-[18px] flex-shrink-0 transition-colors", isActive ? "text-primary" : "text-muted-foreground/60 group-hover:text-foreground/70")} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Connection Status */}
        <div className="p-3">
          <Link href="/device" className={cn(
            "flex items-center gap-3 px-3.5 py-3 rounded-xl transition-all duration-200 group",
            isConnected
              ? "bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20"
              : "bg-secondary/30 border border-border/50 hover:bg-secondary/50"
          )}>
            <div className="relative">
              <div className={cn(
                "w-2 h-2 rounded-full",
                isConnected ? "bg-primary" : "bg-muted-foreground/30"
              )} />
              {isConnected && (
                <div className="absolute inset-0 w-2 h-2 rounded-full bg-primary animate-ping opacity-40" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className={cn("text-[11px] font-semibold tracking-wide", isConnected ? "text-primary" : "text-muted-foreground/70")}>
                {isConnected ? "DEVICE ONLINE" : "NO DEVICE"}
              </div>
              {isConnected && status?.deviceName && (
                <div className="text-[10px] text-muted-foreground truncate">{status.deviceName}</div>
              )}
            </div>
          </Link>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-background">
        {children}
      </main>
    </div>
  );
}

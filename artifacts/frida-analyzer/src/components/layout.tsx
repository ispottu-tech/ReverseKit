import { Link, useLocation } from "wouter";
import { LayoutDashboard, Cpu, AppWindow, Workflow, ScanSearch, BookMarked, TerminalSquare, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetFridaStatus, getGetFridaStatusQueryKey } from "@workspace/api-client-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey(), refetchInterval: 5000 } });

  const isConnected = !!status?.connected;

  const navItems = [
    { href: "/", label: "Control Panel", icon: LayoutDashboard },
    { href: "/processes", label: "Processes", icon: Cpu },
    { href: "/applications", label: "Applications", icon: AppWindow },
    { href: "/sessions", label: "Sessions", icon: Workflow },
    { href: "/scripts", label: "Script Arsenal", icon: BookMarked },
    { href: "/binary", label: "Binary Inspector", icon: ScanSearch },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans selection:bg-primary/30 dark">
      <aside className="w-60 border-r border-border bg-sidebar flex-shrink-0 flex flex-col z-10">
        {/* Logo */}
        <div className="h-14 flex items-center px-5 border-b border-border/60 gap-3">
          <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center flex-shrink-0">
            <Crosshair className="w-4 h-4 text-primary" />
          </div>
          <div>
            <span className="font-bold text-sm tracking-tight text-sidebar-foreground">ReverseKit</span>
            <div className="text-[10px] text-muted-foreground/60 font-mono leading-none mt-0.5">iOS Analysis Platform</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 flex flex-col gap-0.5 px-2 overflow-y-auto">
          <div className="px-2 mb-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 font-semibold">Dynamic Analysis</span>
          </div>
          {navItems.slice(0, 4).map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/12 text-primary border border-primary/20"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground border border-transparent"
              )}>
                <item.icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? "text-primary" : "opacity-60")} />
                {item.label}
              </Link>
            );
          })}

          <div className="px-2 mt-4 mb-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/50 font-semibold">Static Analysis</span>
          </div>
          {navItems.slice(4).map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-150",
                isActive
                  ? "bg-primary/12 text-primary border border-primary/20"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground border border-transparent"
              )}>
                <item.icon className={cn("w-3.5 h-3.5 flex-shrink-0", isActive ? "text-primary" : "opacity-60")} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Connection Status */}
        <div className="p-3 border-t border-border/50">
          <div className={cn(
            "flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-xs font-mono",
            isConnected
              ? "bg-primary/8 border-primary/25 text-primary"
              : "bg-secondary/20 border-border/40 text-muted-foreground"
          )}>
            <div className={cn(
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              isConnected ? "bg-primary animate-pulse shadow-[0_0_6px_var(--color-primary)]" : "bg-muted-foreground/40"
            )} />
            <span className="flex-1 uppercase tracking-wider text-[10px] font-bold">
              {isConnected ? "Device Connected" : "No Device"}
            </span>
            {isConnected && <TerminalSquare className="w-3 h-3 opacity-60" />}
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-background">
        {children}
      </main>
    </div>
  );
}

import { Link, useLocation } from "wouter";
import { Activity, AppWindow, Cpu, TerminalSquare, ShieldAlert, Workflow, FileCode2, ScanSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetFridaStatus, getGetFridaStatusQueryKey } from "@workspace/api-client-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey(), refetchInterval: 5000 }});

  const isConnected = !!status?.connected;

  const navItems = [
    { href: "/", label: "Dashboard", icon: Activity },
    { href: "/processes", label: "Processes", icon: Cpu },
    { href: "/applications", label: "Applications", icon: AppWindow },
    { href: "/sessions", label: "Sessions", icon: Workflow },
    { href: "/scripts", label: "Script Library", icon: FileCode2 },
    { href: "/binary", label: "Binary Analyzer", icon: ScanSearch },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground font-sans selection:bg-primary/30 dark">
      <aside className="w-64 border-r border-border bg-sidebar flex-shrink-0 flex flex-col z-10 shadow-2xl">
        <div className="h-16 flex items-center px-6 border-b border-border/50">
          <ShieldAlert className="w-5 h-5 text-primary mr-3" />
          <h1 className="font-bold tracking-tight text-sidebar-foreground">Frida Analyzer</h1>
        </div>
        <div className="flex-1 py-6 flex flex-col gap-1.5 px-3 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                isActive 
                  ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.1)]" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground border border-transparent"
              )}>
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "opacity-70")} />
                {item.label}
              </Link>
            )
          })}
        </div>
        <div className="p-4 border-t border-border/50">
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-secondary/30 border border-border/50">
            <div className={cn("w-2 h-2 rounded-full", isConnected ? "bg-primary animate-pulse shadow-[0_0_8px_var(--color-primary)]" : "bg-destructive")} />
            <div className="text-xs font-mono tracking-wider font-medium uppercase text-muted-foreground flex-1">
              {isConnected ? "Connected" : "Offline"}
            </div>
            {isConnected && <TerminalSquare className="w-3.5 h-3.5 text-primary opacity-70" />}
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Subtle background glow effect */}
        <div className="absolute top-0 left-0 w-full h-96 bg-primary/5 blur-[100px] pointer-events-none -z-10 rounded-full mix-blend-screen opacity-50" />
        {children}
      </main>
    </div>
  );
}

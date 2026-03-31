import { useState } from "react";
import { useGetFridaStatus, useListApplications, useCreateSession, getGetFridaStatusQueryKey, getListApplicationsQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Rocket, WifiOff, AppWindow, Radio } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Applications() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey() } });
  const isConnected = !!status?.connected;

  const { data: applications, isLoading } = useListApplications({
    query: {
      queryKey: getListApplicationsQueryKey(),
      enabled: isConnected,
    }
  });

  const createSessionMutation = useCreateSession({
    mutation: {
      onSuccess: (session) => {
        toast.success(`Session started: ${session.processName}`);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        setLocation(`/sessions/${session.id}`);
      },
      onError: (err: any) => toast.error(`Failed: ${err.error || err.message}`)
    }
  });

  const filteredApps = applications?.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.identifier.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  if (!isConnected) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="w-12 h-12 rounded-2xl bg-secondary/30 flex items-center justify-center">
          <WifiOff className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-foreground">No Device Connected</p>
          <p className="text-sm text-muted-foreground mt-1">Connect to a Frida server to browse installed applications.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation("/")}>
          Go to Control Panel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border/50">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <AppWindow className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Applications</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                Installed apps on <span className="font-mono text-foreground">{status?.deviceName}</span>
                {applications && <span> · {applications.length} apps</span>}
              </p>
            </div>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or bundle ID…"
              className="pl-9 h-9 bg-secondary/20 border-border/50 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* App Grid */}
      <div className="flex-1 overflow-auto px-8 py-4">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array(16).fill(0).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/20 p-4 space-y-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-8 w-full mt-2" />
              </div>
            ))}
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <AppWindow className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{search ? `No apps matching "${search}"` : "No applications found"}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredApps.map(app => (
              <div
                key={app.identifier}
                className="rounded-xl border border-border/40 bg-card/20 p-4 flex flex-col justify-between hover:border-border/70 hover:bg-card/40 transition-all group"
              >
                <div className="mb-4">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <h3 className="font-semibold text-sm text-foreground truncate leading-tight" title={app.name}>
                      {app.name}
                    </h3>
                    {app.pid && (
                      <div className={cn(
                        "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono flex-shrink-0",
                        "bg-primary/10 text-primary border border-primary/20"
                      )}>
                        <Radio className="w-2 h-2" />
                        {app.pid}
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted-foreground truncate" title={app.identifier}>
                    {app.identifier}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={app.pid ? "secondary" : "default"}
                  className={cn(
                    "w-full h-8 text-xs font-mono",
                    !app.pid && "shadow-sm shadow-primary/20"
                  )}
                  onClick={() => createSessionMutation.mutate({ data: { target: app.identifier, targetType: "identifier" } })}
                  disabled={createSessionMutation.isPending}
                >
                  <Rocket className="w-3 h-3 mr-1.5" />
                  {app.pid ? "Attach" : "Spawn"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

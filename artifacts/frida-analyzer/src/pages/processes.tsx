import { useState } from "react";
import { useGetFridaStatus, useListProcesses, useCreateSession, getGetFridaStatusQueryKey, getListProcessesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Crosshair, WifiOff, Cpu, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function Processes() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey() } });
  const isConnected = !!status?.connected;

  const { data: processes, isLoading, refetch, isFetching } = useListProcesses({
    query: {
      queryKey: getListProcessesQueryKey(),
      enabled: isConnected,
    }
  });

  const createSessionMutation = useCreateSession({
    mutation: {
      onSuccess: (session) => {
        toast.success(`Attached to ${session.processName}`);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        setLocation(`/sessions/${session.id}`);
      },
      onError: (err: any) => toast.error(`Failed to attach: ${err.error || err.message}`)
    }
  });

  const filteredProcesses = processes?.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.pid.toString().includes(search) ||
    (p.identifier && p.identifier.toLowerCase().includes(search.toLowerCase()))
  ) ?? [];

  if (!isConnected) {
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center gap-4 text-center px-8">
        <div className="w-12 h-12 rounded-2xl bg-secondary/30 flex items-center justify-center">
          <WifiOff className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <p className="font-semibold text-foreground">No Device Connected</p>
          <p className="text-sm text-muted-foreground mt-1">Connect to a Frida server first to view running processes.</p>
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
              <Cpu className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Processes</h1>
              <p className="text-muted-foreground text-xs mt-0.5">
                Running processes on <span className="font-mono text-foreground">{status?.deviceName}</span>
                {processes && <span> · {processes.length} total</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name, PID, bundle ID…"
                className="pl-9 h-9 bg-secondary/20 border-border/50 text-sm font-mono"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </div>

      {/* Process Table */}
      <div className="flex-1 overflow-auto px-8 py-4">
        <div className="rounded-xl border border-border/50 overflow-hidden bg-card/20">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/20">
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold w-24">PID</th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Name</th>
                <th className="text-left px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold hidden md:table-cell">Identifier</th>
                <th className="text-right px-4 py-3 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold w-32">Action</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array(12).fill(0).map((_, i) => (
                  <tr key={i} className="border-b border-border/20">
                    <td className="px-4 py-3"><Skeleton className="h-4 w-10" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-4 w-28" /></td>
                    <td className="px-4 py-3 hidden md:table-cell"><Skeleton className="h-4 w-44" /></td>
                    <td className="px-4 py-3"><Skeleton className="h-7 w-20 ml-auto" /></td>
                  </tr>
                ))
              ) : filteredProcesses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-16 text-center text-sm text-muted-foreground">
                    {search ? `No processes matching "${search}"` : "No processes found"}
                  </td>
                </tr>
              ) : (
                filteredProcesses.map(p => (
                  <tr key={p.pid} className="border-b border-border/20 hover:bg-secondary/20 transition-colors group">
                    <td className="px-4 py-2.5 font-mono text-xs text-primary/80">{p.pid}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground hidden md:table-cell">
                      {p.identifier || <span className="opacity-30">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-3 text-xs font-mono border border-transparent group-hover:border-primary/30 group-hover:text-primary group-hover:bg-primary/10 transition-all"
                        onClick={() => createSessionMutation.mutate({ data: { target: p.pid.toString(), targetType: "pid" } })}
                        disabled={createSessionMutation.isPending}
                      >
                        <Crosshair className="w-3 h-3 mr-1.5" />
                        Attach
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

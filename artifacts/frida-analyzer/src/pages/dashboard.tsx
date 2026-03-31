import { useState } from "react";
import {
  useHealthCheck, useGetFridaStatus, useConnectFrida, useDisconnectFrida, useListSessions,
  getGetFridaStatusQueryKey, getListSessionsQueryKey, getHealthCheckQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useLocation } from "wouter";
import {
  Server, Smartphone, Plug, Unplug, Crosshair, Workflow,
  CheckCircle2, XCircle, Clock
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("27042");
  const [, setLocation] = useLocation();

  const { data: health, isLoading: healthLoading } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const { data: status, isLoading: statusLoading } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey(), refetchInterval: 8000 } });
  const { data: sessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey(), enabled: !!status?.connected } });

  const connectMutation = useConnectFrida({
    mutation: {
      onSuccess: () => {
        toast.success("Connected to Frida server");
        queryClient.invalidateQueries({ queryKey: getGetFridaStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      },
      onError: (err: any) => {
        toast.error("Connection failed: " + (err.error || err.message || "Unknown error"));
      }
    }
  });

  const disconnectMutation = useDisconnectFrida({
    mutation: {
      onSuccess: () => {
        toast.success("Disconnected");
        queryClient.invalidateQueries({ queryKey: getGetFridaStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      }
    }
  });

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    connectMutation.mutate({ data: { host, port: parseInt(port, 10) } });
  };

  const apiOnline = health?.status === "ok";
  const deviceConnected = !!status?.connected;

  return (
    <div className="flex-1 overflow-auto p-8 space-y-8">
      {/* Header */}
      <div className="border-b border-border/40 pb-6">
        <h1 className="text-2xl font-bold tracking-tight">Control Panel</h1>
        <p className="text-muted-foreground text-sm mt-1">System status and device connection management.</p>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* API Health */}
        <div className={cn(
          "p-4 rounded-xl border flex items-center gap-4",
          apiOnline ? "bg-primary/5 border-primary/20" : "bg-secondary/20 border-border/40"
        )}>
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            apiOnline ? "bg-primary/15" : "bg-secondary/40"
          )}>
            <Server className={cn("w-4 h-4", apiOnline ? "text-primary" : "text-muted-foreground")} />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">API Server</div>
            {healthLoading ? (
              <Skeleton className="h-4 w-16 mt-1" />
            ) : (
              <div className={cn("text-sm font-bold font-mono mt-0.5", apiOnline ? "text-primary" : "text-muted-foreground")}>
                {apiOnline ? "ONLINE" : "OFFLINE"}
              </div>
            )}
          </div>
          <div className="ml-auto">
            {apiOnline ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>

        {/* Device Status */}
        <div className={cn(
          "p-4 rounded-xl border flex items-center gap-4",
          deviceConnected ? "bg-primary/5 border-primary/20" : "bg-secondary/20 border-border/40"
        )}>
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            deviceConnected ? "bg-primary/15" : "bg-secondary/40"
          )}>
            <Smartphone className={cn("w-4 h-4", deviceConnected ? "text-primary" : "text-muted-foreground")} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Target Device</div>
            {statusLoading ? (
              <Skeleton className="h-4 w-20 mt-1" />
            ) : (
              <div className={cn("text-sm font-bold font-mono mt-0.5 truncate", deviceConnected ? "text-primary" : "text-muted-foreground")}>
                {deviceConnected ? status?.deviceName || "Connected" : "Not Connected"}
              </div>
            )}
          </div>
          <div className="ml-auto">
            {deviceConnected
              ? <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_var(--color-primary)]" />
              : <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />
            }
          </div>
        </div>

        {/* Active Sessions */}
        <div className="p-4 rounded-xl border bg-secondary/20 border-border/40 flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg bg-secondary/40 flex items-center justify-center flex-shrink-0">
            <Workflow className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Sessions</div>
            <div className="text-2xl font-bold font-mono mt-0.5">{sessions?.length ?? 0}</div>
          </div>
          {(sessions?.length ?? 0) > 0 && (
            <button onClick={() => setLocation("/sessions")} className="ml-auto text-xs text-primary hover:underline font-medium">
              View
            </button>
          )}
        </div>
      </div>

      {/* Connection Form / Device Info */}
      <div className="rounded-xl border border-border/50 bg-card/30 overflow-hidden">
        <div className="px-6 py-4 border-b border-border/40 flex items-center gap-3">
          <Crosshair className="w-4 h-4 text-primary" />
          <h2 className="font-semibold text-sm">Device Connection</h2>
          {deviceConnected && (
            <div className="ml-auto flex items-center gap-2 text-xs text-primary font-mono bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {status?.host}:{status?.port}
            </div>
          )}
        </div>
        <div className="p-6">
          {deviceConnected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Device Name", value: status?.deviceName || "—" },
                  { label: "Device Type", value: status?.deviceType || "—" },
                  { label: "Host", value: status?.host || "—" },
                  { label: "Port", value: String(status?.port ?? "—") },
                ].map(({ label, value }) => (
                  <div key={label} className="space-y-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
                    <div className="font-mono text-sm text-foreground">{value}</div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/60"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  <Unplug className="w-3.5 h-3.5 mr-2" />
                  Disconnect
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setLocation("/processes")}>
                  <Crosshair className="w-3.5 h-3.5 mr-2" />
                  Browse Processes
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleConnect} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect to Frida Server running on a jailbroken iOS device. Default port is <span className="font-mono text-foreground">27042</span>.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="space-y-1.5 flex-1">
                  <Label htmlFor="host" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Host / IP</Label>
                  <Input
                    id="host"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="font-mono bg-background/50 border-border/50 h-9"
                    placeholder="192.168.1.100"
                  />
                </div>
                <div className="space-y-1.5 w-28">
                  <Label htmlFor="port" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port</Label>
                  <Input
                    id="port"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="font-mono bg-background/50 border-border/50 h-9"
                    placeholder="27042"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" className="h-9 px-6" disabled={connectMutation.isPending}>
                    <Plug className="w-3.5 h-3.5 mr-2" />
                    {connectMutation.isPending ? "Connecting…" : "Connect"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Sessions Quick View */}
      {deviceConnected && sessions && sessions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Running Sessions
            </h2>
            <button onClick={() => setLocation("/sessions")} className="text-xs text-primary hover:underline">
              View all →
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sessions.map(session => (
              <button
                key={session.id}
                onClick={() => setLocation(`/sessions/${session.id}`)}
                className="text-left p-4 rounded-xl border border-border/50 bg-card/30 hover:border-primary/40 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="font-mono font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                    {session.processName}
                  </span>
                </div>
                <div className="text-xs font-mono text-muted-foreground">PID: {session.pid}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

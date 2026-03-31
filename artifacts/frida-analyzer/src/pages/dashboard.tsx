import { useState } from "react";
import { useHealthCheck, useGetFridaStatus, useConnectFrida, useDisconnectFrida, useListSessions, getGetFridaStatusQueryKey, getListSessionsQueryKey, getHealthCheckQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Server, Smartphone, MonitorPlay, PowerOff, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("27042");

  const { data: health, isLoading: healthLoading } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const { data: status, isLoading: statusLoading } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey() } });
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
        toast.success("Disconnected from Frida server");
        queryClient.invalidateQueries({ queryKey: getGetFridaStatusQueryKey() });
      }
    }
  });

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    connectMutation.mutate({ data: { host, port: parseInt(port, 10) } });
  };

  return (
    <div className="flex-1 overflow-auto p-8 space-y-8 bg-background">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">Cockpit</h1>
        <p className="text-muted-foreground text-lg">System status and Frida connection control.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 border-border/50 bg-card/50 backdrop-blur-sm shadow-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Server className="w-5 h-5 text-primary" />
              API Server
            </CardTitle>
          </CardHeader>
          <CardContent>
            {healthLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <div className="flex items-center gap-4 p-5 rounded-lg bg-secondary/30 border border-border/50">
                <div className={`w-3 h-3 rounded-full ${health?.status === "ok" ? "bg-primary animate-pulse shadow-[0_0_10px_var(--color-primary)]" : "bg-destructive"}`} />
                <div>
                  <div className="font-mono font-medium text-sm text-foreground uppercase tracking-wider">{health?.status === "ok" ? "ONLINE" : "OFFLINE"}</div>
                  <div className="text-xs text-muted-foreground mt-1">Analyzer Core Service</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 lg:col-span-2 border-border/50 bg-card/50 backdrop-blur-sm shadow-xl relative overflow-hidden">
          {status?.connected && <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 blur-2xl rounded-full pointer-events-none -mr-10 -mt-10" />}
          
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Smartphone className="w-5 h-5 text-primary" />
              Target Device
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statusLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : status?.connected ? (
              <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 p-5 rounded-lg border border-primary/30 bg-primary/5 shadow-inner">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <span className="font-semibold text-foreground tracking-wide">Secure Connection Active</span>
                  </div>
                  <div className="text-sm font-mono text-primary/80">
                    {status.deviceName} ({status.deviceType}) <span className="text-muted-foreground px-2">@</span> {status.host}:{status.port}
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-sm text-right hidden md:block">
                    <div className="text-foreground font-mono text-lg font-bold">{sessions?.length || 0}</div>
                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Active Sessions</div>
                  </div>
                  <Button variant="destructive" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending}>
                    <PowerOff className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleConnect} className="grid grid-cols-1 sm:grid-cols-5 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label htmlFor="host" className="text-xs uppercase tracking-wider text-muted-foreground">Host</Label>
                  <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} className="font-mono bg-background/50 border-border/50" />
                </div>
                <div className="sm:col-span-1 space-y-2">
                  <Label htmlFor="port" className="text-xs uppercase tracking-wider text-muted-foreground">Port</Label>
                  <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} className="font-mono bg-background/50 border-border/50" />
                </div>
                <div className="sm:col-span-2 flex items-end">
                  <Button type="submit" className="w-full shadow-lg shadow-primary/20" disabled={connectMutation.isPending}>
                    <MonitorPlay className="w-4 h-4 mr-2" />
                    Attach to Server
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      {status?.connected && sessions && sessions.length > 0 && (
        <div className="space-y-4 pt-6">
          <h2 className="text-xl font-bold tracking-tight border-b border-border/50 pb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary/80"></span>
            Active Telemetry Sessions
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sessions.map(session => (
              <Card key={session.id} className="border-border/50 bg-secondary/10 hover:border-primary/50 transition-colors shadow-md">
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg font-mono truncate text-primary" title={session.processName}>
                    {session.processName}
                  </CardTitle>
                  <CardDescription className="font-mono text-xs mt-1">PID: {session.pid}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center bg-background/50 p-3 rounded-md border border-border/30">
                    <div className="text-xs font-mono text-muted-foreground truncate flex-1 pr-4">Target: {session.target}</div>
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

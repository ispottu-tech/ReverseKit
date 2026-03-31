import { useState } from "react";
import { useGetFridaStatus, useListApplications, useCreateSession, getGetFridaStatusQueryKey, getListApplicationsQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Rocket, AlertTriangle, CheckCircle2, AppWindow } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";

export default function Applications() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey() } });
  const isConnected = !!status?.connected;

  const { data: applications, isLoading } = useListApplications({ 
    query: { 
      queryKey: getListApplicationsQueryKey(),
      enabled: isConnected 
    } 
  });

  const createSessionMutation = useCreateSession({
    mutation: {
      onSuccess: (session) => {
        toast.success(`Spawned/Attached to ${session.processName}`);
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        setLocation(`/sessions/${session.id}`);
      },
      onError: (err: any) => toast.error(`Failed to attach: ${err.error || err.message}`)
    }
  });

  const handleSpawn = (identifier: string) => {
    createSessionMutation.mutate({
      data: { target: identifier, targetType: "identifier" }
    });
  };

  const filteredApps = applications?.filter(a => 
    a.name.toLowerCase().includes(search.toLowerCase()) || 
    a.identifier.toLowerCase().includes(search.toLowerCase())
  ) || [];

  if (!isConnected) {
    return (
      <div className="flex-1 p-6 h-full flex flex-col items-center justify-center">
        <Empty icon={AlertTriangle} title="Not Connected" description="Connect to a Frida server in the Dashboard to view applications." />
        <Button onClick={() => setLocation("/")} className="mt-6">Go to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <div className="p-8 pb-0 flex-shrink-0">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Applications</h1>
            <p className="text-muted-foreground">Installed apps and their bundle identifiers.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search applications..."
              className="pl-10 font-mono text-sm bg-secondary/20 border-border/50 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 pt-2">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {isLoading ? (
            Array(12).fill(0).map((_, i) => (
              <div key={i} className="border border-border/50 bg-card/30 rounded-xl p-5 flex flex-col gap-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <Skeleton className="h-10 w-10 rounded-xl" />
                </div>
                <Skeleton className="h-9 w-full mt-2" />
              </div>
            ))
          ) : filteredApps.length === 0 ? (
             <div className="col-span-full h-48 flex items-center justify-center text-muted-foreground border border-dashed border-border/50 rounded-xl bg-card/10">
                No applications found matching "{search}"
             </div>
          ) : (
            filteredApps.map(app => (
              <div key={app.identifier} className="border border-border/50 bg-card/30 backdrop-blur-sm rounded-xl p-5 flex flex-col justify-between group hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
                <div className="flex items-start justify-between mb-6">
                  <div className="min-w-0 pr-4">
                    <h3 className="font-semibold text-foreground truncate text-lg" title={app.name}>{app.name}</h3>
                    <p className="text-xs font-mono text-muted-foreground truncate mt-1" title={app.identifier}>{app.identifier}</p>
                  </div>
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-secondary/50 flex items-center justify-center border border-border/50">
                    {app.pid ? (
                      <CheckCircle2 className="w-5 h-5 text-primary" title={`Running (PID: ${app.pid})`} />
                    ) : (
                      <AppWindow className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
                <Button 
                  variant={app.pid ? "secondary" : "default"} 
                  className={`w-full font-mono text-xs justify-between transition-colors ${!app.pid ? 'shadow-md shadow-primary/20' : 'group-hover:bg-primary/20 group-hover:text-primary group-hover:border-primary/50 border border-transparent'}`}
                  onClick={() => handleSpawn(app.identifier)}
                  disabled={createSessionMutation.isPending}
                >
                  <span className="flex items-center">
                    <Rocket className="w-3.5 h-3.5 mr-2" />
                    {app.pid ? "Attach to Process" : "Spawn Application"}
                  </span>
                  {app.pid && <span className="opacity-60 bg-background px-2 py-0.5 rounded-md">PID {app.pid}</span>}
                </Button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

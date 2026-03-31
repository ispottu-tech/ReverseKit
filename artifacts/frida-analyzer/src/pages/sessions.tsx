import { useListSessions, useDeleteSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Workflow, Trash2, ArrowRight, Cpu, AppWindow } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Sessions() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useListSessions({
    query: { queryKey: getListSessionsQueryKey(), refetchInterval: 5000 }
  });

  const deleteSessionMutation = useDeleteSession({
    mutation: {
      onSuccess: () => {
        toast.success("Session detached");
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      },
      onError: (err: any) => toast.error(`Failed: ${err.error || err.message}`)
    }
  });

  const handleDetach = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSessionMutation.mutate({ sessionId: id });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Workflow className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Active Sessions</h1>
            <p className="text-muted-foreground text-xs mt-0.5">
              {sessions ? `${sessions.length} active hook session${sessions.length !== 1 ? "s" : ""}` : "Loading…"}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-5">
        {isLoading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-5 text-center border border-dashed border-border/40 rounded-xl">
            <div className="w-14 h-14 rounded-2xl bg-secondary/30 flex items-center justify-center">
              <Workflow className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-semibold text-foreground">No Active Sessions</p>
              <p className="text-sm text-muted-foreground mt-1">Attach to a process or spawn an app to start a session.</p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={() => setLocation("/processes")}>
                <Cpu className="w-3.5 h-3.5 mr-2" />
                Processes
              </Button>
              <Button size="sm" onClick={() => setLocation("/applications")}>
                <AppWindow className="w-3.5 h-3.5 mr-2" />
                Applications
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {sessions.map(session => (
              <div
                key={session.id}
                onClick={() => setLocation(`/sessions/${session.id}`)}
                className={cn(
                  "relative rounded-xl border border-border/50 bg-card/30 p-5 cursor-pointer",
                  "hover:border-primary/40 hover:bg-primary/5 transition-all group overflow-hidden"
                )}
              >
                {/* Active indicator stripe */}
                <div className="absolute top-0 left-0 w-1 h-full bg-primary/70 rounded-l-xl" />

                <div className="pl-3">
                  {/* Process name + status */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-2 w-2 relative flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </div>
                      <span className="font-mono font-bold text-foreground truncate group-hover:text-primary transition-colors">
                        {session.processName}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full flex-shrink-0">
                      LIVE
                    </span>
                  </div>

                  {/* Details */}
                  <div className="grid grid-cols-3 gap-4 mb-4 text-xs bg-black/20 rounded-lg px-4 py-3 border border-white/5">
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">PID</div>
                      <div className="font-mono text-foreground">{session.pid}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Target</div>
                      <div className="font-mono text-foreground truncate">{session.target}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1">Started</div>
                      <div className="font-mono text-foreground">{new Date(session.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-between items-center">
                    <button
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
                      onClick={(e) => handleDetach(e, session.id)}
                      disabled={deleteSessionMutation.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                      Detach
                    </button>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
                      Open Workspace
                      <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

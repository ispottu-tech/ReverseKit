import { useListSessions, useDeleteSession, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Terminal, Trash2, ArrowRight, ActivitySquare, Cpu, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";

export default function Sessions() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useListSessions({ 
    query: { queryKey: getListSessionsQueryKey() } 
  });

  const deleteSessionMutation = useDeleteSession({
    mutation: {
      onSuccess: () => {
        toast.success("Session detached");
        queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      },
      onError: (err: any) => toast.error(`Failed to detach: ${err.error || err.message}`)
    }
  });

  const handleDetach = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSessionMutation.mutate({ sessionId: id });
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <div className="p-8 pb-0 flex-shrink-0 mb-6">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Active Sessions</h1>
        <p className="text-muted-foreground text-lg">Manage ongoing telemetry and hooking sessions.</p>
      </div>

      <div className="flex-1 overflow-auto p-8 pt-0">
        {isLoading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {Array(4).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-xl" />
            ))}
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center border border-dashed border-border/50 rounded-xl bg-card/5 backdrop-blur-sm">
            <Empty icon={ActivitySquare} title="No Active Sessions" description="Attach to a process or spawn an application to begin a session." />
            <div className="flex gap-4 mt-8">
              <Button onClick={() => setLocation("/processes")} variant="outline" className="border-border/60">
                <Cpu className="w-4 h-4 mr-2" />
                Browse Processes
              </Button>
              <Button onClick={() => setLocation("/applications")} className="shadow-lg shadow-primary/20">
                <Workflow className="w-4 h-4 mr-2" />
                Browse Apps
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {sessions.map(session => (
              <Card 
                key={session.id} 
                className="border-border/40 bg-card/30 backdrop-blur-sm hover:border-primary/50 hover:shadow-[0_0_20px_rgba(var(--primary),0.05)] transition-all duration-300 cursor-pointer group flex flex-col rounded-xl overflow-hidden relative"
                onClick={() => setLocation(`/sessions/${session.id}`)}
              >
                <div className="absolute top-0 left-0 w-1 h-full bg-primary/80" />
                <CardHeader className="pl-8 pt-6">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="text-2xl font-mono text-foreground flex items-center gap-3">
                        <Terminal className="w-6 h-6 text-primary" />
                        {session.processName}
                      </CardTitle>
                      <CardDescription className="mt-2 font-mono text-sm flex items-center gap-2">
                        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Target:</span> 
                        <span className="text-primary/80">{session.target}</span>
                        <span className="text-muted-foreground px-1">/</span>
                        <span className="text-muted-foreground">{session.targetType}</span>
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2 bg-primary/10 px-3 py-1.5 rounded-md border border-primary/20">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary shadow-[0_0_8px_var(--color-primary)]"></span>
                      </span>
                      <span className="text-xs font-bold text-primary uppercase tracking-wider">Active</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 pl-8">
                  <div className="grid grid-cols-2 gap-4 text-sm bg-black/20 p-4 rounded-lg border border-white/5">
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1 font-semibold">PID</div>
                      <div className="font-mono text-base">{session.pid}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px] uppercase tracking-wider mb-1 font-semibold">Started</div>
                      <div className="font-mono text-base truncate">{new Date(session.createdAt).toLocaleTimeString()}</div>
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="flex justify-between pt-4 pb-6 pl-8 border-t border-border/20 mt-auto bg-card/20">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-destructive/80 hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 font-mono text-xs"
                    onClick={(e) => handleDetach(e, session.id)}
                    disabled={deleteSessionMutation.isPending}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-2" />
                    Detach
                  </Button>
                  <Button variant="secondary" size="sm" className="font-mono text-xs group-hover:bg-primary group-hover:text-primary-foreground border border-border/50 group-hover:border-primary transition-all duration-300">
                    Enter Workspace
                    <ArrowRight className="w-3.5 h-3.5 ml-2" />
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

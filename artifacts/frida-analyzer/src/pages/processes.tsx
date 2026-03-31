import { useState } from "react";
import { useGetFridaStatus, useListProcesses, useCreateSession, getGetFridaStatusQueryKey, getListProcessesQueryKey, getListSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Terminal, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty } from "@/components/ui/empty";

export default function Processes() {
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey() } });
  const isConnected = !!status?.connected;

  const { data: processes, isLoading } = useListProcesses({ 
    query: { 
      queryKey: getListProcessesQueryKey(),
      enabled: isConnected 
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

  const handleAttach = (pid: number) => {
    createSessionMutation.mutate({
      data: { target: pid.toString(), targetType: "pid" }
    });
  };

  const filteredProcesses = processes?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.pid.toString().includes(search) ||
    (p.identifier && p.identifier.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  if (!isConnected) {
    return (
      <div className="flex-1 p-6 h-full flex flex-col items-center justify-center">
        <Empty icon={AlertTriangle} title="Not Connected" description="Connect to a Frida server in the Dashboard to view processes." />
        <Button onClick={() => setLocation("/")} className="mt-6">Go to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <div className="p-8 pb-0 flex-shrink-0">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Process List</h1>
            <p className="text-muted-foreground">Running processes on the target device.</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, PID, or bundle ID..."
              className="pl-10 font-mono text-sm bg-secondary/20 border-border/50 h-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 pt-2">
        <div className="border border-border/50 rounded-xl bg-card/30 shadow-lg overflow-hidden backdrop-blur-sm">
          <Table>
            <TableHeader className="bg-secondary/40 border-b border-border/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-28 font-mono text-xs uppercase tracking-wider text-muted-foreground pl-6">PID</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Process Name</TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Identifier</TableHead>
                <TableHead className="text-right pr-6 text-xs uppercase tracking-wider text-muted-foreground">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array(10).fill(0).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6"><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                    <TableCell className="text-right pr-6"><Skeleton className="h-8 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredProcesses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-48 text-center text-muted-foreground border-b-0">
                    No processes found matching "{search}"
                  </TableCell>
                </TableRow>
              ) : (
                filteredProcesses.map(p => (
                  <TableRow key={p.pid} className="hover:bg-secondary/20 transition-colors border-border/30">
                    <TableCell className="font-mono text-sm text-primary/80 pl-6">{p.pid}</TableCell>
                    <TableCell className="font-medium text-foreground">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{p.identifier || '-'}</TableCell>
                    <TableCell className="text-right pr-6">
                      <Button 
                        size="sm" 
                        variant="secondary" 
                        className="font-mono text-xs border border-border/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-200"
                        onClick={() => handleAttach(p.pid)}
                        disabled={createSessionMutation.isPending}
                      >
                        <Terminal className="w-3.5 h-3.5 mr-2" />
                        Attach
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

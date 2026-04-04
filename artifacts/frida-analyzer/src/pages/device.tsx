import { useState, useEffect } from "react";
import {
  useHealthCheck, useGetFridaStatus, useConnectFrida, useDisconnectFrida,
  useListProcesses, useListApplications, useListSessions, useCreateSession,
  useDeleteSession, useListClasses, useListMethods, useExecuteScript,
  useListHooks, useCreateHook, useDeleteHook,
  getGetFridaStatusQueryKey, getListSessionsQueryKey, getListProcessesQueryKey,
  getListApplicationsQueryKey, getListClassesQueryKey, getListMethodsQueryKey,
  getListHooksQueryKey, getHealthCheckQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Smartphone, Plug, Unplug, Search, Crosshair, Rocket,
  Cpu, AppWindow, Workflow, Terminal, Trash2, Play,
  Activity, Code2, X, WifiOff, Radio, ChevronRight
} from "lucide-react";

export default function Device() {
  const queryClient = useQueryClient();
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("27042");
  const [processSearch, setProcessSearch] = useState("");
  const [appSearch, setAppSearch] = useState("");
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [scriptCode, setScriptCode] = useState("console.log('Hello from Frida!');");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(classFilter), 300);
    return () => clearTimeout(t);
  }, [classFilter]);

  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const { data: status } = useGetFridaStatus({ query: { queryKey: getGetFridaStatusQueryKey(), refetchInterval: 5000 } });
  const isConnected = !!status?.connected;
  const apiOnline = health?.status === "ok";

  const { data: processes, isLoading: processesLoading } = useListProcesses({ query: { queryKey: getListProcessesQueryKey(), enabled: isConnected } });
  const { data: applications, isLoading: appsLoading } = useListApplications({ query: { queryKey: getListApplicationsQueryKey(), enabled: isConnected } });
  const { data: sessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey(), enabled: isConnected, refetchInterval: 5000 } });

  const { data: classesData, isLoading: classesLoading } = useListClasses(
    activeSession!, debouncedFilter ? { filter: debouncedFilter } : undefined,
    { query: { enabled: !!activeSession, queryKey: getListClassesQueryKey(activeSession!, debouncedFilter ? { filter: debouncedFilter } : undefined) } }
  );
  const { data: methodsData, isLoading: methodsLoading } = useListMethods(
    activeSession!, selectedClass!,
    { query: { enabled: !!activeSession && !!selectedClass, queryKey: getListMethodsQueryKey(activeSession!, selectedClass!) } }
  );
  const { data: hooksData } = useListHooks(activeSession!, { query: { enabled: !!activeSession, queryKey: getListHooksQueryKey(activeSession!) } });

  const connectMut = useConnectFrida({ mutation: {
    onSuccess: () => { toast.success("Connected"); queryClient.invalidateQueries({ queryKey: getGetFridaStatusQueryKey() }); },
    onError: (e: any) => toast.error("Connection failed: " + (e.error || e.message))
  }});
  const disconnectMut = useDisconnectFrida({ mutation: {
    onSuccess: () => { toast.success("Disconnected"); setActiveSession(null); queryClient.invalidateQueries({ queryKey: getGetFridaStatusQueryKey() }); }
  }});
  const createSessionMut = useCreateSession({ mutation: {
    onSuccess: (s) => { toast.success(`Attached to ${s.processName}`); setActiveSession(s.id); queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }); },
    onError: (e: any) => toast.error(`Failed: ${e.error || e.message}`)
  }});
  const deleteSessionMut = useDeleteSession({ mutation: {
    onSuccess: () => { toast.success("Session detached"); if (activeSession) setActiveSession(null); queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() }); },
    onError: (e: any) => toast.error(`Failed: ${e.error || e.message}`)
  }});
  const execScriptMut = useExecuteScript({ mutation: {
    onSuccess: (r) => toast.success(`Executed in ${r.duration}ms`),
    onError: (e: any) => toast.error(`Error: ${e.error || e.message}`)
  }});
  const createHookMut = useCreateHook({ mutation: {
    onSuccess: () => { toast.success("Hook installed"); queryClient.invalidateQueries({ queryKey: getListHooksQueryKey(activeSession!) }); },
    onError: (e: any) => toast.error(`Failed: ${e.error || e.message}`)
  }});
  const deleteHookMut = useDeleteHook({ mutation: {
    onSuccess: () => { toast.success("Hook removed"); queryClient.invalidateQueries({ queryKey: getListHooksQueryKey(activeSession!) }); }
  }});

  const filteredProcesses = processes?.filter(p => p.name.toLowerCase().includes(processSearch.toLowerCase()) || p.pid.toString().includes(processSearch)) ?? [];
  const filteredApps = applications?.filter(a => a.name.toLowerCase().includes(appSearch.toLowerCase()) || a.identifier.toLowerCase().includes(appSearch.toLowerCase())) ?? [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-10 py-6 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-px w-8 bg-violet-400/40" />
              <span className="text-[10px] font-semibold tracking-[0.2em] text-violet-400/60 uppercase">Dynamic Analysis</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Device Manager</h1>
            <p className="text-muted-foreground/60 text-xs mt-1">
              {isConnected
                ? <span>Connected to <span className="font-mono text-foreground">{status?.deviceName}</span> @ {status?.host}:{status?.port}</span>
                : "Connect to a jailbroken iOS device running Frida Server"
              }
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono border", apiOnline ? "border-primary/30 text-primary bg-primary/10" : "border-border/40 text-muted-foreground")}>
              <div className={cn("w-1.5 h-1.5 rounded-full", apiOnline ? "bg-primary animate-pulse" : "bg-muted-foreground/40")} />
              API {apiOnline ? "Online" : "Offline"}
            </div>
            {isConnected && (
              <Button variant="outline" size="sm" className="border-destructive/40 text-destructive/80 hover:bg-destructive/10 text-xs" onClick={() => disconnectMut.mutate()}>
                <Unplug className="w-3 h-3 mr-1.5" /> Disconnect
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {!isConnected ? (
          /* Connection Form */
          <div className="flex items-center justify-center h-full">
            <div className="w-full max-w-md p-8 space-y-6">
              <div className="text-center">
                <WifiOff className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
                <h2 className="text-lg font-bold">Connect to Device</h2>
                <p className="text-sm text-muted-foreground mt-2">
                  Enter the IP address of your jailbroken iOS device running Frida Server.
                  Default Frida port is <span className="font-mono text-foreground">27042</span>.
                </p>
              </div>
              <form onSubmit={e => { e.preventDefault(); connectMut.mutate({ data: { host, port: parseInt(port) } }); }} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Host / IP Address</Label>
                  <Input value={host} onChange={e => setHost(e.target.value)} className="font-mono h-10" placeholder="192.168.1.100" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Port</Label>
                  <Input value={port} onChange={e => setPort(e.target.value)} className="font-mono h-10" placeholder="27042" />
                </div>
                <Button type="submit" className="w-full h-10" disabled={connectMut.isPending}>
                  <Plug className="w-4 h-4 mr-2" />
                  {connectMut.isPending ? "Connecting…" : "Connect to Frida Server"}
                </Button>
              </form>
            </div>
          </div>
        ) : (
          /* Main Tabs */
          <Tabs defaultValue="processes" className="h-full flex flex-col">
            <div className="flex-shrink-0 px-6 pt-3 border-b border-border/40">
              <TabsList className="bg-secondary/20 border border-border/40 h-9">
                <TabsTrigger value="processes" className="text-xs gap-1.5"><Cpu className="w-3 h-3" /> Processes</TabsTrigger>
                <TabsTrigger value="apps" className="text-xs gap-1.5"><AppWindow className="w-3 h-3" /> Apps</TabsTrigger>
                <TabsTrigger value="sessions" className="text-xs gap-1.5"><Workflow className="w-3 h-3" /> Sessions ({sessions?.length ?? 0})</TabsTrigger>
                {activeSession && <TabsTrigger value="workspace" className="text-xs gap-1.5"><Terminal className="w-3 h-3" /> Workspace</TabsTrigger>}
              </TabsList>
            </div>

            <div className="flex-1 overflow-auto">
              {/* Processes */}
              <TabsContent value="processes" className="h-full m-0 p-6">
                <div className="mb-4 relative w-72">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search processes…" className="pl-9 h-9 text-sm font-mono bg-secondary/20" value={processSearch} onChange={e => setProcessSearch(e.target.value)} />
                </div>
                <div className="rounded-xl border border-border/50 overflow-hidden bg-card/20 max-h-[calc(100vh-280px)] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-secondary/40 border-b border-border/50 z-10">
                      <tr>
                        <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold w-20">PID</th>
                        <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Name</th>
                        <th className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hidden md:table-cell">Identifier</th>
                        <th className="w-24" />
                      </tr>
                    </thead>
                    <tbody>
                      {processesLoading ? Array(10).fill(0).map((_, i) => (
                        <tr key={i} className="border-b border-border/20"><td className="px-4 py-2.5"><Skeleton className="h-4 w-10" /></td><td className="px-4 py-2.5"><Skeleton className="h-4 w-28" /></td><td className="px-4 py-2.5 hidden md:table-cell"><Skeleton className="h-4 w-40" /></td><td /></tr>
                      )) : filteredProcesses.map(p => (
                        <tr key={p.pid} className="border-b border-border/20 hover:bg-secondary/20 group">
                          <td className="px-4 py-2 font-mono text-xs text-primary/80">{p.pid}</td>
                          <td className="px-4 py-2 font-medium">{p.name}</td>
                          <td className="px-4 py-2 font-mono text-xs text-muted-foreground hidden md:table-cell">{p.identifier || "—"}</td>
                          <td className="px-4 py-2 text-right">
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => createSessionMut.mutate({ data: { target: p.pid.toString(), targetType: "pid" } })}>
                              <Crosshair className="w-3 h-3 mr-1" /> Attach
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* Apps */}
              <TabsContent value="apps" className="h-full m-0 p-6">
                <div className="mb-4 relative w-72">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input placeholder="Search apps…" className="pl-9 h-9 text-sm bg-secondary/20" value={appSearch} onChange={e => setAppSearch(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 max-h-[calc(100vh-280px)] overflow-auto">
                  {appsLoading ? Array(12).fill(0).map((_, i) => (
                    <div key={i} className="p-4 rounded-xl border border-border/40 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-8 w-full" /></div>
                  )) : filteredApps.map(app => (
                    <div key={app.identifier} className="p-4 rounded-xl border border-border/40 bg-card/20 hover:border-border/70 transition-all">
                      <div className="flex items-start justify-between mb-1.5">
                        <h3 className="font-semibold text-sm truncate" title={app.name}>{app.name}</h3>
                        {app.pid && <span className="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded flex-shrink-0 flex items-center gap-1"><Radio className="w-2 h-2" />{app.pid}</span>}
                      </div>
                      <p className="text-xs font-mono text-muted-foreground truncate mb-3">{app.identifier}</p>
                      <Button size="sm" variant={app.pid ? "secondary" : "default"} className="w-full h-7 text-xs" onClick={() => createSessionMut.mutate({ data: { target: app.identifier, targetType: "identifier" } })}>
                        <Rocket className="w-3 h-3 mr-1" /> {app.pid ? "Attach" : "Spawn"}
                      </Button>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Sessions */}
              <TabsContent value="sessions" className="h-full m-0 p-6">
                {!sessions || sessions.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <Workflow className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No active sessions. Attach to a process or spawn an app to start.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {sessions.map(s => (
                      <div key={s.id} className={cn("p-4 rounded-xl border transition-all cursor-pointer", activeSession === s.id ? "border-primary/50 bg-primary/5" : "border-border/50 bg-card/20 hover:border-border/70")} onClick={() => setActiveSession(s.id)}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            <span className="font-mono font-bold text-sm">{s.processName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-muted-foreground">PID {s.pid}</span>
                            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive/70 hover:text-destructive" onClick={e => { e.stopPropagation(); deleteSessionMut.mutate({ sessionId: s.id }); }}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">{s.target}</span>
                          <ChevronRight className="w-3 h-3" />
                          <span className="text-primary">Open Workspace</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              {/* Workspace */}
              {activeSession && (
                <TabsContent value="workspace" className="h-full m-0 flex flex-col">
                  <Tabs defaultValue="classes" className="flex-1 flex flex-col">
                    <div className="px-6 pt-3">
                      <TabsList className="bg-secondary/20 border border-border/40 h-8">
                        <TabsTrigger value="classes" className="text-xs">Class Browser</TabsTrigger>
                        <TabsTrigger value="hooks" className="text-xs">Hooks ({hooksData?.length ?? 0})</TabsTrigger>
                        <TabsTrigger value="script" className="text-xs">Run Script</TabsTrigger>
                      </TabsList>
                    </div>

                    <div className="flex-1 overflow-hidden p-6">
                      {/* Class Browser */}
                      <TabsContent value="classes" className="h-full m-0">
                        <div className="flex h-full gap-4">
                          <div className="w-1/3 flex flex-col border border-border/50 rounded-xl overflow-hidden bg-card/20">
                            <div className="p-3 border-b border-border/40 space-y-2">
                              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">ObjC Classes</span>
                              <div className="relative">
                                <Search className="absolute left-2.5 top-2 h-3 w-3 text-muted-foreground" />
                                <Input placeholder="Filter…" className="pl-7 h-7 text-xs font-mono" value={classFilter} onChange={e => setClassFilter(e.target.value)} />
                              </div>
                              {classesData && <div className="text-[10px] text-muted-foreground font-mono text-right">{classesData.classes.length} / {classesData.total}</div>}
                            </div>
                            <ScrollArea className="flex-1">
                              <div className="p-1.5 space-y-0.5">
                                {classesLoading ? Array(15).fill(0).map((_, i) => <Skeleton key={i} className="h-7 w-full" />) :
                                  classesData?.classes.map(cls => (
                                    <button key={cls} className={cn("w-full text-left px-2.5 py-1.5 text-[11px] font-mono rounded truncate transition-colors", selectedClass === cls ? "bg-primary/20 text-primary font-bold" : "hover:bg-secondary/40")} onClick={() => setSelectedClass(cls)}>
                                      {cls}
                                    </button>
                                  ))
                                }
                              </div>
                            </ScrollArea>
                          </div>
                          <div className="flex-1 border border-border/50 rounded-xl overflow-hidden bg-card/20 flex flex-col">
                            <div className="p-3 border-b border-border/40">
                              <span className="text-xs font-semibold flex items-center gap-2">
                                <Code2 className="w-3.5 h-3.5 text-primary" />
                                {selectedClass ? <span className="font-mono text-primary/90">{selectedClass}</span> : "Select a class"}
                              </span>
                            </div>
                            <ScrollArea className="flex-1">
                              {!selectedClass ? (
                                <div className="p-8 text-center text-sm text-muted-foreground">Select a class to view its methods</div>
                              ) : methodsLoading ? (
                                <div className="p-4 space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>
                              ) : (
                                <div className="p-3 space-y-4">
                                  {methodsData?.classMethods?.map(m => (
                                    <div key={`c-${m}`} className="flex items-center justify-between group px-3 py-1.5 rounded bg-secondary/20 hover:bg-secondary/40">
                                      <span className="font-mono text-[11px] truncate">+ {m}</span>
                                      <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100 text-primary" onClick={() => createHookMut.mutate({ sessionId: activeSession, data: { className: selectedClass, methodName: m, methodType: "class", logArgs: true, logReturn: true } })}>
                                        <Crosshair className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                  {methodsData?.instanceMethods?.map(m => (
                                    <div key={`i-${m}`} className="flex items-center justify-between group px-3 py-1.5 rounded bg-secondary/20 hover:bg-secondary/40">
                                      <span className="font-mono text-[11px] truncate">- {m}</span>
                                      <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100 text-primary" onClick={() => createHookMut.mutate({ sessionId: activeSession, data: { className: selectedClass, methodName: m, methodType: "instance", logArgs: true, logReturn: true } })}>
                                        <Crosshair className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </ScrollArea>
                          </div>
                        </div>
                      </TabsContent>

                      {/* Hooks */}
                      <TabsContent value="hooks" className="h-full m-0">
                        {!hooksData?.length ? (
                          <div className="text-center py-16 text-muted-foreground text-sm">No hooks installed. Use the Class Browser to hook methods.</div>
                        ) : (
                          <div className="space-y-2">
                            {hooksData.map(h => (
                              <div key={h.id} className="p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center justify-between">
                                <div>
                                  <span className="font-mono text-sm font-bold">{h.className}</span>
                                  <div className="font-mono text-xs text-muted-foreground">{h.methodType === "class" ? "+" : "-"} {h.methodName} · {h.callCount} calls</div>
                                </div>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/70 hover:text-destructive" onClick={() => deleteHookMut.mutate({ sessionId: activeSession, hookId: h.id })}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </TabsContent>

                      {/* Script */}
                      <TabsContent value="script" className="h-full m-0 flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Frida Script</span>
                          <Button size="sm" className="h-7 text-xs" onClick={() => execScriptMut.mutate({ sessionId: activeSession, data: { code: scriptCode } })} disabled={execScriptMut.isPending}>
                            <Play className="w-3 h-3 mr-1.5" /> Execute
                          </Button>
                        </div>
                        <Textarea value={scriptCode} onChange={e => setScriptCode(e.target.value)} className="flex-1 min-h-[200px] font-mono text-xs bg-black/40 resize-none" placeholder="// Frida JavaScript…" />
                        {execScriptMut.data && (
                          <div className="rounded-xl border border-border/50 bg-black/40 p-4 max-h-48 overflow-auto">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"><Activity className="w-3 h-3 text-primary" /> Output ({execScriptMut.data.duration}ms)</span>
                              <button onClick={() => execScriptMut.reset()}><X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" /></button>
                            </div>
                            <div className="font-mono text-xs space-y-0.5">
                              {execScriptMut.data.error ? <span className="text-destructive">{execScriptMut.data.error}</span> :
                                execScriptMut.data.output.length === 0 ? <span className="text-muted-foreground italic">No output</span> :
                                  execScriptMut.data.output.map((l, i) => <div key={i} className="text-primary/90">{l}</div>)
                              }
                            </div>
                          </div>
                        )}
                      </TabsContent>
                    </div>
                  </Tabs>
                </TabsContent>
              )}
            </div>
          </Tabs>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { 
  useListClasses, useListMethods, useExecuteScript, useListHooks, useCreateHook, useDeleteHook,
  getListClassesQueryKey, getListMethodsQueryKey, getListHooksQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Play, X, Trash2, Crosshair, ChevronRight, Activity, TerminalSquare, AlertTriangle, ListFilter, Code2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Empty } from "@/components/ui/empty";

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Class Browser State
  const [classFilter, setClassFilter] = useState("");
  const [debouncedFilter, setDebouncedFilter] = useState("");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);

  // Script Editor State
  const [scriptCode, setScriptCode] = useState("console.log('Hello from Frida!');");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFilter(classFilter), 300);
    return () => clearTimeout(timer);
  }, [classFilter]);

  // Queries
  const { data: classesData, isLoading: classesLoading } = useListClasses(
    sessionId!,
    debouncedFilter ? { filter: debouncedFilter } : undefined,
    { query: { enabled: !!sessionId, queryKey: getListClassesQueryKey(sessionId!, debouncedFilter ? { filter: debouncedFilter } : undefined) } }
  );

  const { data: methodsData, isLoading: methodsLoading } = useListMethods(
    sessionId!,
    selectedClass!,
    { query: { enabled: !!sessionId && !!selectedClass, queryKey: getListMethodsQueryKey(sessionId!, selectedClass!) } }
  );

  const { data: hooksData, isLoading: hooksLoading } = useListHooks(
    sessionId!,
    { query: { enabled: !!sessionId, queryKey: getListHooksQueryKey(sessionId!) } }
  );

  // Mutations
  const executeScriptMutation = useExecuteScript({
    mutation: {
      onSuccess: (result) => {
        toast.success(`Script executed in ${result.duration}ms`);
      },
      onError: (err: any) => {
        toast.error(`Script error: ${err.error || err.message}`);
      }
    }
  });

  const createHookMutation = useCreateHook({
    mutation: {
      onSuccess: () => {
        toast.success("Hook installed successfully");
        queryClient.invalidateQueries({ queryKey: getListHooksQueryKey(sessionId!) });
      },
      onError: (err: any) => {
        toast.error(`Failed to create hook: ${err.error || err.message}`);
      }
    }
  });

  const deleteHookMutation = useDeleteHook({
    mutation: {
      onSuccess: () => {
        toast.success("Hook removed");
        queryClient.invalidateQueries({ queryKey: getListHooksQueryKey(sessionId!) });
      },
      onError: (err: any) => {
        toast.error(`Failed to remove hook: ${err.error || err.message}`);
      }
    }
  });

  const handleExecuteScript = () => {
    executeScriptMutation.mutate({ sessionId: sessionId!, data: { code: scriptCode } });
  };

  const handleAddHook = (methodName: string, methodType: "instance" | "class") => {
    if (!selectedClass) return;
    createHookMutation.mutate({
      sessionId: sessionId!,
      data: {
        className: selectedClass,
        methodName,
        methodType,
        logArgs: true,
        logReturn: true
      }
    });
  };

  const handleRemoveHook = (hookId: string) => {
    deleteHookMutation.mutate({ sessionId: sessionId!, hookId });
  };

  if (!sessionId) return null;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-background">
      <div className="p-6 pb-4 flex-shrink-0 border-b border-border/50 flex justify-between items-center bg-card/30">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <button onClick={() => setLocation('/sessions')} className="hover:text-primary transition-colors">Sessions</button>
            <ChevronRight className="w-3 h-3" />
            <span className="font-mono text-primary/80">{sessionId.split('-')[0]}...</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Session Workspace
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-6">
        <Tabs defaultValue="classes" className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-3 max-w-md bg-secondary/30 border border-border/50">
            <TabsTrigger value="classes" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">Class Browser</TabsTrigger>
            <TabsTrigger value="hooks" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">Active Hooks</TabsTrigger>
            <TabsTrigger value="script" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">Scripting</TabsTrigger>
          </TabsList>

          <div className="flex-1 mt-4 min-h-0 relative">
            <TabsContent value="classes" className="h-full m-0">
              <div className="flex h-full gap-6">
                {/* Classes List */}
                <Card className="flex flex-col w-1/3 h-full border-border/50 shadow-md bg-card/50">
                  <CardHeader className="p-4 pb-2 border-b border-border/50 space-y-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <ListFilter className="w-4 h-4 text-primary" />
                      Objective-C Classes
                    </CardTitle>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Filter classes..."
                        className="pl-8 h-9 text-xs font-mono bg-background"
                        value={classFilter}
                        onChange={(e) => setClassFilter(e.target.value)}
                      />
                    </div>
                    {classesData && (
                      <div className="text-[10px] text-muted-foreground text-right font-mono uppercase">
                        Showing {classesData.classes.length} / {classesData.total}
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="flex-1 p-0 overflow-hidden">
                    <ScrollArea className="h-full">
                      <div className="p-2 space-y-0.5">
                        {classesLoading ? (
                          Array(20).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full rounded" />)
                        ) : classesData?.classes.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">No classes found</div>
                        ) : (
                          classesData?.classes.map(cls => (
                            <button
                              key={cls}
                              className={`w-full text-left px-3 py-2 text-xs font-mono rounded-md transition-colors truncate ${selectedClass === cls ? 'bg-primary/20 text-primary font-bold' : 'hover:bg-secondary/50 text-foreground'}`}
                              onClick={() => setSelectedClass(cls)}
                            >
                              {cls}
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>

                {/* Methods List */}
                <Card className="flex flex-col flex-1 h-full border-border/50 shadow-md bg-card/50">
                  <CardHeader className="p-4 border-b border-border/50">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Code2 className="w-4 h-4 text-primary" />
                        {selectedClass ? <span className="font-mono text-primary/90">{selectedClass}</span> : "Select a class"}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 p-0 overflow-hidden">
                    {!selectedClass ? (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <Empty icon={ListFilter} title="No Class Selected" description="Select a class from the list to view its methods." />
                      </div>
                    ) : methodsLoading ? (
                      <div className="p-4 space-y-2">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    ) : (
                      <ScrollArea className="h-full">
                        <div className="p-4 space-y-6">
                          {methodsData?.classMethods && methodsData.classMethods.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pl-2">Class Methods (+)</h3>
                              <div className="space-y-1.5">
                                {methodsData.classMethods.map(m => (
                                  <div key={`c-${m}`} className="flex items-center justify-between group px-3 py-2 rounded-md bg-secondary/20 hover:bg-secondary/40 border border-transparent hover:border-border/50 transition-all">
                                    <div className="font-mono text-xs text-foreground truncate pr-4">+ {m}</div>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:text-primary hover:bg-primary/20" onClick={() => handleAddHook(m, "class")} title="Hook Method">
                                      <Crosshair className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {methodsData?.instanceMethods && methodsData.instanceMethods.length > 0 && (
                            <div>
                              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 pl-2">Instance Methods (-)</h3>
                              <div className="space-y-1.5">
                                {methodsData.instanceMethods.map(m => (
                                  <div key={`i-${m}`} className="flex items-center justify-between group px-3 py-2 rounded-md bg-secondary/20 hover:bg-secondary/40 border border-transparent hover:border-border/50 transition-all">
                                    <div className="font-mono text-xs text-foreground truncate pr-4">- {m}</div>
                                    <Button size="icon" variant="ghost" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-primary hover:text-primary hover:bg-primary/20" onClick={() => handleAddHook(m, "instance")} title="Hook Method">
                                      <Crosshair className="h-3.5 w-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          {(!methodsData?.classMethods?.length && !methodsData?.instanceMethods?.length) && (
                            <div className="text-center p-8 text-sm text-muted-foreground">No methods found for this class.</div>
                          )}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="hooks" className="h-full m-0">
              <Card className="flex flex-col h-full border-border/50 shadow-md bg-card/50">
                <CardHeader className="p-4 border-b border-border/50">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Crosshair className="w-4 h-4 text-primary" />
                    Active Method Hooks
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex-1 p-0 overflow-auto">
                  {hooksLoading ? (
                    <div className="p-4 space-y-4">
                      <Skeleton className="h-20 w-full" />
                      <Skeleton className="h-20 w-full" />
                    </div>
                  ) : !hooksData || hooksData.length === 0 ? (
                    <div className="h-full flex items-center justify-center">
                      <Empty icon={Crosshair} title="No Active Hooks" description="Find a method in the Class Browser and click the target icon to hook it." />
                    </div>
                  ) : (
                    <div className="p-4 grid grid-cols-1 gap-4">
                      {hooksData.map(hook => (
                        <div key={hook.id} className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 relative overflow-hidden">
                          <div className="absolute top-0 left-0 w-1 h-full bg-primary/80" />
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[10px] uppercase font-bold text-primary tracking-wider bg-primary/10 px-2 py-0.5 rounded">
                                {hook.methodType === 'class' ? 'Class' : 'Instance'}
                              </span>
                              <span className="font-mono text-sm font-bold text-foreground">{hook.className}</span>
                            </div>
                            <div className="font-mono text-xs text-muted-foreground">{hook.methodType === 'class' ? '+' : '-'} {hook.methodName}</div>
                            <div className="flex gap-4 mt-3">
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                <span className="text-xs font-mono">{hook.callCount} calls</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-6 bg-background/50 p-2 px-4 rounded-lg border border-border/50">
                            <div className="flex items-center space-x-2">
                              <Switch id={`args-${hook.id}`} checked={hook.logArgs} disabled />
                              <Label htmlFor={`args-${hook.id}`} className="text-xs">Args</Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <Switch id={`ret-${hook.id}`} checked={hook.logReturn} disabled />
                              <Label htmlFor={`ret-${hook.id}`} className="text-xs">Return</Label>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-destructive/70 hover:text-destructive hover:bg-destructive/10 ml-2"
                              onClick={() => handleRemoveHook(hook.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="script" className="h-full m-0 flex flex-col gap-4">
              <Card className="flex flex-col flex-1 border-border/50 shadow-md bg-card/50">
                <CardHeader className="p-4 border-b border-border/50 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TerminalSquare className="w-4 h-4 text-primary" />
                    Frida Script Editor
                  </CardTitle>
                  <Button 
                    size="sm" 
                    className="shadow-md shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-xs"
                    onClick={handleExecuteScript}
                    disabled={executeScriptMutation.isPending}
                  >
                    <Play className="w-3.5 h-3.5 mr-2" />
                    Execute Payload
                  </Button>
                </CardHeader>
                <CardContent className="flex-1 p-0">
                  <Textarea
                    value={scriptCode}
                    onChange={(e) => setScriptCode(e.target.value)}
                    className="w-full h-full min-h-[300px] font-mono text-sm bg-black/40 border-0 rounded-none resize-none focus-visible:ring-0 p-4"
                    placeholder="// Write your Frida JavaScript here..."
                  />
                </CardContent>
              </Card>

              {executeScriptMutation.data && (
                <Card className="border-border/50 shadow-md bg-black/60">
                  <CardHeader className="p-3 border-b border-border/50 flex flex-row items-center justify-between bg-secondary/10">
                    <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                      <Activity className="w-3.5 h-3.5 text-primary" />
                      Execution Output <span className="lowercase text-primary/70 ml-2">({executeScriptMutation.data.duration}ms)</span>
                    </CardTitle>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => executeScriptMutation.reset()}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-48">
                      <div className="p-4 font-mono text-xs space-y-1">
                        {executeScriptMutation.data.error ? (
                          <div className="text-destructive whitespace-pre-wrap flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            {executeScriptMutation.data.error}
                          </div>
                        ) : executeScriptMutation.data.output.length === 0 ? (
                          <div className="text-muted-foreground italic">No output</div>
                        ) : (
                          executeScriptMutation.data.output.map((line, i) => (
                            <div key={i} className="text-primary/90 break-all">{line}</div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}

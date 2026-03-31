import { useState, useRef, useCallback } from "react";
import {
  Upload, FileSearch, Shield, Code2, Hash, Library,
  AlertTriangle, ChevronDown, ChevronUp, Loader2, X,
  Lock, Cpu, Zap, Eye, Bug, BarChart2, Layers, Key, Download
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]+$/, "") + "/api";

interface RopGadget { addr: string; gadget: string; }
interface Symbol { addr: string; type: string; name: string; }
interface ObjcClass { name: string; methods: string[]; protocols?: string[]; method_count?: number; }
interface MachoArch { cpu: string; file_type: string; flags?: string[]; }
interface MachoInfo {
  type?: string;
  architectures?: MachoArch[];
  objc_classes?: ObjcClass[];
  encrypted?: boolean;
  encryption_details?: object[];
  linked_libraries?: string[];
  load_commands?: string[];
  sections?: Array<{ name: string; size: number; offset: number }>;
  has_code_signature?: boolean;
  error?: string;
}
interface SecurityProps {
  pie?: boolean;
  nx?: boolean;
  canary?: boolean;
  stack_canary?: boolean;
  arc?: boolean;
  relro?: string;
  arch?: string;
  flags?: string[];
  error?: string;
}
interface ObfuscationFinding {
  type: string;
  severity: "critical" | "high" | "medium" | "low";
  note?: string;
  evidence?: string[];
  bypass?: string;
}
interface SecurityFeature { feature: string; evidence: string[]; }
interface FunctionInfo { name: string; addr: string; size: number; }
interface Hashes { md5: string; sha1: string; sha256: string; size: number; }

interface AnalysisResult {
  filename?: string;
  file_info?: string;
  file_size?: number;
  hashes?: Hashes;
  macho?: MachoInfo;
  strings?: string[];
  symbols?: Symbol[];
  imports?: string[];
  disassembly?: string;
  capstone_disasm?: string;
  pseudo_c?: string;
  functions?: FunctionInfo[];
  rop_gadgets?: RopGadget[];
  security_properties?: SecurityProps;
  security_features?: SecurityFeature[];
  obfuscation?: ObfuscationFinding[];
  r2_error?: string;
  error?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function SeverityBadge({ level }: { level: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-orange-500 text-white",
    medium: "bg-yellow-500 text-black",
    low: "bg-blue-500/20 text-blue-300 border border-blue-500/30",
  };
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded", map[level] || "bg-secondary text-muted-foreground")}>
      {level}
    </span>
  );
}

function BoolBadge({ value, trueLabel = "YES", falseLabel = "NO" }: { value?: boolean; trueLabel?: string; falseLabel?: string }) {
  if (value === undefined) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span className={cn("text-xs font-bold px-2 py-0.5 rounded", value ? "bg-emerald-500/20 text-emerald-400" : "bg-secondary/50 text-muted-foreground")}>
      {value ? trueLabel : falseLabel}
    </span>
  );
}

function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = false, accent }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode; defaultOpen?: boolean; accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-secondary/20 hover:bg-secondary/40 transition-colors text-left"
      >
        <Icon className={cn("w-4 h-4 flex-shrink-0", accent || "text-primary")} />
        <span className="font-semibold text-sm flex-1">{title}</span>
        {count !== undefined && (
          <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">{count}</Badge>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

export default function BinaryAnalyzer() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setResult(null);

    const stages = [
      "Uploading binary…",
      "Parsing Mach-O structure (lief)…",
      "Extracting strings & symbols…",
      "Running radare2 analysis…",
      "Scanning ROP gadgets…",
      "Detecting obfuscation & protections…",
    ];
    let si = 0;
    setProgress(stages[0]);
    const interval = setInterval(() => {
      si = Math.min(si + 1, stages.length - 1);
      setProgress(stages[si]);
    }, 4000);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch(`${API_BASE}/binary/analyze`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error || data.details || "Analysis failed");
      else setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      clearInterval(interval);
      setLoading(false);
      setProgress("");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) analyze(file);
  }, [analyze]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyze(file);
  }, [analyze]);

  const hasObfuscation = result?.obfuscation && result.obfuscation.length > 0;
  const criticalFindings = result?.obfuscation?.filter(o => o.severity === "critical" || o.severity === "high") ?? [];

  const exportReport = useCallback(() => {
    if (!result) return;
    const report = {
      _meta: {
        tool: "ReverseKit v1.0",
        generated: new Date().toISOString(),
        engines: ["lief 0.17.6", "capstone 5.0", "radare2 5.9.8", "ROPgadget 7.7", "pwntools 4.15"],
      },
      filename: result.filename,
      file_info: result.file_info,
      file_size: result.file_size,
      hashes: result.hashes,
      macho: result.macho,
      security_properties: result.security_properties,
      security_features: result.security_features,
      obfuscation: result.obfuscation,
      functions: result.functions,
      symbols: result.symbols,
      imports: result.imports,
      strings: result.strings,
      rop_gadgets: result.rop_gadgets,
      disassembly: result.disassembly,
      capstone_disasm: result.capstone_disasm,
      pseudo_c: result.pseudo_c,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(result.filename || "binary").replace(/[^a-zA-Z0-9._-]/g, "_")}_analysis.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Cpu className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Binary Analyzer</h1>
            <p className="text-muted-foreground text-sm">
              Static analysis engine · lief · capstone · radare2 · ROPgadget · pwntools
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-5">
        {/* Upload Zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200 select-none",
            dragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-border/50 hover:border-primary/50 hover:bg-secondary/20",
            loading && "pointer-events-none opacity-70"
          )}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={onFileChange} accept="*" />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
              <p className="text-sm text-primary font-medium">{progress}</p>
              <p className="text-xs text-muted-foreground">Full analysis may take 30–90 seconds…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-10 h-10 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">Drop binary here or click to upload</p>
                <p className="text-sm text-muted-foreground mt-1">.dylib · .framework · .o · .a · .ipa · Mach-O · ELF</p>
              </div>
            </div>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Analysis Failed</p>
              <p className="text-xs mt-1 opacity-80 font-mono break-all">{error}</p>
            </div>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {result && !result.error && (
          <>
            {/* Summary Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "File", value: result.filename || "—", icon: FileSearch },
                { label: "Size", value: formatSize(result.hashes?.size ?? result.file_size ?? 0), icon: BarChart2 },
                { label: "Type", value: result.macho?.type || result.file_info?.split(",")[0]?.slice(0,30) || "—", icon: Layers },
                { label: "Encrypted", value: result.macho?.encrypted ? "⚠ FAIRPLAY" : "✓ Clear", icon: Lock, warn: result.macho?.encrypted },
              ].map(({ label, value, icon: Icon, warn }) => (
                <div key={label} className={cn(
                  "p-4 rounded-lg border",
                  warn ? "bg-destructive/10 border-destructive/40" : "bg-secondary/20 border-border/50"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={cn("w-3.5 h-3.5", warn ? "text-destructive" : "text-primary")} />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
                  </div>
                  <p className={cn("font-mono text-sm font-bold truncate leading-tight", warn ? "text-destructive" : "text-foreground")}>{value}</p>
                </div>
              ))}
            </div>

            {/* Export Button */}
            <div className="flex justify-end">
              <button
                onClick={exportReport}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export Analysis Report (.json)
              </button>
            </div>

            {/* Arch badges */}
            {result.macho?.architectures && result.macho.architectures.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.macho.architectures.map((a, i) => (
                  <Badge key={i} className="font-mono text-xs bg-primary/10 text-primary border-primary/30">
                    {a.cpu} · {a.file_type}
                  </Badge>
                ))}
                {result.macho.has_code_signature && (
                  <Badge className="font-mono text-xs bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    ✓ Code Signed
                  </Badge>
                )}
              </div>
            )}

            {/* FairPlay Warning */}
            {result.macho?.encrypted && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-400 text-sm">FairPlay DRM Encrypted</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Static analysis is severely limited. To decrypt: jailbreak device → use <span className="font-mono text-amber-300">frida-ios-dump</span> or <span className="font-mono text-amber-300">bagbak</span> to dump from memory.
                  </p>
                </div>
              </div>
            )}

            {/* Critical Threat Alert */}
            {criticalFindings.length > 0 && (
              <div className="p-4 rounded-lg bg-red-950/40 border border-red-500/40">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-red-400" />
                  <span className="font-bold text-red-400 text-sm">High-Severity Protections Detected</span>
                </div>
                <div className="space-y-2">
                  {criticalFindings.map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <SeverityBadge level={f.severity} />
                      <div>
                        <span className="text-sm font-medium text-foreground">{f.type}</span>
                        {f.note && <p className="text-xs text-muted-foreground">{f.note}</p>}
                        {f.bypass && <p className="text-xs text-emerald-400 mt-0.5">💡 {f.bypass}</p>}
                        {f.evidence && <p className="text-xs font-mono text-muted-foreground/70">{f.evidence.join(", ")}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Security Properties */}
            {result.security_properties && !result.security_properties.error && (
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-secondary/20 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Binary Hardening (checksec)</span>
                </div>
                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {[
                    { label: "PIE", value: result.security_properties.pie },
                    { label: "NX", value: result.security_properties.nx },
                    { label: "Stack Canary", value: result.security_properties.stack_canary ?? result.security_properties.canary },
                    { label: "ARC", value: result.security_properties.arc },
                    { label: "RELRO", value: result.security_properties.relro ? result.security_properties.relro !== "No RELRO" : undefined },
                  ].map(({ label, value }) => (
                    <div key={label} className="text-center p-3 rounded-lg bg-secondary/30 border border-border/30">
                      <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
                      <BoolBadge value={value} />
                    </div>
                  ))}
                </div>
                {result.security_properties.flags && result.security_properties.flags.length > 0 && (
                  <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {result.security_properties.flags.map((f, i) => (
                      <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary/50 text-muted-foreground">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Hash Section */}
            {result.hashes && (
              <CollapsibleSection title="Cryptographic Hashes" icon={Hash} defaultOpen={false}>
                <div className="space-y-2">
                  {[
                    { label: "MD5", value: result.hashes.md5 },
                    { label: "SHA-1", value: result.hashes.sha1 },
                    { label: "SHA-256", value: result.hashes.sha256 },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center gap-3 p-2 rounded bg-secondary/20">
                      <span className="text-xs font-bold text-muted-foreground w-14 flex-shrink-0">{label}</span>
                      <span className="font-mono text-xs text-green-400 break-all select-all">{value}</span>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Obfuscation Analysis */}
            {hasObfuscation && (
              <CollapsibleSection title="Obfuscation & Protection Analysis" icon={Eye} count={result.obfuscation!.length} defaultOpen={true} accent="text-orange-400">
                <div className="space-y-3">
                  {result.obfuscation!.map((f, i) => (
                    <div key={i} className={cn(
                      "p-3 rounded-lg border",
                      f.severity === "high" || f.severity === "critical" ? "bg-red-950/30 border-red-500/30" :
                      f.severity === "medium" ? "bg-amber-950/30 border-amber-500/30" : "bg-secondary/30 border-border/30"
                    )}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <SeverityBadge level={f.severity} />
                        <span className="font-semibold text-sm text-foreground">{f.type}</span>
                      </div>
                      {f.note && <p className="text-xs text-muted-foreground mt-1">{f.note}</p>}
                      {f.evidence && <p className="text-xs font-mono text-muted-foreground/70 mt-1">Evidence: {f.evidence.join(", ")}</p>}
                      {f.bypass && (
                        <div className="mt-2 text-xs text-emerald-400 bg-emerald-950/30 rounded px-2 py-1 border border-emerald-500/20">
                          💡 Bypass: {f.bypass}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Security Features */}
            {result.security_features && result.security_features.length > 0 && (
              <CollapsibleSection title="Detected Security Features" icon={Key} count={result.security_features.length} defaultOpen={true}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {result.security_features.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-md bg-secondary/30 border border-border/30">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium text-sm">{f.feature}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 font-mono">{f.evidence.join(", ")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Main Analysis Tabs */}
            <Tabs defaultValue="functions">
              <TabsList className="bg-secondary/30 border border-border/50 flex-wrap h-auto gap-1 p-1">
                <TabsTrigger value="functions">Functions ({result.functions?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="objc">ObjC ({result.macho?.objc_classes?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="symbols">Symbols ({result.symbols?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="imports">Imports ({result.imports?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="strings">Strings ({result.strings?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="libs">Libraries</TabsTrigger>
                <TabsTrigger value="rop">ROP ({result.rop_gadgets?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="asm">Disasm</TabsTrigger>
                <TabsTrigger value="pseudoc">Pseudo-C</TabsTrigger>
                <TabsTrigger value="sections">Sections</TabsTrigger>
              </TabsList>

              {/* Functions */}
              <TabsContent value="functions" className="mt-4">
                {result.functions && result.functions.length > 0 ? (
                  <div className="rounded-lg border border-border/50 overflow-hidden">
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="w-full text-xs font-mono">
                        <thead className="sticky top-0 bg-secondary/60 border-b border-border/50 backdrop-blur">
                          <tr>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Address</th>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Size</th>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Name</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.functions.map((fn, i) => (
                            <tr key={i} className="border-b border-border/20 hover:bg-secondary/20">
                              <td className="px-3 py-1.5 text-primary/90 font-mono">{fn.addr}</td>
                              <td className="px-3 py-1.5 text-amber-500">{fn.size}B</td>
                              <td className="px-3 py-1.5 text-foreground break-all">{fn.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-8">
                    {result.r2_error ? `Radare2 error: ${result.r2_error}` : "No functions found"}
                  </p>
                )}
              </TabsContent>

              {/* ObjC Classes */}
              <TabsContent value="objc" className="mt-4">
                {result.macho?.objc_classes && result.macho.objc_classes.length > 0 ? (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {result.macho.objc_classes.map((cls, i) => (
                      <CollapsibleSection key={i} title={cls.name} icon={Code2}
                        count={cls.method_count ?? cls.methods.length}>
                        <div className="space-y-0.5">
                          {cls.protocols && cls.protocols.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {cls.protocols.map((p, j) => (
                                <span key={j} className="text-[10px] font-mono px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">&lt;{p}&gt;</span>
                              ))}
                            </div>
                          )}
                          {cls.methods.map((m, j) => (
                            <p key={j} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-secondary/30">
                              {m}
                            </p>
                          ))}
                        </div>
                      </CollapsibleSection>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-8">No Objective-C classes found</p>
                )}
              </TabsContent>

              {/* Symbols */}
              <TabsContent value="symbols" className="mt-4">
                <div className="max-h-[500px] overflow-y-auto rounded-lg border border-border/50 bg-black/20">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-secondary/60 border-b border-border/50 backdrop-blur">
                      <tr>
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Address</th>
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Type</th>
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium">Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(result.symbols || []).map((s, i) => (
                        <tr key={i} className="border-b border-border/20 hover:bg-secondary/20">
                          <td className="px-3 py-1.5 text-primary/80">{s.addr}</td>
                          <td className="px-3 py-1.5 text-amber-500">{s.type}</td>
                          <td className="px-3 py-1.5 text-foreground break-all">{s.name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              {/* Imports */}
              <TabsContent value="imports" className="mt-4">
                <div className="max-h-[500px] overflow-y-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                  {(result.imports || []).map((imp, i) => (
                    <div key={i} className="px-3 py-2 rounded bg-secondary/20 border border-border/30 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors truncate" title={imp}>
                      {imp}
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Strings */}
              <TabsContent value="strings" className="mt-4">
                <div className="max-h-[500px] overflow-y-auto space-y-0.5 rounded-lg border border-border/50 p-3 bg-black/20">
                  {(result.strings || []).map((s, i) => (
                    <p key={i} className="text-xs font-mono text-green-400/80 hover:text-green-300 transition-colors py-0.5 px-2 hover:bg-secondary/20 rounded break-all select-all">
                      {s}
                    </p>
                  ))}
                </div>
              </TabsContent>

              {/* Libraries */}
              <TabsContent value="libs" className="mt-4">
                <div className="space-y-1.5">
                  {(result.macho?.linked_libraries || []).map((lib, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-secondary/20 border border-border/30">
                      <Library className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="font-mono text-sm text-foreground">{lib}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* ROP Gadgets */}
              <TabsContent value="rop" className="mt-4">
                {result.rop_gadgets && result.rop_gadgets.length > 0 ? (
                  <div className="rounded-lg border border-border/50 overflow-hidden">
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="w-full text-xs font-mono">
                        <thead className="sticky top-0 bg-secondary/60 border-b border-border/50 backdrop-blur">
                          <tr>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Address</th>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Gadget</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.rop_gadgets.map((g, i) => (
                            <tr key={i} className="border-b border-border/20 hover:bg-secondary/20">
                              <td className="px-3 py-1.5 text-primary/90 whitespace-nowrap">{g.addr}</td>
                              <td className="px-3 py-1.5 text-cyan-400/80 break-all">{g.gadget}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-8">No ROP gadgets found</p>
                )}
              </TabsContent>

              {/* Disassembly */}
              <TabsContent value="asm" className="mt-4">
                <div className="space-y-3">
                  {result.capstone_disasm && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium flex items-center gap-1.5">
                        <Bug className="w-3 h-3" /> Capstone ARM64 Disassembly (__text)
                      </p>
                      <pre className="max-h-[300px] overflow-auto text-xs font-mono text-emerald-400/90 bg-black/40 rounded-lg p-4 border border-border/50 leading-relaxed whitespace-pre">
                        {result.capstone_disasm}
                      </pre>
                    </div>
                  )}
                  {result.disassembly && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2 font-medium flex items-center gap-1.5">
                        <Code2 className="w-3 h-3" /> llvm-objdump
                      </p>
                      <pre className="max-h-[300px] overflow-auto text-xs font-mono text-green-400/80 bg-black/40 rounded-lg p-4 border border-border/50 leading-relaxed whitespace-pre-wrap break-all">
                        {result.disassembly}
                      </pre>
                    </div>
                  )}
                  {!result.capstone_disasm && !result.disassembly && (
                    <p className="text-muted-foreground text-sm text-center py-8">No disassembly available</p>
                  )}
                </div>
              </TabsContent>

              {/* Pseudo-C */}
              <TabsContent value="pseudoc" className="mt-4">
                <pre className="max-h-[600px] overflow-auto text-xs font-mono text-cyan-400/90 bg-black/40 rounded-lg p-4 border border-border/50 leading-relaxed whitespace-pre-wrap break-all">
                  {result.pseudo_c || "No pseudo-C decompilation available"}
                </pre>
              </TabsContent>

              {/* Sections */}
              <TabsContent value="sections" className="mt-4">
                {result.macho?.sections && result.macho.sections.length > 0 ? (
                  <div className="rounded-lg border border-border/50 overflow-hidden">
                    <div className="max-h-[500px] overflow-y-auto">
                      <table className="w-full text-xs font-mono">
                        <thead className="sticky top-0 bg-secondary/60 border-b border-border/50 backdrop-blur">
                          <tr>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Section</th>
                            <th className="text-left px-3 py-2 text-muted-foreground font-medium">Offset</th>
                            <th className="text-right px-3 py-2 text-muted-foreground font-medium">Size</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.macho.sections.map((sec, i) => (
                            <tr key={i} className="border-b border-border/20 hover:bg-secondary/20">
                              <td className="px-3 py-1.5 text-primary font-bold">{sec.name}</td>
                              <td className="px-3 py-1.5 text-muted-foreground">0x{sec.offset.toString(16).padStart(8, "0")}</td>
                              <td className="px-3 py-1.5 text-amber-500 text-right">{formatSize(sec.size)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-8">No section info available</p>
                )}
              </TabsContent>
            </Tabs>

            {/* Raw File Info */}
            <CollapsibleSection title="Raw file(1) Output" icon={FileSearch}>
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{result.file_info}</pre>
            </CollapsibleSection>

            {/* Load Commands */}
            {result.macho?.load_commands && result.macho.load_commands.length > 0 && (
              <CollapsibleSection title="Mach-O Load Commands" icon={Layers} count={result.macho.load_commands.length}>
                <div className="flex flex-wrap gap-1.5">
                  {result.macho.load_commands.map((lc, i) => (
                    <span key={i} className="text-xs font-mono px-2 py-0.5 rounded bg-secondary/50 text-muted-foreground border border-border/30">{lc}</span>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}

        {result?.error && (
          <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive font-mono text-sm">
            {result.error}
          </div>
        )}
      </div>
    </div>
  );
}

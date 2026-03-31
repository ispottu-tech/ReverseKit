import { useState, useRef, useCallback } from "react";
import { Upload, FileSearch, Shield, Code2, Hash, Library, AlertTriangle, ChevronDown, ChevronUp, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]+$/, "") + "/api";

interface AnalysisResult {
  filename?: string;
  file_info?: string;
  file_size?: number;
  macho?: {
    type?: string;
    architectures?: Array<{ cpu_type: string; file_type: string; flags?: string[] }>;
    objc_classes?: Array<{ name: string; methods: string[] }>;
    encrypted?: boolean;
    linked_libraries?: string[];
    error?: string;
  };
  strings?: string[];
  symbols?: Array<{ addr: string; type: string; name: string }>;
  imports?: string[];
  linked_libraries?: string[];
  sections?: string[];
  disassembly?: string;
  r2_analysis?: string;
  pseudo_c?: string;
  security_features?: Array<{ feature: string; evidence: string[] }>;
  error?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function CollapsibleSection({ title, icon: Icon, count, children, defaultOpen = false }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-secondary/20 hover:bg-secondary/40 transition-colors text-left"
      >
        <Icon className="w-4 h-4 text-primary flex-shrink-0" />
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
    setProgress("Uploading binary...");

    const form = new FormData();
    form.append("file", file);

    try {
      setProgress("Running analysis tools (strings, nm, objdump, radare2, lief)...");
      const res = await fetch(`${API_BASE}/binary/analyze`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || data.details || "Analysis failed");
      } else {
        setResult(data);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
      setProgress("");
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) analyze(file);
  }, [analyze]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) analyze(file);
  }, [analyze]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-8 py-6 border-b border-border/50">
        <h1 className="text-3xl font-bold text-foreground tracking-tight">Binary Analyzer</h1>
        <p className="text-muted-foreground mt-1">
          Upload any .dylib, .framework, or iOS binary for full static analysis.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Upload Zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 select-none",
            dragging ? "border-primary bg-primary/10 scale-[1.01]" : "border-border/50 hover:border-primary/50 hover:bg-secondary/20",
            loading && "pointer-events-none opacity-70"
          )}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={onFileChange} accept=".dylib,.framework,.o,.a,.ipa,.macho,*" />
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-12 h-12 text-primary animate-spin" />
              <p className="text-sm text-primary font-medium">{progress}</p>
              <p className="text-xs text-muted-foreground">This may take 30-60 seconds...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <Upload className="w-12 h-12 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">Drop binary here or click to upload</p>
                <p className="text-sm text-muted-foreground mt-1">.dylib · .framework · .o · .a · .ipa · any Mach-O</p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-sm">Analysis Failed</p>
              <p className="text-xs mt-1 opacity-80 font-mono">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </div>
        )}

        {result && !result.error && (
          <>
            {/* Summary Card */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "File", value: result.filename || "Unknown", icon: FileSearch },
                { label: "Size", value: formatSize(result.file_size || 0), icon: Hash },
                { label: "Type", value: result.macho?.type || "Unknown", icon: Library },
                { label: "Encrypted", value: result.macho?.encrypted ? "⚠ YES" : "✓ No", icon: Shield, warn: result.macho?.encrypted },
              ].map(({ label, value, icon: Icon, warn }) => (
                <div key={label} className={cn(
                  "p-4 rounded-lg border",
                  warn ? "bg-destructive/10 border-destructive/30" : "bg-secondary/20 border-border/50"
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={cn("w-4 h-4", warn ? "text-destructive" : "text-primary")} />
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">{label}</span>
                  </div>
                  <p className={cn("font-mono text-sm font-bold truncate", warn ? "text-destructive" : "text-foreground")}>{value}</p>
                </div>
              ))}
            </div>

            {/* Architectures */}
            {result.macho?.architectures && result.macho.architectures.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.macho.architectures.map((a, i) => (
                  <Badge key={i} className="font-mono bg-primary/10 text-primary border-primary/30">
                    {a.cpu_type} · {a.file_type}
                  </Badge>
                ))}
              </div>
            )}

            {/* Encryption Warning */}
            {result.macho?.encrypted && (
              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-400 text-sm">FairPlay Encrypted Binary</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This binary is encrypted with FairPlay (App Store DRM). Static analysis is limited.
                    Use Frida to dump the decrypted binary from device memory.
                  </p>
                </div>
              </div>
            )}

            {/* Security Features */}
            {result.security_features && result.security_features.length > 0 && (
              <div className="border border-border/50 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-secondary/20 flex items-center gap-3">
                  <Shield className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Detected Security Features</span>
                  <Badge variant="outline" className="text-xs font-mono border-primary/30 text-primary">{result.security_features.length}</Badge>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
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
              </div>
            )}

            {/* Tabs for detailed results */}
            <Tabs defaultValue="objc">
              <TabsList className="bg-secondary/30 border border-border/50">
                <TabsTrigger value="objc">ObjC Classes</TabsTrigger>
                <TabsTrigger value="symbols">Symbols</TabsTrigger>
                <TabsTrigger value="imports">Imports</TabsTrigger>
                <TabsTrigger value="strings">Strings</TabsTrigger>
                <TabsTrigger value="libs">Libraries</TabsTrigger>
                <TabsTrigger value="asm">Disassembly</TabsTrigger>
                <TabsTrigger value="pseudoc">Pseudo-C</TabsTrigger>
              </TabsList>

              {/* ObjC Classes */}
              <TabsContent value="objc" className="mt-4">
                {result.macho?.objc_classes && result.macho.objc_classes.length > 0 ? (
                  <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                    {result.macho.objc_classes.map((cls, i) => (
                      <CollapsibleSection key={i} title={cls.name} icon={Code2} count={cls.methods.length}>
                        <div className="space-y-1">
                          {cls.methods.map((m, j) => (
                            <p key={j} className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-secondary/30">
                              - {m}
                            </p>
                          ))}
                        </div>
                      </CollapsibleSection>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm text-center py-8">No ObjC classes found</p>
                )}
              </TabsContent>

              {/* Symbols */}
              <TabsContent value="symbols" className="mt-4">
                <div className="max-h-[500px] overflow-y-auto rounded-lg border border-border/50 bg-black/20">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-secondary/50 border-b border-border/50">
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
                <div className="max-h-[500px] overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {(result.imports || []).map((imp, i) => (
                    <div key={i} className="px-3 py-2 rounded bg-secondary/20 border border-border/30 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors">
                      {imp}
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Strings */}
              <TabsContent value="strings" className="mt-4">
                <div className="max-h-[500px] overflow-y-auto space-y-1 rounded-lg border border-border/50 p-3 bg-black/20">
                  {(result.strings || []).map((s, i) => (
                    <p key={i} className="text-xs font-mono text-green-400/80 hover:text-green-300 transition-colors py-0.5 px-2 hover:bg-secondary/20 rounded break-all">
                      {s}
                    </p>
                  ))}
                </div>
              </TabsContent>

              {/* Libraries */}
              <TabsContent value="libs" className="mt-4">
                <div className="space-y-2">
                  {(result.macho?.linked_libraries || result.linked_libraries || []).map((lib, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-secondary/20 border border-border/30">
                      <Library className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="font-mono text-sm text-foreground">{lib}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>

              {/* Disassembly */}
              <TabsContent value="asm" className="mt-4">
                <pre className="max-h-[500px] overflow-auto text-xs font-mono text-green-400/90 bg-black/40 rounded-lg p-4 border border-border/50 leading-relaxed whitespace-pre-wrap break-all">
                  {result.disassembly || result.r2_analysis || "No disassembly available"}
                </pre>
              </TabsContent>

              {/* Pseudo-C */}
              <TabsContent value="pseudoc" className="mt-4">
                <pre className="max-h-[500px] overflow-auto text-xs font-mono text-cyan-400/90 bg-black/40 rounded-lg p-4 border border-border/50 leading-relaxed whitespace-pre-wrap break-all">
                  {result.pseudo_c || "No pseudo-C available"}
                </pre>
              </TabsContent>
            </Tabs>

            {/* File Info */}
            <CollapsibleSection title="Raw File Info" icon={FileSearch}>
              <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">{result.file_info}</pre>
            </CollapsibleSection>
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

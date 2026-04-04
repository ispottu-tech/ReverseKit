import { useState, useRef, useCallback } from "react";
import { Upload, Loader2, X, ArrowLeftRight, Plus, Minus, RefreshCw, Shield, Globe, Eye, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]+$/, "") + "/api";

export default function BinaryDiff() {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);

  const runDiff = useCallback(async () => {
    if (!file1 || !file2) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);

    try {
      const res = await fetch(`${API_BASE}/binary/diff`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Diff failed");
      setResult(data);
    } catch (err: any) {
      setError(err.message || "Failed to compare binaries");
    } finally {
      setLoading(false);
    }
  }, [file1, file2]);

  const DropZone = ({ label, file, setFile, inputRef, color }: { label: string; file: File | null; setFile: (f: File | null) => void; inputRef: any; color: string }) => (
    <div
      className={cn(
        "flex-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all",
        file ? `border-${color}-500/40 bg-${color}-500/5` : "border-border/50 hover:border-primary/40 hover:bg-secondary/30"
      )}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
    >
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
      {file ? (
        <div className="space-y-2">
          <div className={`text-xs font-semibold text-${color}-400 uppercase`}>{label}</div>
          <div className="text-sm font-mono text-foreground truncate">{file.name}</div>
          <div className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</div>
          <button onClick={(e) => { e.stopPropagation(); setFile(null); }} className="text-[10px] text-red-400 hover:text-red-300">
            <X className="w-3 h-3 inline mr-1" />Remove
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <Upload className="w-8 h-8 mx-auto text-muted-foreground/40" />
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-[10px] text-muted-foreground/50">Drop or click to select</div>
        </div>
      )}
    </div>
  );

  const DiffBadge = ({ added, removed, label }: { added: number; removed: number; label: string }) => (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-secondary/20 border border-border/30">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-emerald-400 font-mono">+{added}</span>
      <span className="text-xs text-red-400 font-mono">-{removed}</span>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Binary Diff</h1>
        <p className="text-sm text-muted-foreground mt-1">Compare two iOS binaries — find what changed between versions</p>
        <p className="text-xs text-muted-foreground/60 mt-0.5">Supports: .dylib, .ipa, .deb, .zip, Mach-O executables — auto-extracts binaries from archives</p>
      </div>

      <div className="flex gap-4 items-stretch">
        <DropZone label="Old Version" file={file1} setFile={setFile1} inputRef={ref1} color="blue" />
        <div className="flex items-center">
          <ArrowLeftRight className="w-6 h-6 text-muted-foreground/40" />
        </div>
        <DropZone label="New Version" file={file2} setFile={setFile2} inputRef={ref2} color="emerald" />
      </div>

      <button
        onClick={runDiff}
        disabled={!file1 || !file2 || loading}
        className={cn(
          "w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2",
          file1 && file2 && !loading
            ? "bg-primary text-primary-foreground hover:opacity-90"
            : "bg-secondary/50 text-muted-foreground cursor-not-allowed"
        )}
      >
        {loading ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Comparing...</>
        ) : (
          <><RefreshCw className="w-4 h-4" /> Compare Binaries</>
        )}
      </button>

      {error && (
        <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">{error}</div>
      )}

      {result && (
        <div className="space-y-6">
          {result.identical ? (
            <div className="p-6 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center">
              <p className="text-emerald-400 font-semibold text-lg">Files are identical</p>
              <p className="text-xs text-muted-foreground mt-1">SHA-256: {result.file1?.sha256?.substring(0, 16)}...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/20">
                  <div className="text-[10px] text-blue-400 uppercase font-semibold mb-1">Old</div>
                  <div className="text-sm font-mono truncate">{result.file1?.name}</div>
                  {result.file1?.extracted_binary && (
                    <div className="text-[10px] text-blue-300/60 font-mono truncate">Extracted: {result.file1.extracted_binary}</div>
                  )}
                  <div className="text-xs text-muted-foreground">{(result.file1?.size / 1024).toFixed(1)} KB</div>
                </div>
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                  <div className="text-[10px] text-emerald-400 uppercase font-semibold mb-1">New</div>
                  <div className="text-sm font-mono truncate">{result.file2?.name}</div>
                  {result.file2?.extracted_binary && (
                    <div className="text-[10px] text-emerald-300/60 font-mono truncate">Extracted: {result.file2.extracted_binary}</div>
                  )}
                  <div className="text-xs text-muted-foreground">{(result.file2?.size / 1024).toFixed(1)} KB</div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-secondary/20 border border-border/30 text-center">
                <span className={cn("text-sm font-semibold", result.size_diff > 0 ? "text-emerald-400" : result.size_diff < 0 ? "text-red-400" : "text-muted-foreground")}>
                  Size: {result.size_diff > 0 ? "+" : ""}{result.size_diff} bytes ({result.size_diff_pct > 0 ? "+" : ""}{result.size_diff_pct}%)
                </span>
                <p className="text-xs text-muted-foreground mt-1">{result.summary}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {result.classes && <DiffBadge added={result.classes.added_count} removed={result.classes.removed_count} label="Classes" />}
                {result.symbols && <DiffBadge added={result.symbols.added_count} removed={result.symbols.removed_count} label="Symbols" />}
                {result.strings && <DiffBadge added={result.strings.added_count} removed={result.strings.removed_count} label="Strings" />}
              </div>

              {/* Security Assessment Panel */}
              {result.security && (
                <div className={cn(
                  "p-4 rounded-xl border-2",
                  result.security.risk_level === "critical" ? "bg-red-500/5 border-red-500/30" :
                  result.security.risk_level === "high" ? "bg-orange-500/5 border-orange-500/30" :
                  result.security.risk_level === "medium" ? "bg-amber-500/5 border-amber-500/30" :
                  result.security.risk_level === "low" ? "bg-blue-500/5 border-blue-500/30" :
                  "bg-emerald-500/5 border-emerald-500/30"
                )}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Security Assessment
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded-full uppercase",
                        result.security.risk_level === "critical" ? "bg-red-500/20 text-red-400" :
                        result.security.risk_level === "high" ? "bg-orange-500/20 text-orange-400" :
                        result.security.risk_level === "medium" ? "bg-amber-500/20 text-amber-400" :
                        result.security.risk_level === "low" ? "bg-blue-500/20 text-blue-400" :
                        "bg-emerald-500/20 text-emerald-400"
                      )}>
                        {result.security.risk_level} risk
                      </span>
                      <span className="text-xs text-muted-foreground">{result.security.risk_score}/100</span>
                    </div>
                  </div>
                  {result.security.findings?.length > 0 ? (
                    <div className="space-y-1.5">
                      {result.security.findings.map((f: any, i: number) => (
                        <div key={i} className={cn(
                          "flex items-start gap-2 p-2.5 rounded-lg text-xs border",
                          f.severity === "critical" ? "bg-red-500/5 border-red-500/20" :
                          f.severity === "warning" ? "bg-amber-500/5 border-amber-500/20" :
                          "bg-primary/5 border-primary/20"
                        )}>
                          {f.severity === "critical" ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 shrink-0" /> :
                           f.severity === "warning" ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" /> :
                           f.type === "improvement" ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" /> :
                           <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />}
                          <div>
                            <div className={cn(
                              "font-semibold",
                              f.severity === "critical" ? "text-red-400" :
                              f.severity === "warning" ? "text-amber-400" :
                              f.type === "improvement" ? "text-emerald-400" : "text-primary"
                            )}>{f.title}</div>
                            <div className="text-muted-foreground mt-0.5">{f.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-400 flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5" />
                      No security regressions detected
                    </div>
                  )}
                </div>
              )}

              {/* Privacy Impact Panel */}
              {result.privacy && (
                <div className={cn(
                  "p-4 rounded-xl border-2",
                  result.privacy.risk_level === "critical" ? "bg-red-500/5 border-red-500/30" :
                  result.privacy.risk_level === "high" ? "bg-orange-500/5 border-orange-500/30" :
                  result.privacy.risk_level === "medium" ? "bg-amber-500/5 border-amber-500/30" :
                  result.privacy.risk_level === "low" ? "bg-blue-500/5 border-blue-500/30" :
                  "bg-emerald-500/5 border-emerald-500/30"
                )}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <Eye className="w-4 h-4" />
                      Privacy Impact
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-bold px-2 py-1 rounded-full uppercase",
                        result.privacy.risk_level === "critical" ? "bg-red-500/20 text-red-400" :
                        result.privacy.risk_level === "high" ? "bg-orange-500/20 text-orange-400" :
                        result.privacy.risk_level === "medium" ? "bg-amber-500/20 text-amber-400" :
                        result.privacy.risk_level === "low" ? "bg-blue-500/20 text-blue-400" :
                        "bg-emerald-500/20 text-emerald-400"
                      )}>
                        {result.privacy.risk_level}
                      </span>
                      <span className="text-xs text-muted-foreground">{result.privacy.risk_score}/100</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {result.privacy.data_access_added?.map((da: any, i: number) => (
                      <div key={`da${i}`} className="flex items-center gap-2 text-xs p-2 rounded bg-amber-500/5 border border-amber-500/15">
                        <Plus className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="text-amber-400 font-semibold">{da.framework}</span>
                        <span className="text-muted-foreground">{da.description}</span>
                        <span className={cn("ml-auto text-[10px] px-1.5 py-0.5 rounded-full",
                          da.risk === "high" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                        )}>{da.risk}</span>
                      </div>
                    ))}
                    {result.privacy.data_access_removed?.map((da: any, i: number) => (
                      <div key={`dr${i}`} className="flex items-center gap-2 text-xs p-2 rounded bg-emerald-500/5 border border-emerald-500/15">
                        <Minus className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-semibold">{da.framework}</span>
                        <span className="text-muted-foreground">{da.description}</span>
                      </div>
                    ))}
                    {result.privacy.trackers_added?.map((t: any, i: number) => (
                      <div key={`ta${i}`} className="flex items-center gap-2 text-xs p-2 rounded bg-red-500/5 border border-red-500/15">
                        <Plus className="w-3 h-3 text-red-400 shrink-0" />
                        <span className="text-red-400 font-semibold">{t.sdk}</span>
                        <span className="text-muted-foreground">{t.description}</span>
                      </div>
                    ))}
                    {result.privacy.trackers_removed?.map((t: any, i: number) => (
                      <div key={`tr${i}`} className="flex items-center gap-2 text-xs p-2 rounded bg-emerald-500/5 border border-emerald-500/15">
                        <Minus className="w-3 h-3 text-emerald-400 shrink-0" />
                        <span className="text-emerald-400 font-semibold">{t.sdk}</span>
                        <span className="text-muted-foreground">{t.description}</span>
                      </div>
                    ))}
                    {result.privacy.privacy_flags?.map((f: string, i: number) => (
                      <div key={`pf${i}`} className="flex items-center gap-2 text-xs p-2 rounded bg-amber-500/5 border border-amber-500/15">
                        <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span className="text-amber-300">{f}</span>
                      </div>
                    ))}
                    {!result.privacy.data_access_added?.length && !result.privacy.trackers_added?.length && !result.privacy.privacy_flags?.length && !result.privacy.data_access_removed?.length && !result.privacy.trackers_removed?.length && (
                      <div className="text-xs text-emerald-400 flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5" />
                        No significant privacy changes detected
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Network Footprint Panel */}
              {result.network && (result.network.urls?.added?.length > 0 || result.network.urls?.removed?.length > 0 || result.network.domains?.added?.length > 0 || result.network.domains?.removed?.length > 0) && (
                <div className="p-4 rounded-xl bg-secondary/5 border-2 border-border/30">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                    <Globe className="w-4 h-4" />
                    Network Footprint
                    <span className="text-xs text-muted-foreground font-normal ml-auto">
                      {result.network.domains?.old_count} → {result.network.domains?.new_count} domains
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {(result.network.domains?.added?.length > 0 || result.network.domains?.removed?.length > 0) && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">Domains</div>
                        {result.network.domains.added?.map((d: string, i: number) => (
                          <div key={`da${i}`} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-emerald-500/5 border border-emerald-500/15 mb-1">
                            <Plus className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">{d}</span>
                          </div>
                        ))}
                        {result.network.domains.removed?.map((d: string, i: number) => (
                          <div key={`dr${i}`} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-red-500/5 border border-red-500/15 mb-1">
                            <Minus className="w-3 h-3 text-red-400" /><span className="text-red-400">{d}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {result.network.urls?.added?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">New API Endpoints ({result.network.urls.added.length})</div>
                        <div className="space-y-1">
                          {result.network.urls.added.map((u: string, i: number) => (
                            <div key={i} className="text-[10px] font-mono text-emerald-400 p-1.5 rounded bg-emerald-500/5 border border-emerald-500/10 break-all">
                              + {u}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.network.urls?.removed?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">Removed Endpoints ({result.network.urls.removed.length})</div>
                        <div className="space-y-1">
                          {result.network.urls.removed.map((u: string, i: number) => (
                            <div key={i} className="text-[10px] font-mono text-red-400 p-1.5 rounded bg-red-500/5 border border-red-500/10 break-all">
                              - {u}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {result.network.ips?.added?.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-muted-foreground mb-1.5">New IP Addresses</div>
                        <div className="flex flex-wrap gap-1">
                          {result.network.ips.added.map((ip: string, i: number) => (
                            <span key={i} className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/15">{ip}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Key Insights */}
              {result.insights?.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Info className="w-4 h-4 text-primary" />
                    Key Insights
                  </h3>
                  <div className="space-y-1.5">
                    {result.insights.map((insight: any, i: number) => (
                      <div key={i} className={cn(
                        "flex items-center gap-2 p-2.5 rounded-lg text-xs border",
                        insight.severity === "warning" ? "bg-amber-500/5 border-amber-500/20 text-amber-300" :
                        "bg-primary/5 border-primary/20 text-primary"
                      )}>
                        <span>{insight.type === "feature" ? "+" : insight.type === "removal" ? "-" : insight.type === "security" ? "!" : "~"}</span>
                        <span>{insight.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Library Changes */}
              {result.libraries && (result.libraries.added?.length > 0 || result.libraries.removed?.length > 0) && (
                <details className="group" open>
                  <summary className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                    Library Changes (+{result.libraries.added?.length || 0} / -{result.libraries.removed?.length || 0})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {result.libraries.added?.map((lib: string, i: number) => (
                      <div key={`a${i}`} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-emerald-500/5 border border-emerald-500/15">
                        <Plus className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">{lib}</span>
                      </div>
                    ))}
                    {result.libraries.removed?.map((lib: string, i: number) => (
                      <div key={`r${i}`} className="flex items-center gap-2 text-xs font-mono p-1.5 rounded bg-red-500/5 border border-red-500/15">
                        <Minus className="w-3 h-3 text-red-400" /><span className="text-red-400">{lib}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Classes */}
              {(result.classes?.added?.length > 0 || result.classes?.removed?.length > 0 || result.classes?.modified?.length > 0) && (
                <details className="group">
                  <summary className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                    Class Changes (+{result.classes.added_count} / -{result.classes.removed_count} / ~{result.classes.modified_count})
                  </summary>
                  <div className="mt-2 space-y-2">
                    {result.classes.added?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {result.classes.added.map((c: string, i: number) => (
                          <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">{c}</span>
                        ))}
                      </div>
                    )}
                    {result.classes.removed?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {result.classes.removed.map((c: string, i: number) => (
                          <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/15">{c}</span>
                        ))}
                      </div>
                    )}
                    {result.classes.modified?.map((cls: any, i: number) => (
                      <div key={i} className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
                        <div className="text-xs font-mono font-semibold text-amber-400 mb-1">{cls.class}</div>
                        {cls.added_methods?.map((m: string, j: number) => (
                          <div key={`a${j}`} className="text-[10px] font-mono text-emerald-400 pl-2">+ {m}</div>
                        ))}
                        {cls.removed_methods?.map((m: string, j: number) => (
                          <div key={`r${j}`} className="text-[10px] font-mono text-red-400 pl-2">- {m}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Smart String Categories */}
              {result.strings?.categories && Object.keys(result.strings.categories).length > 0 && (
                <details className="group" open>
                  <summary className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                    What Changed (Smart Analysis)
                  </summary>
                  <div className="mt-2 space-y-2">
                    {Object.entries(result.strings.categories).map(([key, cat]: [string, any]) => (
                      <div key={key} className="p-3 rounded-lg bg-secondary/10 border border-border/20">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-foreground">{cat.label}</span>
                          {cat.added?.length > 0 && <span className="text-[10px] text-emerald-400">+{cat.added.length}</span>}
                          {cat.removed?.length > 0 && <span className="text-[10px] text-red-400">-{cat.removed.length}</span>}
                        </div>
                        <div className="space-y-0.5">
                          {cat.added?.map((s: string, j: number) => (
                            <div key={`a${j}`} className="text-[10px] font-mono text-emerald-400 break-all pl-2">+ {s}</div>
                          ))}
                          {cat.removed?.map((s: string, j: number) => (
                            <div key={`r${j}`} className="text-[10px] font-mono text-red-400 break-all pl-2">- {s}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Section Changes */}
              {result.sections?.length > 0 && (
                <details className="group">
                  <summary className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                    Section Changes ({result.sections.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {result.sections.map((sec: any, i: number) => (
                      <div key={i} className={cn(
                        "flex items-center gap-3 text-xs font-mono p-2 rounded border",
                        sec.change === "added" ? "bg-emerald-500/5 border-emerald-500/15" :
                        sec.change === "removed" ? "bg-red-500/5 border-red-500/15" :
                        "bg-amber-500/5 border-amber-500/15"
                      )}>
                        <span className={cn(
                          sec.change === "added" ? "text-emerald-400" :
                          sec.change === "removed" ? "text-red-400" : "text-amber-400"
                        )}>{sec.name}</span>
                        <span className="text-muted-foreground">
                          {sec.change === "resized" ? `${sec.old_size.toLocaleString()} → ${sec.new_size.toLocaleString()} (${sec.diff > 0 ? "+" : ""}${sec.diff.toLocaleString()})` : sec.change}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Raw strings fallback */}
              {(result.strings?.added_count > 0 || result.strings?.removed_count > 0) && (
                <details className="group">
                  <summary className="text-sm font-semibold text-foreground cursor-pointer hover:text-primary transition-colors">
                    All Changed Strings (raw: +{result.strings.added_count} / -{result.strings.removed_count})
                  </summary>
                  <div className="mt-2 max-h-[400px] overflow-y-auto space-y-0.5 p-2 rounded bg-secondary/10 border border-border/20">
                    {result.strings.added?.slice(0, 80).map((s: string, i: number) => (
                      <div key={`a${i}`} className="text-[10px] font-mono text-emerald-400 break-all">+ {s}</div>
                    ))}
                    {result.strings.removed?.slice(0, 80).map((s: string, i: number) => (
                      <div key={`r${i}`} className="text-[10px] font-mono text-red-400 break-all">- {s}</div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useRef, useCallback, useMemo } from "react";
import { Upload, Binary, Loader2, X, AlertTriangle, FileSearch, Hash, Search, ArrowDown, ArrowUp, Navigation, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "").replace(/\/[^/]+$/, "") + "/api";

interface HexData {
  filename: string;
  fileSize: number;
  offset: number;
  length: number;
  bytes: number[];
}

interface FileInfo {
  filename: string;
  size: number;
  type: string;
  magic: string;
  headerHex: string;
}

interface SearchResult {
  query: string;
  mode: string;
  needleLength: number;
  totalMatches: number;
  matches: number[];
  truncated: boolean;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function HexRow({ offset, bytes, highlights }: { offset: number; bytes: number[]; highlights?: Set<number> }) {
  const hexCells = [];
  const asciiCells = [];

  for (let i = 0; i < 16; i++) {
    if (i < bytes.length) {
      const b = bytes[i];
      const absOffset = offset + i;
      const isHighlighted = highlights?.has(absOffset);
      hexCells.push(
        <span key={i} className={cn(
          "font-mono",
          isHighlighted ? "text-yellow-300 bg-yellow-500/25 rounded-sm px-[1px]" :
          b === 0 ? "text-muted-foreground/30" :
          b >= 0x20 && b <= 0x7E ? "text-green-400/80" :
          "text-amber-400/70"
        )}>
          {b.toString(16).padStart(2, "0")}
        </span>
      );
      asciiCells.push(
        <span key={i} className={cn(
          "font-mono",
          isHighlighted ? "text-yellow-300 bg-yellow-500/25 rounded-sm" :
          b >= 0x20 && b <= 0x7E ? "text-foreground" : "text-muted-foreground/30"
        )}>
          {b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : "."}
        </span>
      );
    } else {
      hexCells.push(<span key={i} className="font-mono text-transparent">{"  "}</span>);
      asciiCells.push(<span key={i}>{" "}</span>);
    }
  }

  return (
    <div className="flex items-center gap-0 hover:bg-secondary/20 px-3 py-0.5 rounded transition-colors">
      <span className="font-mono text-primary/60 w-20 flex-shrink-0 text-right pr-4">
        {offset.toString(16).padStart(8, "0")}
      </span>
      <div className="flex gap-[6px] flex-shrink-0 w-[410px]">
        {hexCells.slice(0, 8)}
        <span className="w-1" />
        {hexCells.slice(8)}
      </div>
      <span className="w-4" />
      <div className="flex text-xs tracking-[1px]">
        {asciiCells}
      </div>
    </div>
  );
}

export default function HexViewer() {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hexData, setHexData] = useState<HexData | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hexContainerRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"hex" | "ascii">("hex");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  const [goToValue, setGoToValue] = useState("");

  const analyze = useCallback(async (f: File) => {
    setLoading(true);
    setError(null);
    setHexData(null);
    setFileInfo(null);
    setFile(f);
    setSearchResult(null);
    setSearchQuery("");

    try {
      const form1 = new FormData();
      form1.append("file", f);
      const r1 = await fetch(`${API_BASE}/binary/fileinfo`, { method: "POST", body: form1 });
      const info = await r1.json();
      if (!r1.ok) throw new Error(info.error || "Failed to get file info");
      setFileInfo(info);

      const form2 = new FormData();
      form2.append("file", f);
      form2.append("offset", "0");
      form2.append("length", "8192");
      const r2 = await fetch(`${API_BASE}/binary/hexdump`, { method: "POST", body: form2 });
      const hex = await r2.json();
      if (!r2.ok) throw new Error(hex.error || "Failed to get hex dump");
      setHexData(hex);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!file || !hexData) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("offset", String(hexData.offset + hexData.length));
      form.append("length", "8192");
      const r = await fetch(`${API_BASE}/binary/hexdump`, { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setHexData({
        ...data,
        offset: hexData.offset,
        length: hexData.length + data.length,
        bytes: [...hexData.bytes, ...data.bytes],
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [file, hexData]);

  const loadRange = useCallback(async (targetOffset: number) => {
    if (!file) return;
    setLoading(true);
    try {
      const alignedOffset = Math.max(0, Math.floor(targetOffset / 16) * 16 - 256);
      const form = new FormData();
      form.append("file", file);
      form.append("offset", String(alignedOffset));
      form.append("length", "8192");
      const r = await fetch(`${API_BASE}/binary/hexdump`, { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setHexData(data);
      setTimeout(() => {
        const rowIdx = Math.floor((targetOffset - alignedOffset) / 16);
        const container = hexContainerRef.current;
        if (container) {
          const rowHeight = 24;
          container.scrollTop = rowIdx * rowHeight - container.clientHeight / 2 + rowHeight;
        }
      }, 50);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [file]);

  const doSearch = useCallback(async () => {
    if (!file || !searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("query", searchQuery.trim());
      form.append("mode", searchMode);
      const r = await fetch(`${API_BASE}/binary/hexsearch`, { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setSearchResult(data);
      setCurrentMatchIdx(0);
      if (data.matches.length > 0) {
        await loadRange(data.matches[0]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, [file, searchQuery, searchMode, loadRange]);

  const goToMatch = useCallback(async (idx: number) => {
    if (!searchResult || idx < 0 || idx >= searchResult.matches.length) return;
    setCurrentMatchIdx(idx);
    await loadRange(searchResult.matches[idx]);
  }, [searchResult, loadRange]);

  const goToOffset = useCallback(async () => {
    if (!file || !goToValue.trim()) return;
    const cleaned = goToValue.trim().replace(/^0x/i, "");
    const offset = parseInt(cleaned, 16);
    if (isNaN(offset) || offset < 0) {
      setError("Invalid hex offset. Use format: 0x1000 or 1000");
      return;
    }
    if (fileInfo && offset >= fileInfo.size) {
      setError(`Offset 0x${offset.toString(16)} exceeds file size (${formatSize(fileInfo.size)})`);
      return;
    }
    await loadRange(offset);
  }, [file, goToValue, fileInfo, loadRange]);

  const exportHexDump = useCallback(() => {
    if (!hexData) return;
    let text = "";
    for (let i = 0; i < hexData.bytes.length; i += 16) {
      const rowBytes = hexData.bytes.slice(i, i + 16);
      const offset = (hexData.offset + i).toString(16).padStart(8, "0");
      const hex = rowBytes.map(b => b.toString(16).padStart(2, "0")).join(" ");
      const ascii = rowBytes.map(b => b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : ".").join("");
      text += `${offset}  ${hex.padEnd(48)}  |${ascii}|\n`;
    }
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileInfo?.filename || "dump"}_hex.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [hexData, fileInfo]);

  const highlights = useMemo(() => {
    if (!searchResult || !hexData) return undefined;
    const set = new Set<number>();
    const loadedStart = hexData.offset;
    const loadedEnd = hexData.offset + hexData.length;
    for (const matchOffset of searchResult.matches) {
      for (let j = 0; j < searchResult.needleLength; j++) {
        const abs = matchOffset + j;
        if (abs >= loadedStart && abs < loadedEnd) {
          set.add(abs);
        }
      }
    }
    return set.size > 0 ? set : undefined;
  }, [searchResult, hexData]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) analyze(f);
  }, [analyze]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) analyze(f);
  }, [analyze]);

  const rows: { offset: number; bytes: number[] }[] = [];
  if (hexData) {
    for (let i = 0; i < hexData.bytes.length; i += 16) {
      rows.push({
        offset: hexData.offset + i,
        bytes: hexData.bytes.slice(i, i + 16),
      });
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-10 py-6 border-b border-border/40">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-px w-8 bg-blue-400/40" />
          <span className="text-[10px] font-semibold tracking-[0.2em] text-blue-400/60 uppercase">Analysis</span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">Hex Viewer</h1>
        <p className="text-muted-foreground/60 text-xs mt-1">Upload any file to view raw hex bytes and ASCII representation.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-4">
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => !loading && inputRef.current?.click()}
          className={cn(
            "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all select-none",
            dragging ? "border-blue-400 bg-blue-500/10" : "border-border/50 hover:border-blue-400/50 hover:bg-secondary/20",
            loading && "pointer-events-none opacity-70"
          )}
        >
          <input ref={inputRef} type="file" className="hidden" onChange={onFileChange} accept="*" />
          {loading ? (
            <div className="flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
              <span className="text-sm text-blue-400">Loading hex dump…</span>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <Upload className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Drop any file here or click to upload</span>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {fileInfo && (
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-border/50 bg-secondary/15">
            <div className="flex items-center gap-2">
              <FileSearch className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono text-sm font-bold text-foreground">{fileInfo.filename}</span>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono">{formatSize(fileInfo.size)}</Badge>
            <Badge variant="outline" className="text-[10px] font-mono">Magic: 0x{fileInfo.magic}</Badge>
            <span className="text-xs text-muted-foreground truncate flex-1">{fileInfo.type}</span>
          </div>
        )}

        {hexData && (
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[280px] flex items-center gap-2 p-2.5 rounded-xl border border-border/50 bg-secondary/15">
              <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doSearch()}
                placeholder={searchMode === "hex" ? "CA FE BA BE or CAFEBABE" : "Search string…"}
                className="flex-1 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
              <div className="flex items-center gap-1 border-l border-border/40 pl-2">
                <button
                  onClick={() => setSearchMode("hex")}
                  className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
                    searchMode === "hex" ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground hover:text-foreground"
                  )}
                >HEX</button>
                <button
                  onClick={() => setSearchMode("ascii")}
                  className={cn(
                    "text-[10px] font-mono px-2 py-0.5 rounded transition-colors",
                    searchMode === "ascii" ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground hover:text-foreground"
                  )}
                >ASCII</button>
              </div>
              <button
                onClick={doSearch}
                disabled={searching || !searchQuery.trim()}
                className="text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-40 px-2"
              >
                {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Find"}
              </button>
            </div>

            <div className="flex items-center gap-2 p-2.5 rounded-xl border border-border/50 bg-secondary/15">
              <Navigation className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                type="text"
                value={goToValue}
                onChange={e => setGoToValue(e.target.value)}
                onKeyDown={e => e.key === "Enter" && goToOffset()}
                placeholder="0x1000"
                className="w-24 bg-transparent text-sm font-mono text-foreground placeholder:text-muted-foreground/40 outline-none"
              />
              <button
                onClick={goToOffset}
                disabled={loading || !goToValue.trim()}
                className="text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-40"
              >Go</button>
            </div>

            <button
              onClick={exportHexDump}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-border/50 bg-secondary/15 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          </div>
        )}

        {searchResult && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-yellow-500/30 bg-yellow-500/5">
            <Hash className="w-3.5 h-3.5 text-yellow-400" />
            <span className="text-xs text-yellow-400/80 font-mono">
              {searchResult.totalMatches} match{searchResult.totalMatches !== 1 ? "es" : ""}
              {searchResult.truncated && " (truncated)"}
            </span>
            {searchResult.totalMatches > 0 && (
              <>
                <span className="text-xs text-muted-foreground">
                  {currentMatchIdx + 1} / {searchResult.totalMatches}
                </span>
                <span className="text-[10px] font-mono text-yellow-400/60">
                  @ 0x{searchResult.matches[currentMatchIdx].toString(16).padStart(8, "0")}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <button
                    onClick={() => goToMatch(currentMatchIdx - 1)}
                    disabled={currentMatchIdx <= 0}
                    className="p-1 rounded hover:bg-secondary/40 disabled:opacity-30"
                  >
                    <ArrowUp className="w-3.5 h-3.5 text-yellow-400" />
                  </button>
                  <button
                    onClick={() => goToMatch(currentMatchIdx + 1)}
                    disabled={currentMatchIdx >= searchResult.totalMatches - 1}
                    className="p-1 rounded hover:bg-secondary/40 disabled:opacity-30"
                  >
                    <ArrowDown className="w-3.5 h-3.5 text-yellow-400" />
                  </button>
                </div>
                <button
                  onClick={() => { setSearchResult(null); setSearchQuery(""); }}
                  className="p-1 rounded hover:bg-secondary/40"
                >
                  <X className="w-3 h-3 text-muted-foreground" />
                </button>
              </>
            )}
          </div>
        )}

        {hexData && rows.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-black/30 overflow-hidden">
            <div className="flex items-center gap-0 px-3 py-2 border-b border-border/40 bg-secondary/20 text-[10px] font-mono text-muted-foreground uppercase tracking-wider">
              <span className="w-20 text-right pr-4">Offset</span>
              <div className="flex gap-[6px] w-[410px]">
                {Array.from({ length: 16 }, (_, i) => (
                  <span key={i} className={cn("w-[17px] text-center", i === 8 && "ml-[4px]")}>
                    {i.toString(16).toUpperCase()}
                  </span>
                ))}
              </div>
              <span className="w-4" />
              <span>ASCII</span>
            </div>

            <div ref={hexContainerRef} className="max-h-[600px] overflow-auto p-1 text-[12px]">
              {rows.map((row) => (
                <HexRow key={row.offset} offset={row.offset} bytes={row.bytes} highlights={highlights} />
              ))}
            </div>

            {hexData.offset + hexData.length < (fileInfo?.size ?? Infinity) && (
              <div className="border-t border-border/40 px-4 py-3 flex items-center justify-between bg-secondary/10">
                <span className="text-xs text-muted-foreground font-mono">
                  Showing 0x{hexData.offset.toString(16)} – 0x{(hexData.offset + hexData.length).toString(16)} ({formatSize(hexData.length)} of {formatSize(fileInfo?.size ?? 0)})
                </span>
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="text-xs text-primary hover:underline font-medium disabled:opacity-50"
                >
                  {loading ? "Loading…" : "Load more →"}
                </button>
              </div>
            )}
          </div>
        )}

        {hexData && (
          <div className="flex gap-6 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-green-400/20 border border-green-400/30" />
              <span>Printable ASCII (0x20–0x7E)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-400/20 border border-amber-400/30" />
              <span>Non-printable bytes</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-muted/20 border border-muted/30" />
              <span>Null bytes (0x00)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-yellow-400/20 border border-yellow-400/30" />
              <span>Search match</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

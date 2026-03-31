import { useState, useRef, useCallback } from "react";
import { Upload, Binary, Loader2, X, AlertTriangle, FileSearch, Hash } from "lucide-react";
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

function formatSize(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function HexRow({ offset, bytes }: { offset: number; bytes: number[] }) {
  const hexCells = [];
  const asciiCells = [];

  for (let i = 0; i < 16; i++) {
    if (i < bytes.length) {
      const b = bytes[i];
      hexCells.push(
        <span key={i} className={cn(
          "font-mono",
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

  const analyze = useCallback(async (f: File) => {
    setLoading(true);
    setError(null);
    setHexData(null);
    setFileInfo(null);
    setFile(f);

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
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-500/10">
            <Binary className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Hex Viewer</h1>
            <p className="text-muted-foreground text-xs mt-0.5">Upload any file to view its raw hex bytes and ASCII representation.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-4">
        {/* Upload */}
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

        {/* File Info Bar */}
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

        {/* Hex Dump */}
        {hexData && rows.length > 0 && (
          <div className="rounded-xl border border-border/50 bg-black/30 overflow-hidden">
            {/* Column Headers */}
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

            {/* Hex Content */}
            <div className="max-h-[600px] overflow-auto p-1 text-[12px]">
              {rows.map((row) => (
                <HexRow key={row.offset} offset={row.offset} bytes={row.bytes} />
              ))}
            </div>

            {/* Load More */}
            {hexData.offset + hexData.length < (fileInfo?.size ?? Infinity) && (
              <div className="border-t border-border/40 px-4 py-3 flex items-center justify-between bg-secondary/10">
                <span className="text-xs text-muted-foreground font-mono">
                  Showing {formatSize(hexData.length)} of {formatSize(fileInfo?.size ?? 0)}
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

        {/* Legend */}
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
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-c";
import "prismjs/components/prism-objectivec";
import { Download, Copy, Check, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeViewerProps {
  code: string;
  language?: "c" | "objectivec" | "plain";
  filename?: string;
  engine?: string;
  onDownload?: () => void;
  downloadLabel?: string;
  accentColor?: string;
}

export default function CodeViewer({
  code,
  language = "c",
  filename,
  engine,
  onDownload,
  downloadLabel = "Download",
  accentColor = "emerald",
}: CodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const codeRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const lines = code.split("\n");

  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchTerm || !codeRef.current) {
      setMatchCount(0);
      setMatchIndex(0);
      return;
    }
    const text = code.toLowerCase();
    const term = searchTerm.toLowerCase();
    let count = 0;
    let pos = 0;
    while ((pos = text.indexOf(term, pos)) !== -1) {
      count++;
      pos += term.length;
    }
    setMatchCount(count);
    setMatchIndex(count > 0 ? 1 : 0);
  }, [searchTerm, code]);

  useEffect(() => {
    if (!searchTerm || matchIndex <= 0 || !codeRef.current) return;
    const marks = codeRef.current.querySelectorAll("mark[data-search-match]");
    if (marks.length > 0 && matchIndex - 1 < marks.length) {
      marks[matchIndex - 1].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [matchIndex, searchTerm]);

  const highlightLine = useCallback(
    (line: string) => {
      let html: string;
      if (language === "plain") {
        html = escapeHtml(line);
      } else {
        const grammar = Prism.languages[language] || Prism.languages.clike;
        html = Prism.highlight(line, grammar, language);
      }

      if (searchTerm) {
        html = highlightSearch(html, searchTerm);
      }

      return html;
    },
    [language, searchTerm]
  );

  const colorMap: Record<string, { border: string; bg: string; text: string; gutter: string; activeMark: string }> = {
    violet: {
      border: "border-violet-500/20",
      bg: "bg-violet-950/10",
      text: "text-violet-300",
      gutter: "text-violet-500/30 border-violet-500/10",
      activeMark: "bg-violet-500/30",
    },
    cyan: {
      border: "border-cyan-500/20",
      bg: "bg-cyan-950/10",
      text: "text-cyan-300",
      gutter: "text-cyan-500/30 border-cyan-500/10",
      activeMark: "bg-cyan-500/30",
    },
    amber: {
      border: "border-amber-500/20",
      bg: "bg-amber-950/10",
      text: "text-amber-300",
      gutter: "text-amber-500/30 border-amber-500/10",
      activeMark: "bg-amber-500/30",
    },
    emerald: {
      border: "border-emerald-500/20",
      bg: "bg-emerald-950/10",
      text: "text-emerald-300",
      gutter: "text-emerald-500/30 border-emerald-500/10",
      activeMark: "bg-emerald-500/30",
    },
  };

  const colors = colorMap[accentColor] || colorMap.emerald;

  return (
    <div className={cn("rounded-lg border overflow-hidden flex flex-col", colors.border)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-secondary/30 border-b border-border/30">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
          {filename && (
            <span className="text-xs font-mono text-muted-foreground">{filename}</span>
          )}
          {engine && (
            <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded", colors.bg, colors.text)}>
              {engine}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/50">{lines.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          {searchOpen ? (
            <div className="flex items-center gap-1 bg-secondary/50 rounded px-2 py-1 border border-border/40">
              <Search className="w-3 h-3 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search…"
                className="bg-transparent text-xs text-foreground w-32 outline-none placeholder:text-muted-foreground/50"
                onKeyDown={e => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
                    setSearchTerm("");
                  }
                  if (e.key === "Enter") {
                    setMatchIndex(i => (i < matchCount ? i + 1 : 1));
                  }
                }}
              />
              {searchTerm && (
                <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                  {matchIndex}/{matchCount}
                </span>
              )}
              <button onClick={() => setMatchIndex(i => (i > 1 ? i - 1 : matchCount))} className="p-0.5 hover:text-foreground text-muted-foreground">
                <ChevronUp className="w-3 h-3" />
              </button>
              <button onClick={() => setMatchIndex(i => (i < matchCount ? i + 1 : 1))} className="p-0.5 hover:text-foreground text-muted-foreground">
                <ChevronDown className="w-3 h-3" />
              </button>
              <button onClick={() => { setSearchOpen(false); setSearchTerm(""); }} className="p-0.5 hover:text-foreground text-muted-foreground">
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
              title="Search (Ctrl+F)"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={copyCode}
            className="p-1.5 rounded hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Copy all"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {onDownload && (
            <button
              onClick={onDownload}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded transition-colors",
                colors.bg, colors.text, "hover:opacity-80"
              )}
            >
              <Download className="w-3 h-3" />
              {downloadLabel}
            </button>
          )}
        </div>
      </div>

      {/* Code area with line numbers */}
      <div ref={codeRef} className="overflow-auto max-h-[700px] bg-[hsl(224,30%,4%)]">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, i) => (
              <tr key={i} className="hover:bg-white/[0.02]">
                <td
                  className={cn(
                    "text-right px-3 py-0 select-none border-r font-mono text-[11px] leading-5 align-top sticky left-0 bg-[hsl(224,30%,4%)]",
                    colors.gutter
                  )}
                  style={{ minWidth: "3.5rem" }}
                >
                  {i + 1}
                </td>
                <td className="px-4 py-0">
                  <pre className="text-[12px] font-mono leading-5 whitespace-pre-wrap break-all m-0">
                    <code
                      dangerouslySetInnerHTML={{ __html: highlightLine(line) }}
                    />
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function highlightSearch(html: string, term: string): string {
  if (!term) return html;
  const plainText = html.replace(/<[^>]*>/g, "");
  const lowerPlain = plainText.toLowerCase();
  const lowerTerm = term.toLowerCase();

  let idx = 0;
  let matchNum = 0;
  const result: string[] = [];
  let htmlIdx = 0;
  let plainIdx = 0;

  while (htmlIdx < html.length) {
    if (html[htmlIdx] === "<") {
      const end = html.indexOf(">", htmlIdx);
      if (end !== -1) {
        result.push(html.slice(htmlIdx, end + 1));
        htmlIdx = end + 1;
        continue;
      }
    }

    if (lowerPlain.indexOf(lowerTerm, plainIdx) === plainIdx) {
      matchNum++;
      result.push(`<mark data-search-match="${matchNum}" class="bg-yellow-500/30 text-yellow-200 rounded-sm px-px">`);
      for (let j = 0; j < term.length; j++) {
        if (htmlIdx < html.length && html[htmlIdx] === "<") {
          const end = html.indexOf(">", htmlIdx);
          if (end !== -1) {
            result.push(html.slice(htmlIdx, end + 1));
            htmlIdx = end + 1;
          }
        }
        if (htmlIdx < html.length) {
          result.push(html[htmlIdx]);
          htmlIdx++;
          plainIdx++;
        }
      }
      result.push("</mark>");
    } else {
      result.push(html[htmlIdx]);
      htmlIdx++;
      plainIdx++;
    }
  }

  return result.join("");
}

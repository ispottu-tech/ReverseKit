import { useLocation } from "wouter";
import { ScanSearch, Binary, Crosshair, BookMarked, Smartphone, ArrowRight, Shield, Cpu, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const tools = [
  {
    href: "/binary",
    icon: ScanSearch,
    title: "Binary Inspector",
    desc: "Upload any iOS binary (.dylib, .framework, Mach-O) and get a full security & structure report — classes, functions, ROP gadgets, obfuscation detection, and pseudo-C decompilation.",
    tags: ["lief", "radare2", "capstone", "ROPgadget"],
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    ready: true,
  },
  {
    href: "/hex",
    icon: Binary,
    title: "Hex Viewer",
    desc: "Upload any file and view its raw hex bytes, ASCII representation, and file header magic bytes. Useful for inspecting binary structures and finding hidden data.",
    tags: ["hex dump", "magic bytes", "raw view"],
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
    ready: true,
  },
  {
    href: "/scripts",
    icon: BookMarked,
    title: "Script Arsenal",
    desc: "A library of ready-to-use Frida scripts for SSL bypass, method tracing, jailbreak detection bypass, and more. Add your own scripts and they'll be saved in your browser.",
    tags: ["frida", "hooks", "bypass"],
    color: "text-amber-400",
    bg: "bg-amber-500/10 border-amber-500/20",
    ready: true,
  },
  {
    href: "/device",
    icon: Smartphone,
    title: "Device Manager",
    desc: "Connect to a jailbroken iOS device running Frida Server. Browse processes, spawn apps, create hook sessions, and execute scripts in real-time on the target device.",
    tags: ["frida-server", "processes", "hooking"],
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
    ready: true,
  },
];

const installedTools = [
  { name: "radare2", version: "5.9.8", desc: "Disassembly & decompilation" },
  { name: "lief", version: "0.17.6", desc: "Mach-O / ELF parser" },
  { name: "capstone", version: "5.0", desc: "ARM64 disassembler" },
  { name: "ROPgadget", version: "7.7", desc: "ROP chain finder" },
  { name: "pwntools", version: "4.15", desc: "Binary security checks" },
  { name: "frida-tools", version: "17.9", desc: "Dynamic instrumentation" },
  { name: "objection", version: "1.12", desc: "Runtime exploration" },
  { name: "Ghidra", version: "", desc: "NSA decompiler" },
];

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex-1 overflow-auto">
      {/* Hero */}
      <div className="px-8 pt-10 pb-8 border-b border-border/40">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
            <Crosshair className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">ReverseKit</h1>
            <p className="text-muted-foreground text-sm">iOS Reverse Engineering & Binary Analysis Platform</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm max-w-2xl leading-relaxed mt-4">
          A complete toolkit for analyzing iOS binaries, inspecting Mach-O files, finding security vulnerabilities,
          and performing dynamic analysis with Frida. Upload a binary to get started — no device required for static analysis.
        </p>
      </div>

      <div className="px-8 py-8 space-y-10">
        {/* Tool Cards */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4" />
            Available Tools
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {tools.map((tool) => (
              <button
                key={tool.href}
                onClick={() => setLocation(tool.href)}
                className={cn(
                  "text-left p-5 rounded-xl border transition-all group",
                  "hover:shadow-lg hover:scale-[1.01]",
                  tool.bg
                )}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg bg-black/20")}>
                      <tool.icon className={cn("w-5 h-5", tool.color)} />
                    </div>
                    <h3 className="font-bold text-foreground text-lg">{tool.title}</h3>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors mt-1" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {tool.desc}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tool.tags.map(tag => (
                    <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded bg-black/20 text-muted-foreground/80 border border-white/5">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Quick Start */}
        <div className="rounded-xl border border-border/50 bg-card/30 p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Quick Start
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">1</span>
                <span className="font-semibold text-foreground">Static Analysis</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed pl-8">
                Open <span className="text-foreground font-medium">Binary Inspector</span> → upload a .dylib or Mach-O file → get a full security report with classes, functions, ROP gadgets, and decompiled code. No device needed.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">2</span>
                <span className="font-semibold text-foreground">Hex Inspection</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed pl-8">
                Open <span className="text-foreground font-medium">Hex Viewer</span> → upload any file → browse raw bytes, find magic numbers, and inspect binary structures.
              </p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold flex items-center justify-center">3</span>
                <span className="font-semibold text-foreground">Dynamic Analysis</span>
              </div>
              <p className="text-muted-foreground text-xs leading-relaxed pl-8">
                Open <span className="text-foreground font-medium">Device Manager</span> → enter your jailbroken device IP → connect → attach to processes and inject Frida scripts live.
              </p>
            </div>
          </div>
        </div>

        {/* Installed Tools */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4 flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Integrated Analysis Engines
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {installedTools.map(tool => (
              <div key={tool.name} className="px-3 py-2.5 rounded-lg border border-border/40 bg-secondary/15">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-mono text-xs font-bold text-foreground">{tool.name}</span>
                  {tool.version && (
                    <span className="text-[10px] font-mono text-primary/70">{tool.version}</span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{tool.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

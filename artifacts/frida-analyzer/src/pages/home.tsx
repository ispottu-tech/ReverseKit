import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronRight, Zap, Package } from "lucide-react";

const tools = [
  {
    href: "/binary",
    title: "Binary Inspector",
    desc: "Upload any iOS binary and get full source code extraction — Ghidra + RetDec decompilation, ObjC headers, YARA threat scanning, ROP gadgets, and 20 analysis tabs.",
    tags: ["Ghidra", "RetDec", "radare2", "YARA", "lief"],
    gradient: "from-emerald-500/15 to-teal-500/5",
    border: "border-emerald-500/20 hover:border-emerald-500/40",
    accent: "text-emerald-400",
    dotColor: "bg-emerald-400",
  },
  {
    href: "/diff",
    title: "Binary Diff",
    desc: "Compare two iOS binary versions — find new APIs, privacy changes, security regressions, and network footprint expansion with smart categorization.",
    tags: ["security", "privacy", "network", "diff"],
    gradient: "from-cyan-500/15 to-sky-500/5",
    border: "border-cyan-500/20 hover:border-cyan-500/40",
    accent: "text-cyan-400",
    dotColor: "bg-cyan-400",
  },
  {
    href: "/hex",
    title: "Hex Viewer",
    desc: "View raw hex bytes, ASCII representation, and file header magic bytes. Inspect binary structures and find hidden data patterns.",
    tags: ["hex dump", "magic bytes", "raw view"],
    gradient: "from-blue-500/15 to-indigo-500/5",
    border: "border-blue-500/20 hover:border-blue-500/40",
    accent: "text-blue-400",
    dotColor: "bg-blue-400",
  },
  {
    href: "/scripts",
    title: "Script Arsenal",
    desc: "Ready-to-use Frida scripts for SSL bypass, method tracing, jailbreak detection bypass, and more. Save your own scripts locally.",
    tags: ["frida", "hooks", "bypass"],
    gradient: "from-amber-500/15 to-orange-500/5",
    border: "border-amber-500/20 hover:border-amber-500/40",
    accent: "text-amber-400",
    dotColor: "bg-amber-400",
  },
  {
    href: "/device",
    title: "Device Manager",
    desc: "Connect to a jailbroken iOS device running Frida Server. Browse processes, spawn apps, hook methods, and execute scripts live.",
    tags: ["frida-server", "processes", "hooking"],
    gradient: "from-violet-500/15 to-purple-500/5",
    border: "border-violet-500/20 hover:border-violet-500/40",
    accent: "text-violet-400",
    dotColor: "bg-violet-400",
  },
];

const engines = [
  { name: "Ghidra", ver: "11.3.2", role: "Decompiler" },
  { name: "RetDec", ver: "5.0", role: "Decompiler" },
  { name: "radare2", ver: "5.9.8", role: "Disassembly" },
  { name: "YARA", ver: "4.5", role: "Threat Scanner" },
  { name: "lief", ver: "0.17.6", role: "Mach-O Parser" },
  { name: "capstone", ver: "5.0", role: "ARM64 Disasm" },
  { name: "ROPgadget", ver: "7.7", role: "Gadget Finder" },
  { name: "pwntools", ver: "4.15", role: "Security" },
  { name: "frida", ver: "17.9", role: "Instrumentation" },
  { name: "objection", ver: "1.12", role: "Exploration" },
  { name: "unicorn", ver: "2.0", role: "CPU Emulation" },
];

const steps = [
  { n: "01", title: "Upload", desc: "Drop any .dylib, .ipa, .deb, .zip, or Mach-O binary — archives are auto-extracted." },
  { n: "02", title: "Analyze", desc: "21 analysis steps run automatically — decompilation, YARA scanning, class-dump, string decryption, security checks." },
  { n: "03", title: "Compare", desc: "Use Binary Diff to compare versions — get security assessments, privacy impact, and network footprint changes." },
  { n: "04", title: "Export", desc: "Download decompiled C source, ObjC headers, or copy results from any of the 20 analysis tabs." },
];

export default function Home() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex-1 overflow-auto">
      {/* Hero */}
      <div className="px-10 pt-12 pb-10">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-px flex-1 max-w-12 bg-primary/40" />
          <span className="text-[11px] font-semibold tracking-[0.2em] text-primary/70 uppercase">iOS Analysis Platform</span>
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight leading-[1.1] mb-4">
          Reverse Engineer<br />
          <span className="bg-gradient-to-r from-primary to-emerald-300 bg-clip-text text-transparent">with Confidence.</span>
        </h1>
        <p className="text-muted-foreground text-[15px] max-w-lg leading-relaxed">
          Analyze iOS binaries, inspect Mach-O files, find security vulnerabilities, and perform dynamic analysis — all from your browser.
        </p>
        <button
          onClick={() => setLocation("/binary")}
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Start Analysis <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="px-10 pb-12 space-y-12">
        {/* Tool Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {tools.map((tool) => (
            <button
              key={tool.href}
              onClick={() => setLocation(tool.href)}
              className={cn(
                "text-left p-6 rounded-2xl border bg-gradient-to-br transition-all duration-300 group",
                "hover:shadow-xl hover:shadow-black/10 hover:-translate-y-0.5",
                tool.gradient,
                tool.border
              )}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={cn("w-2 h-2 rounded-full", tool.dotColor)} />
                <h3 className="font-bold text-foreground text-[17px] tracking-tight">{tool.title}</h3>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40 ml-auto group-hover:text-foreground/60 group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="text-[13px] text-muted-foreground leading-relaxed mb-4 pl-5">
                {tool.desc}
              </p>
              <div className="flex flex-wrap gap-1.5 pl-5">
                {tool.tags.map(tag => (
                  <span key={tag} className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white/5 text-muted-foreground/60 border border-white/5">
                    {tag}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>

        {/* How it works */}
        <div>
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-4 h-4 text-primary/60" />
            <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground/60 uppercase">How it works</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {steps.map((step) => (
              <div key={step.n} className="relative">
                <span className="text-4xl font-black text-primary/8 absolute -top-2 -left-1 select-none">{step.n}</span>
                <div className="relative pl-1 pt-6">
                  <h3 className="font-bold text-foreground text-sm mb-1.5">{step.title}</h3>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Engines */}
        <div>
          <div className="flex items-center gap-2 mb-5">
            <Package className="w-4 h-4 text-primary/60" />
            <h2 className="text-xs font-semibold tracking-[0.15em] text-muted-foreground/60 uppercase">Integrated Engines</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {engines.map(e => (
              <div key={e.name} className="px-4 py-3 rounded-xl border border-border/40 bg-card/40 hover:bg-card/70 transition-colors group">
                <div className="flex items-baseline gap-2 mb-0.5">
                  <span className="font-mono text-[13px] font-bold text-foreground">{e.name}</span>
                  {e.ver && <span className="text-[10px] font-mono text-primary/50">{e.ver}</span>}
                </div>
                <p className="text-[11px] text-muted-foreground/60">{e.role}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

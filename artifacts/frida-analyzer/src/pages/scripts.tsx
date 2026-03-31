import { useState, useEffect } from "react";
import { BookMarked, Plus, Trash2, Copy, Check, X, Tag, Code2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface SavedScript {
  id: string;
  name: string;
  category: string;
  code: string;
  createdAt: number;
}

const STORAGE_KEY = "reversekit:scripts";

const DEFAULT_SCRIPTS: SavedScript[] = [
  {
    id: "default-1",
    name: "Enumerate ObjC Classes",
    category: "Enumeration",
    createdAt: 0,
    code: `ObjC.schedule(ObjC.mainQueue, function () {
  var classes = Object.keys(ObjC.classes);
  classes.forEach(function(cls) {
    console.log(cls);
  });
  console.log("[*] Total:", classes.length);
});`,
  },
  {
    id: "default-2",
    name: "Trace All Methods of a Class",
    category: "Tracing",
    createdAt: 0,
    code: `var targetClass = "ViewController"; // <-- change this
var resolver = new ApiResolver("objc");
resolver.enumerateMatches("*[" + targetClass + " *]").forEach(function(match) {
  try {
    Interceptor.attach(match.address, {
      onEnter: function(args) {
        console.log("[>] " + match.name);
      }
    });
  } catch(e) {}
});`,
  },
  {
    id: "default-3",
    name: "Bypass SSL Pinning (SecTrust)",
    category: "SSL Bypass",
    createdAt: 0,
    code: `var SecTrustEvaluate = Module.findExportByName("Security", "SecTrustEvaluate");
if (SecTrustEvaluate) {
  Interceptor.replace(SecTrustEvaluate, new NativeCallback(function(trust, result) {
    result.writeS32(1); // kSecTrustResultProceed
    return 0;
  }, 'int', ['pointer', 'pointer']));
  console.log("[*] SecTrustEvaluate bypassed");
}`,
  },
  {
    id: "default-4",
    name: "Hook NSURLSession Requests",
    category: "Network",
    createdAt: 0,
    code: `var hook = ObjC.classes.NSURLSession["- dataTaskWithRequest:completionHandler:"];
if (hook) {
  Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
      var req = new ObjC.Object(args[2]);
      console.log("[NET]", req.URL().absoluteString());
    }
  });
  console.log("[*] NSURLSession hooked");
}`,
  },
  {
    id: "default-5",
    name: "Dump Method Arguments",
    category: "Tracing",
    createdAt: 0,
    code: `var className  = "NSString";
var methodName = "- stringByAppendingString:";
var hook = ObjC.classes[className][methodName];
if (hook) {
  Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
      var str = new ObjC.Object(args[2]);
      console.log("[ARG]", str.toString());
    },
    onLeave: function(ret) {
      var result = new ObjC.Object(ret);
      console.log("[RET]", result.toString());
    }
  });
}`,
  },
  {
    id: "default-6",
    name: "Detect Jailbreak Checks",
    category: "Anti-Detection",
    createdAt: 0,
    code: `// Hook common jailbreak file checks
var NSFileManager = ObjC.classes.NSFileManager;
var hook = NSFileManager["- fileExistsAtPath:"];
Interceptor.attach(hook.implementation, {
  onEnter: function(args) {
    var path = new ObjC.Object(args[2]).toString();
    if (path.indexOf("cydia") !== -1 || path.indexOf("substrate") !== -1) {
      console.log("[JB-CHECK]", path);
    }
  },
  onLeave: function(ret) {
    // Force return NO to bypass
    // ret.replace(0);
  }
});`,
  },
];

function loadScripts(): SavedScript[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SCRIPTS;
    const parsed = JSON.parse(raw) as SavedScript[];
    return parsed.length > 0 ? parsed : DEFAULT_SCRIPTS;
  } catch {
    return DEFAULT_SCRIPTS;
  }
}

function saveScripts(scripts: SavedScript[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
}

const CATEGORIES = ["All", "Enumeration", "Tracing", "SSL Bypass", "Network", "Anti-Detection", "Custom"];

export default function Scripts() {
  const [scripts, setScripts] = useState<SavedScript[]>(loadScripts);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("Custom");
  const [newCode, setNewCode] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    saveScripts(scripts);
  }, [scripts]);

  const filtered = scripts.filter(s => {
    const matchCat = activeCategory === "All" || s.category === activeCategory;
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleCopy = (script: SavedScript) => {
    navigator.clipboard.writeText(script.code);
    toast.success("Copied to clipboard");
    setCopiedId(script.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (id: string) => {
    setScripts(prev => prev.filter(s => s.id !== id));
    toast.success("Script removed");
  };

  const handleSaveNew = () => {
    if (!newName.trim() || !newCode.trim()) {
      toast.error("Name and code are required");
      return;
    }
    const newScript: SavedScript = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      category: newCategory,
      code: newCode.trim(),
      createdAt: Date.now(),
    };
    setScripts(prev => [newScript, ...prev]);
    setNewName("");
    setNewCode("");
    setShowNew(false);
    toast.success("Script saved");
  };

  const usedCategories = ["All", ...Array.from(new Set(scripts.map(s => s.category)))];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-8 py-5 border-b border-border/50">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BookMarked className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Script Arsenal</h1>
              <p className="text-muted-foreground text-xs mt-0.5">Save and reuse Frida scripts. Stored locally in your browser.</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowNew(v => !v)}>
            {showNew ? <X className="w-3.5 h-3.5 mr-2" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
            {showNew ? "Cancel" : "Add Script"}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-5 space-y-5">
        {/* New Script Form */}
        {showNew && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              New Script
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="script-name" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</Label>
                <Input
                  id="script-name"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Bypass Root Detection"
                  className="bg-background/60 border-border/60 h-9 font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="script-cat" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Category</Label>
                <select
                  id="script-cat"
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value)}
                  className="w-full h-9 rounded-md border border-border/60 bg-background/60 text-sm px-3 font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  {CATEGORIES.filter(c => c !== "All").map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="script-code" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">JavaScript / Frida Code</Label>
              <Textarea
                id="script-code"
                value={newCode}
                onChange={e => setNewCode(e.target.value)}
                placeholder="// Frida JavaScript..."
                className="font-mono text-xs bg-black/40 border-border/60 min-h-[140px] resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
              <Button size="sm" onClick={handleSaveNew}>Save Script</Button>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search scripts…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-9 bg-secondary/20 border-border/50 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {usedCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-medium border transition-all",
                  activeCategory === cat
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "bg-secondary/20 text-muted-foreground border-border/40 hover:text-foreground hover:bg-secondary/40"
                )}
              >
                {cat}
                {cat !== "All" && (
                  <span className="ml-1.5 text-[10px] opacity-60">{scripts.filter(s => s.category === cat).length}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scripts Grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Code2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No scripts found.</p>
            <button onClick={() => setShowNew(true)} className="text-xs text-primary mt-2 hover:underline">
              Add your first script
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filtered.map((script) => {
              const isExpanded = expandedId === script.id;
              const isDefault = script.createdAt === 0;
              return (
                <div
                  key={script.id}
                  className="rounded-xl border border-border/50 bg-card/30 overflow-hidden hover:border-border/80 transition-colors"
                >
                  {/* Script Header */}
                  <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/40 bg-secondary/10">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground truncate">{script.name}</span>
                        <Badge variant="outline" className="text-[10px] font-mono border-border/50 text-muted-foreground shrink-0">
                          <Tag className="w-2.5 h-2.5 mr-1" />
                          {script.category}
                        </Badge>
                        {isDefault && (
                          <span className="text-[10px] text-muted-foreground/50 font-mono">built-in</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleCopy(script)}
                        className="p-1.5 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-primary transition-colors"
                        title="Copy to clipboard"
                      >
                        {copiedId === script.id
                          ? <Check className="w-3.5 h-3.5 text-primary" />
                          : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {!isDefault && (
                        <button
                          onClick={() => handleDelete(script.id)}
                          className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Code */}
                  <div
                    className={cn("bg-black/35 relative cursor-pointer", !isExpanded && "max-h-[120px] overflow-hidden")}
                    onClick={() => setExpandedId(isExpanded ? null : script.id)}
                  >
                    <pre className="p-4 text-xs font-mono text-green-400/80 leading-relaxed whitespace-pre overflow-x-auto">
                      {script.code}
                    </pre>
                    {!isExpanded && (
                      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1">
                        <span className="text-[10px] text-muted-foreground/60">click to expand</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

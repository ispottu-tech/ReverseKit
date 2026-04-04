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
    name: "App-Only Classes (Filter System)",
    category: "Enumeration",
    createdAt: 0,
    code: `var dominated = ["NS","UI","CF","CA","CG","AV","CL","MK","SK","WK","GK",
  "CT","CN","MP","PH","HK","IN","SF","AS","VS","MT","ML","AR","SC",
  "LA","CB","CM","EK","NK","QL","UN","_"];
ObjC.schedule(ObjC.mainQueue, function() {
  var classes = Object.keys(ObjC.classes).filter(function(cls) {
    return !dominated.some(function(p) { return cls.indexOf(p) === 0; });
  });
  classes.sort();
  classes.forEach(function(cls) { console.log("[APP]", cls); });
  console.log("\\n[*] App classes:", classes.length, "/ Total:", Object.keys(ObjC.classes).length);
});`,
  },
  {
    id: "default-2",
    name: "Find Login/Auth Classes",
    category: "Enumeration",
    createdAt: 0,
    code: `var keywords = ["login","auth","sign","credential","token","session",
  "password","oauth","sso","account","keychain","biometric","2fa","otp","mfa"];
ObjC.schedule(ObjC.mainQueue, function() {
  var classes = Object.keys(ObjC.classes);
  var found = {};
  classes.forEach(function(cls) {
    var lower = cls.toLowerCase();
    keywords.forEach(function(kw) {
      if (lower.indexOf(kw) !== -1) {
        if (!found[kw]) found[kw] = [];
        found[kw].push(cls);
      }
    });
  });
  Object.keys(found).sort().forEach(function(kw) {
    console.log("\\n--- " + kw.toUpperCase() + " ---");
    found[kw].forEach(function(c) { console.log("  " + c); });
  });
});`,
  },
  {
    id: "default-3",
    name: "Find Payment/IAP Classes",
    category: "Enumeration",
    createdAt: 0,
    code: `var keywords = ["pay","purchase","billing","subscription","store","receipt",
  "transaction","price","checkout","cart","order","stripe","braintree","revenue"];
ObjC.schedule(ObjC.mainQueue, function() {
  var classes = Object.keys(ObjC.classes);
  var found = [];
  classes.forEach(function(cls) {
    var lower = cls.toLowerCase();
    if (keywords.some(function(kw) { return lower.indexOf(kw) !== -1; })) {
      found.push(cls);
    }
  });
  found.sort();
  console.log("[*] Payment/IAP related classes (" + found.length + "):");
  found.forEach(function(c) { console.log("  " + c); });
});`,
  },
  {
    id: "default-4",
    name: "Find Crypto/Encryption Classes",
    category: "Enumeration",
    createdAt: 0,
    code: `var keywords = ["crypt","cipher","aes","rsa","hmac","hash","sha","md5",
  "encrypt","decrypt","key","salt","iv","pbkdf","ecdsa","signing"];
ObjC.schedule(ObjC.mainQueue, function() {
  var classes = Object.keys(ObjC.classes);
  var found = [];
  classes.forEach(function(cls) {
    var lower = cls.toLowerCase();
    if (keywords.some(function(kw) { return lower.indexOf(kw) !== -1; })) {
      found.push(cls);
    }
  });
  found.sort();
  console.log("[*] Crypto/Encryption classes (" + found.length + "):");
  found.forEach(function(c) { console.log("  " + c); });
});`,
  },
  {
    id: "default-5",
    name: "Dump Class Methods + Properties",
    category: "Enumeration",
    createdAt: 0,
    code: `var targetClass = "AppDelegate"; // <-- change this
var cls = ObjC.classes[targetClass];
if (!cls) { console.log("[!] Class not found: " + targetClass); }
else {
  console.log("=== " + targetClass + " ===");
  console.log("\\n--- Instance Methods ---");
  cls.$ownMethods.filter(function(m) { return m[0] === "-"; })
    .sort().forEach(function(m) { console.log("  " + m); });
  console.log("\\n--- Class Methods ---");
  cls.$ownMethods.filter(function(m) { return m[0] === "+"; })
    .sort().forEach(function(m) { console.log("  " + m); });
  console.log("\\n--- Protocols ---");
  cls.$protocols ? Object.keys(cls.$protocols)
    .forEach(function(p) { console.log("  " + p); }) : console.log("  (none)");
  console.log("\\n--- Super ---", cls.$superClass ? cls.$superClass.$className : "(none)");
}`,
  },
  {
    id: "default-6",
    name: "Trace All Methods of a Class",
    category: "Tracing",
    createdAt: 0,
    code: `var targetClass = "ViewController"; // <-- change this
var resolver = new ApiResolver("objc");
var matches = resolver.enumerateMatches("*[" + targetClass + " *]");
console.log("[*] Hooking " + matches.length + " methods on " + targetClass);
matches.forEach(function(match) {
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
    id: "default-7",
    name: "Trace Method with Args & Return",
    category: "Tracing",
    createdAt: 0,
    code: `var className  = "NSString";
var methodName = "- stringByAppendingString:";
var hook = ObjC.classes[className][methodName];
if (hook) {
  Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
      this.self = new ObjC.Object(args[0]);
      var arg = new ObjC.Object(args[2]);
      console.log("[>] " + className + " " + methodName);
      console.log("    self:", this.self.toString().substring(0, 100));
      console.log("    arg1:", arg.toString().substring(0, 100));
    },
    onLeave: function(ret) {
      var result = new ObjC.Object(ret);
      console.log("[<] return:", result.toString().substring(0, 100));
    }
  });
  console.log("[*] Hooked " + className + " " + methodName);
}`,
  },
  {
    id: "default-8",
    name: "Monitor UserDefaults Read/Write",
    category: "Tracing",
    createdAt: 0,
    code: `var UD = ObjC.classes.NSUserDefaults;
["- objectForKey:", "- stringForKey:", "- boolForKey:", "- integerForKey:"].forEach(function(sel) {
  var m = UD[sel];
  if (m) Interceptor.attach(m.implementation, {
    onEnter: function(args) {
      this.key = new ObjC.Object(args[2]).toString();
    },
    onLeave: function(ret) {
      try {
        var val = new ObjC.Object(ret);
        console.log("[READ]", this.key, "=", val.toString().substring(0, 200));
      } catch(e) { console.log("[READ]", this.key, "= (primitive)"); }
    }
  });
});
var setObj = UD["- setObject:forKey:"];
if (setObj) Interceptor.attach(setObj.implementation, {
  onEnter: function(args) {
    var val = new ObjC.Object(args[2]);
    var key = new ObjC.Object(args[3]);
    console.log("[WRITE]", key.toString(), "=", val.toString().substring(0, 200));
  }
});
console.log("[*] UserDefaults monitored");`,
  },
  {
    id: "default-9",
    name: "Bypass SSL Pinning (All Methods)",
    category: "SSL Bypass",
    createdAt: 0,
    code: `var methods = [
  ["Security", "SecTrustEvaluate"],
  ["Security", "SecTrustEvaluateWithError"],
  ["Security", "SecTrustGetTrustResult"]
];
methods.forEach(function(m) {
  var addr = Module.findExportByName(m[0], m[1]);
  if (addr) {
    Interceptor.replace(addr, new NativeCallback(function() {
      console.log("[SSL] Bypassed " + m[1]);
      return 0;
    }, 'int', ['pointer', 'pointer']));
  }
});
try {
  var NSURLSession = ObjC.classes.NSURLSession;
  var challenges = ["- URLSession:didReceiveChallenge:completionHandler:",
    "- URLSession:task:didReceiveChallenge:completionHandler:"];
  challenges.forEach(function(sel) {
    var resolver = new ApiResolver("objc");
    resolver.enumerateMatches("*[* " + sel.substring(2)).forEach(function(match) {
      try {
        Interceptor.attach(match.address, {
          onEnter: function(args) { console.log("[SSL] Challenge from:", match.name); }
        });
      } catch(e) {}
    });
  });
} catch(e) {}
console.log("[*] SSL Pinning bypass (comprehensive)");`,
  },
  {
    id: "default-10",
    name: "Monitor All Network Requests",
    category: "Network",
    createdAt: 0,
    code: `var NSURLSession = ObjC.classes.NSURLSession;
["- dataTaskWithRequest:completionHandler:",
 "- dataTaskWithURL:completionHandler:",
 "- downloadTaskWithRequest:completionHandler:",
 "- uploadTaskWithRequest:fromData:completionHandler:"].forEach(function(sel) {
  var m = NSURLSession[sel];
  if (m) {
    Interceptor.attach(m.implementation, {
      onEnter: function(args) {
        try {
          var obj = new ObjC.Object(args[2]);
          var url = obj.URL ? obj.URL().absoluteString().toString() : obj.absoluteString().toString();
          var method = obj.HTTPMethod ? obj.HTTPMethod().toString() : "GET";
          console.log("[" + method + "]", url);
          if (obj.allHTTPHeaderFields) {
            var headers = obj.allHTTPHeaderFields();
            if (headers) console.log("  Headers:", headers.toString().substring(0, 300));
          }
        } catch(e) {}
      }
    });
  }
});
console.log("[*] All network requests monitored");`,
  },
  {
    id: "default-11",
    name: "Detect & Bypass Jailbreak Checks",
    category: "Anti-Detection",
    createdAt: 0,
    code: `var jbPaths = ["/Applications/Cydia", "/usr/sbin/sshd", "/bin/bash",
  "/etc/apt", "/private/var/lib/apt", "/usr/bin/ssh", "/Library/MobileSubstrate",
  "/var/lib/cydia", "/usr/libexec/cydia", "/.installed_zydia"];
var fm = ObjC.classes.NSFileManager["- fileExistsAtPath:"];
Interceptor.attach(fm.implementation, {
  onEnter: function(args) {
    this.path = new ObjC.Object(args[2]).toString();
  },
  onLeave: function(ret) {
    if (jbPaths.some(function(p) { return this.path.indexOf(p) !== -1; }.bind(this))
        || this.path.indexOf("substrate") !== -1
        || this.path.indexOf("cydia") !== -1) {
      console.log("[JB-BYPASS]", this.path, "-> NO");
      ret.replace(0);
    }
  }
});
var canOpen = ObjC.classes.UIApplication["- canOpenURL:"];
if (canOpen) {
  Interceptor.attach(canOpen.implementation, {
    onEnter: function(args) {
      this.url = new ObjC.Object(args[2]).absoluteString().toString();
    },
    onLeave: function(ret) {
      if (this.url.indexOf("cydia") !== -1) {
        console.log("[JB-BYPASS] canOpenURL:", this.url, "-> NO");
        ret.replace(0);
      }
    }
  });
}
console.log("[*] Jailbreak detection bypassed");`,
  },
  {
    id: "default-12",
    name: "Detect Frida/Debug Checks",
    category: "Anti-Detection",
    createdAt: 0,
    code: `var ptrace = Module.findExportByName(null, "ptrace");
if (ptrace) {
  Interceptor.attach(ptrace, {
    onEnter: function(args) {
      if (args[0].toInt32() === 31) { // PT_DENY_ATTACH
        console.log("[ANTI-DBG] ptrace(PT_DENY_ATTACH) -> blocked");
        args[0] = ptr(0);
      }
    }
  });
}
var sysctl = Module.findExportByName(null, "sysctl");
if (sysctl) {
  Interceptor.attach(sysctl, {
    onEnter: function(args) { this.args = args; },
    onLeave: function(ret) {
      console.log("[ANTI-DBG] sysctl called");
    }
  });
}
try {
  var dlopen = Module.findExportByName(null, "dlopen");
  if (dlopen) {
    Interceptor.attach(dlopen, {
      onEnter: function(args) {
        var name = args[0].readUtf8String();
        if (name && name.indexOf("frida") !== -1) {
          console.log("[FRIDA-DET] dlopen:", name, "-> blocked");
          args[0] = ptr(0);
        }
      }
    });
  }
} catch(e) {}
console.log("[*] Anti-debug/anti-frida protections bypassed");`,
  },
  {
    id: "default-13",
    name: "Find ViewControllers (UI Map)",
    category: "Enumeration",
    createdAt: 0,
    code: `ObjC.schedule(ObjC.mainQueue, function() {
  var vcs = Object.keys(ObjC.classes).filter(function(cls) {
    try {
      var c = ObjC.classes[cls];
      var chain = [];
      var sup = c;
      while (sup && chain.length < 10) {
        chain.push(sup.$className);
        sup = sup.$superClass;
      }
      return chain.indexOf("UIViewController") !== -1;
    } catch(e) { return false; }
  });
  var dominated = ["UI","_","NS"];
  var appVCs = vcs.filter(function(v) {
    return !dominated.some(function(p) { return v.indexOf(p) === 0; });
  });
  appVCs.sort();
  console.log("[*] App ViewControllers (" + appVCs.length + "):\\n");
  appVCs.forEach(function(vc) {
    var methods = ObjC.classes[vc].$ownMethods.length;
    console.log("  " + vc + " (" + methods + " methods)");
  });
});`,
  },
  {
    id: "default-14",
    name: "Monitor Screen Transitions",
    category: "Tracing",
    createdAt: 0,
    code: `var UIViewController = ObjC.classes.UIViewController;
Interceptor.attach(UIViewController["- viewDidAppear:"].implementation, {
  onEnter: function(args) {
    var vc = new ObjC.Object(args[0]);
    var cls = vc.$className;
    if (cls.indexOf("UI") !== 0 && cls.indexOf("_") !== 0) {
      var title = "";
      try { title = vc.title() ? vc.title().toString() : ""; } catch(e) {}
      console.log("[SCREEN]", cls + (title ? ' ("' + title + '")' : ""));
    }
  }
});
console.log("[*] Monitoring screen transitions (app VCs only)");`,
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

const CATEGORIES = ["All", "Enumeration", "Tracing", "Network", "SSL Bypass", "Anti-Detection", "Custom"];

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
      <div className="flex-shrink-0 px-10 py-6 border-b border-border/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-px w-8 bg-amber-400/40" />
              <span className="text-[10px] font-semibold tracking-[0.2em] text-amber-400/60 uppercase">Toolkit</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">Script Arsenal</h1>
            <p className="text-muted-foreground/60 text-xs mt-1">Save and reuse Frida scripts. Stored locally in your browser.</p>
          </div>
          <Button size="sm" onClick={() => setShowNew(v => !v)} className="rounded-lg">
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

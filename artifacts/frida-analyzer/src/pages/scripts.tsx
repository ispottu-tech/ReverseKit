import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileCode2, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function Scripts() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const scripts = [
    { category: "Class Enumeration", name: "Dump all classes", code: `ObjC.schedule(ObjC.mainQueue, function () {
  console.log("Enumerating classes...");
  var count = 0;
  for (var className in ObjC.classes) {
    console.log(className);
    count++;
  }
  console.log("Total classes found: " + count);
});` },
    { category: "Class Enumeration", name: "Find classes matching pattern", code: `var pattern = "Auth"; // Change pattern
ObjC.schedule(ObjC.mainQueue, function () {
  for (var className in ObjC.classes) {
    if (className.indexOf(pattern) !== -1) {
      console.log("Found: " + className);
    }
  }
});` },
    { category: "Method Tracing", name: "Trace all methods of a class", code: `var targetClass = "ViewController"; // Change class
var resolver = new ApiResolver("objc");
var matches = resolver.enumerateMatches("*[" + targetClass + " *]");
matches.forEach(function (match) {
  try {
    Interceptor.attach(match.address, {
      onEnter: function (args) {
        console.log("[*] Called: " + match.name);
      }
    });
  } catch (e) {}
});` },
    { category: "Method Tracing", name: "Log method arguments", code: `var className = "NSString";
var methodName = "- stringByAppendingString:";
var hook = ObjC.classes[className][methodName];
Interceptor.attach(hook.implementation, {
  onEnter: function(args) {
    var str = new ObjC.Object(args[2]);
    console.log("[*] appending: " + str.toString());
  }
});` },
    { category: "SSL Bypass", name: "Disable SSL pinning (trustkit)", code: `var TrustKit = ObjC.classes.TrustKit;
if (TrustKit) {
  Interceptor.attach(TrustKit['- init'].implementation, {
    onEnter: function(args) {
      console.log("[*] TrustKit initialized. Pinning bypassed.");
    }
  });
}` },
    { category: "SSL Bypass", name: "Disable certificate validation", code: `var tls_helper_create_peer_trust = new NativeFunction(
  Module.findExportByName(null, "tls_helper_create_peer_trust"),
  'int', ['pointer', 'uint', 'pointer']
);
Interceptor.replace(tls_helper_create_peer_trust, new NativeCallback(function(hd, srv, trust) {
  console.log("[*] tls_helper_create_peer_trust bypassed!");
  return 0;
}, 'int', ['pointer', 'uint', 'pointer']));` },
    { category: "Crypto", name: "Hook CommonCrypto functions", code: `var CCCryptorCreate = Module.findExportByName("libSystem.B.dylib", "CCCryptorCreate");
if (CCCryptorCreate) {
  Interceptor.attach(CCCryptorCreate, {
    onEnter: function (args) {
      console.log("[*] CCCryptorCreate called");
      console.log("  Algorithm: " + args[0]);
    }
  });
}` },
    { category: "Network", name: "Log HTTP requests", code: `var NSURLSession = ObjC.classes.NSURLSession;
var hook = NSURLSession['- dataTaskWithRequest:completionHandler:'];
if (hook) {
  Interceptor.attach(hook.implementation, {
    onEnter: function(args) {
      var req = new ObjC.Object(args[2]);
      console.log("[*] HTTP Request: " + req.URL().absoluteString());
    }
  });
}` }
  ];

  const copyToClipboard = (code: string, index: number) => {
    navigator.clipboard.writeText(code);
    toast.success("Script copied to clipboard");
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex-1 overflow-auto p-8 space-y-8 bg-background">
      <div>
        <h1 className="text-4xl font-bold tracking-tight mb-2">Payload Library</h1>
        <p className="text-muted-foreground text-lg">Pre-built Frida injection scripts for common reverse-engineering tasks.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {scripts.map((script, idx) => (
          <Card key={idx} className="border-border/50 bg-card/40 backdrop-blur-sm shadow-lg flex flex-col group hover:border-primary/30 transition-colors">
            <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0 bg-secondary/10">
              <div>
                <CardTitle className="text-lg flex items-center gap-2 font-mono text-primary/90">
                  <FileCode2 className="w-4 h-4 text-primary" />
                  {script.name}
                </CardTitle>
                <CardDescription className="mt-2">
                  <Badge variant="outline" className="font-mono text-[10px] bg-background text-muted-foreground border-border/50">{script.category}</Badge>
                </CardDescription>
              </div>
              <button 
                onClick={() => copyToClipboard(script.code, idx)} 
                className="h-8 w-8 rounded-md bg-background/50 border border-border/50 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
              >
                {copiedIndex === idx ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
              </button>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative">
              <div className="absolute top-0 left-4 w-1 h-full bg-gradient-to-b from-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="bg-black/40 p-5 border-t border-border/50 h-full overflow-x-auto rounded-b-xl">
                <pre className="text-sm font-mono text-muted-foreground leading-relaxed">
                  {script.code}
                </pre>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

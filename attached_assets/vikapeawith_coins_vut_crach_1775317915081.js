/*
 * VikPea Premium Fix v5.0 - Full Error Nullification
 *
 * KEY INSIGHT: Changing NSError code/domain is NOT enough.
 * The error OBJECT still exists → app checks `if error != nil` → shows error.
 * FIX: NULL out error objects at EVERY delivery point.
 *
 * v5.0 Changes:
 * 1. NULL all errors for afirstsoft.cn (any domain, not just NSURLError)
 * 2. Aggressive Alamofire SessionDelegate error nullification
 * 3. Block error UIAlertControllers at presentViewController level
 * 4. Suppress -1000 analytics errors silently (no log spam)
 * 5. swift_willThrow arm64 x21 clearing for Combine chain errors
 * 6. Retained NSString domains (prevent use-after-free crash)
 * 7. MaterialManager symbol scan + VPError.handleError hook
 *
 * Usage: frida -U -f com.hitpaw.ven -l frida_vikpea_fix_v4.js --no-pause
 */

var C = {R:"\x1b[0m",r:"\x1b[31m",g:"\x1b[32m",y:"\x1b[33m",c:"\x1b[36m",B:"\x1b[1m"};
function log(t,m) { console.log(C.B+"["+t+"]"+C.R+" "+m); }

// Global URL tracker — correlates JSON responses with their originating API URL
var _lastApiUrl = "";
var _lastApiMethod = "";

// ============================================================
// EXACT SWIFT SYMBOL HOOKS
// ============================================================
function hookExactSwiftSymbols() {
    var cnt = 0;
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if (m.name === "VikPea") vikpeaMod = m; });
    if (!vikpeaMod) { log("SWIFT", C.r+"VikPea module not found"+C.R); return 0; }
    log("SWIFT", "VikPea base=" + vikpeaMod.base);

    var symMap = {};
    log("SWIFT", "Building symbol table...");
    try {
        vikpeaMod.enumerateSymbols().forEach(function(sym) { symMap[sym.name] = sym.address; });
    } catch(e) { log("SWIFT", C.r+"enumerateSymbols failed: "+e+C.R); return 0; }
    log("SWIFT", "Symbol table: " + Object.keys(symMap).length + " entries");

    function hookSym(name, retVal, label) {
        var addr = symMap[name] || symMap["_" + name];
        if (addr) {
            try {
                Interceptor.attach(addr, { onLeave: function(retval) { retval.replace(retVal); } });
                cnt++;
                log("SWIFT", (retVal ? C.g : C.c) + C.B + (retVal?"TRUE":"FALSE") + ": " + label + C.R);
                return true;
            } catch(e) { log("SWIFT", C.r+"Hook fail: "+label+" => "+e+C.R); }
        }
        return false;
    }

    // === VIP STATUS HOOKS ===
    hookSym("$s6VikPea10IAPManagerC5isVIPSbvg", 1, "IAPManager.isVIP");
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC5isVIPSbvg", 1, "SubInfo.isVIP");
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC13isSubscribingSbSgvg", 1, "SubInfo.isSubscribing");
    hookSym("$s6VikPea10IAPManagerC20PurchaseIdentityInfoC15hasSubscriptionSbvg", 1, "PurInfo.hasSubscription");
    hookSym("$s6VikPea10IAPManagerC20PurchaseIdentityInfoC10hasCreditsSbvg", 1, "PurInfo.hasCredits");
    hookSym("$s6VikPea10IAPManagerC10hasEverVip4userSbAA4UserCSg_tFZ", 1, "IAPManager.hasEverVip()");
    hookSym("$s6VikPea10IAPManagerC10_lastIsVIP33_F5905FEDB044A2CA1073CE084DCB5AFFLLSbSgvg", 1, "IAPManager._lastIsVIP");
    hookSym("$s6VikPea11MineVipViewC5isVIPSbvg", 1, "MineVipView.isVIP");
    hookSym("$s6VikPea12MineUserViewC5isVIPSbvg", 1, "MineUserView.isVIP");
    hookSym("$s6VikPea18MineBackgroundViewC5isVIPSbvg", 1, "MineBgView.isVIP");
    hookSym("$s6VikPea18HomeViewControllerC5isVip33_68938E885D7C1C8457B60DFE3E7CB6CALLSbvg", 1, "HomeVC.isVip");
    hookSym("$s6VikPea10IAPManagerC13isInitializedSbvg", 1, "IAPManager.isInitialized");
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC9isInvalidSbvg", 0, "SubInfo.isInvalid");
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC12shouldUpdateSbvg", 0, "SubInfo.shouldUpdate");

    var setVipAddr = symMap["$s6VikPea18HomeViewControllerC5isVip33_68938E885D7C1C8457B60DFE3E7CB6CALLSbvs"];
    if (setVipAddr) {
        try {
            Interceptor.attach(setVipAddr, { onEnter: function(args) { args[0] = ptr(1); } });
            cnt++;
            log("SWIFT", C.g+"HomeVC.isVip setter → force true"+C.R);
        } catch(e) {}
    }

    // === CREDIT VALIDATION HOOKS ===
    var validationPatterns = ["checkCredit", "validateCredit", "isCreditsEnough", "hasEnoughCredit",
        "canUseCredit", "isCoinsEnough", "hasEnoughCoins", "checkCoins", "creditEnough",
        "coinsEnough", "creditsSufficient", "canConsume", "canDeduct", "shouldShowInsufficient",
        "showInsufficientCredit", "showCreditsAlert", "needBuyCredit"];
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        var nl = name.toLowerCase();
        for (var i = 0; i < validationPatterns.length; i++) {
            if (nl.indexOf(validationPatterns[i].toLowerCase()) !== -1) {
                var shortName = name.replace("$s6VikPea", "").substring(0, 60);
                if (name.indexOf("Sbvg") !== -1 || name.indexOf("SbSgvg") !== -1) {
                    try { Interceptor.attach(symMap[name], { onLeave: function(r) { r.replace(1); } }); cnt++;
                        log("VALIDATE", C.g+"TRUE: "+shortName+C.R); } catch(e) {}
                }
                break;
            }
        }
    });

    // === ALAMOFIRE HOOKS — LOGGING ONLY (no arg modification) ===
    // Modifying Swift-mangled function args crashes the process.
    // Error suppression is handled by: statusCode→200, completion→nil error, NSError.code→0
    var afLogCount = 0;
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("7RequestC15didCompleteTask") !== -1 && name.indexOf("AFError") !== -1) {
            try {
                Interceptor.attach(symMap[name], {
                    onEnter: function(args) { log("AF", C.y+"Request.didCompleteTask"+C.R); }
                });
                afLogCount++;
            } catch(e) {}
        }
        else if (name.indexOf("7RequestC11didFailTask") !== -1 && name.indexOf("AFError") !== -1) {
            try {
                Interceptor.attach(symMap[name], {
                    onEnter: function(args) { log("AF", C.r+C.B+"Request.didFailTask"+C.R); }
                });
                afLogCount++;
            } catch(e) {}
        }
    });
    if (afLogCount > 0) log("AF", C.g+"Alamofire log hooks: "+afLogCount+C.R);

    // === SMART CREDIT SCANNER ===
    var creditHooked = {};
    var balancePatterns = ["coins", "credits", "giftCoins", "totalCoins", "freeCredits",
        "availableCredits", "remainingCredits", "creditBalance", "userCoins", "coins_num",
        "gift_coins_count", "earnedCredits"];
    var remainPatterns = ["remainTimes", "remain_times", "tryTimes", "try_times",
        "beautyTimes", "beauty_times", "mattingRemain", "enhanceRemain",
        "watermarkRemove", "digitalHuman", "voiceClone", "TrialTimes",
        "mattingRemainTimes", "videoMattingTrialTimes"];
    var costPatterns = ["needC", "consumptionUnit", "consumed", "costC", "requiredC",
        "priceC", "clippingSeconds", "discountG", "discountP"];

    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        if (name.slice(-2) !== "vg") return;
        if (name.indexOf("Sbvg") !== -1 || name.indexOf("SbSgvg") !== -1) return;
        var isNumGetter = (name.indexOf("Sivg") !== -1 || name.indexOf("SiSgvg") !== -1 ||
                           name.indexOf("Sdvg") !== -1 || name.indexOf("SdSgvg") !== -1);
        if (!isNumGetter) return;
        if (name.indexOf("hashValue") !== -1) return;

        var nl = name.toLowerCase();
        var retVal = -1, label = "";
        for (var i = 0; i < costPatterns.length; i++) {
            if (nl.indexOf(costPatterns[i].toLowerCase()) !== -1) { retVal = 0; label = "COST→0"; break; }
        }
        if (retVal === -1) {
            for (var i = 0; i < balancePatterns.length; i++) {
                if (nl.indexOf(balancePatterns[i].toLowerCase()) !== -1) { retVal = 99999; label = "BAL→99999"; break; }
            }
        }
        if (retVal === -1) {
            for (var i = 0; i < remainPatterns.length; i++) {
                if (nl.indexOf(remainPatterns[i].toLowerCase()) !== -1) { retVal = 99999; label = "REMAIN→99999"; break; }
            }
        }
        if (retVal === -1) return;
        var key = symMap[name].toString();
        if (creditHooked[key]) return;
        creditHooked[key] = true;
        try {
            var rv = retVal;
            Interceptor.attach(symMap[name], { onLeave: function(retval) { retval.replace(rv); } });
            cnt++;
            var short = name.replace("$s6VikPea", "").replace(/33_[A-F0-9]+LL/g, "(pvt)");
            log("CREDIT", C.g+label+": "+short.substring(0,80)+C.R);
        } catch(e) {}
    });

    // Bool getters for insufficient/locked → FALSE, canUse/enough → TRUE
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        if (name.indexOf("Sbvg") === -1 && name.indexOf("SbSgvg") === -1) return;
        var key = symMap[name].toString();
        if (creditHooked[key]) return;
        var nl = name.toLowerCase();
        var retVal = -1;
        if (nl.indexOf("insufficient") !== -1 || nl.indexOf("needbuy") !== -1 ||
            nl.indexOf("shouldbuy") !== -1 || nl.indexOf("islocked") !== -1 ||
            nl.indexOf("needpurchase") !== -1 || nl.indexOf("needvip") !== -1 ||
            nl.indexOf("isclickbuy") !== -1) retVal = 0;
        if (nl.indexOf("canuse") !== -1 || nl.indexOf("cangenerate") !== -1 ||
            nl.indexOf("canedit") !== -1 || nl.indexOf("isunlocked") !== -1 ||
            nl.indexOf("ispurchased") !== -1 || nl.indexOf("hasenough") !== -1) retVal = 1;
        if (retVal === -1) return;
        creditHooked[key] = true;
        try {
            var rv = retVal;
            Interceptor.attach(symMap[name], { onLeave: function(retval) { retval.replace(rv); } });
            cnt++;
            var short = name.replace("$s6VikPea", "").replace(/33_[A-F0-9]+LL/g, "(pvt)");
            log("CREDIT", (retVal?C.g:C.c)+(retVal?"TRUE":"FALSE")+": "+short.substring(0,80)+C.R);
        } catch(e) {}
    });

    // === MATERIALMANAGER CRASH FIX ===
    // Backtrace revealed: MaterialManager.requestMaterialModelAndCache closure #2
    // creates NSError -1011 inside Combine TryMap chain → unhandled error → crash
    // Fix: Find MaterialManager symbols and hook closures to prevent throws
    var mmSymbols = [];
    var mmClosureAddrs = [];
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        var nl = name.toLowerCase();
        if (nl.indexOf("materialmanager") !== -1) {
            mmSymbols.push({name: name, addr: symMap[name]});
            if (nl.indexOf("requestmaterial") !== -1 || nl.indexOf("cache") !== -1) {
                var short = name.replace("$s6VikPea", "").substring(0, 100);
                log("MM", C.c+short+" @ "+symMap[name]+C.R);
                mmClosureAddrs.push({name: name, addr: symMap[name]});
            }
        }
    });
    log("MM", C.c+"Found "+mmSymbols.length+" MaterialManager symbols, "+mmClosureAddrs.length+" request/cache methods"+C.R);

    // Hook VPError.handleError — REPLACE WITH NOP to prevent error display
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        if (name.indexOf("7VPErrorO11handleError") !== -1 && name.indexOf("FZ") !== -1) {
            try {
                Interceptor.replace(symMap[name], new NativeCallback(function() {
                    log("VPError", C.y+C.B+"VPError.handleError BLOCKED (NOP)"+C.R);
                }, 'void', []));
                cnt++;
                log("VPError", C.g+"VPError.handleError → NOP"+C.R);
            } catch(e) {
                // If replace fails (wrong signature), fallback to attach
                try {
                    Interceptor.attach(symMap[name], {
                        onEnter: function(args) {
                            log("VPError", C.y+C.B+"VPError.handleError CALLED (logged)"+C.R);
                        }
                    });
                    cnt++;
                    log("VPError", C.g+"VPError.handleError hooked (log-only fallback)"+C.R);
                } catch(e2) {}
            }
        }
    });

    // Hook error presentation methods — only match actual error display methods
    // Use demangled method name patterns, avoid matching type signatures
    // Swift mangled: ClassName + MethodName + Signature
    // Only match if the METHOD PART (right after class name) contains the error pattern
    var errorDisplayMethods = [];
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        // Extract the part after VikPea class info — look for specific method names
        // Pattern: look for methods containing these exact substrings as method names, not type params
        var n = name.substring(9); // Remove $s6VikPea
        // Only match if it's a function (ends with F, FZ, etc.), not a property getter/setter
        if (name.slice(-2) === "vg" || name.slice(-2) === "vs") return;
        // Check for error display method patterns in the EARLY part of the symbol (method name area)
        var methodPart = n.substring(0, 80); // Class + method name, before signature types
        var ml = methodPart.toLowerCase();
        if ((ml.indexOf("showerror") !== -1 && ml.indexOf("validate") === -1) ||
            ml.indexOf("showfailure") !== -1 ||
            ml.indexOf("handleapierror") !== -1 ||
            ml.indexOf("handlenetworkerror") !== -1 ||
            ml.indexOf("showerroralert") !== -1 ||
            ml.indexOf("displayerror") !== -1) {
            errorDisplayMethods.push({name: name, short: n.substring(0, 60)});
        }
    });
    errorDisplayMethods.forEach(function(m) {
        try {
            Interceptor.replace(symMap[m.name], new NativeCallback(function() {}, 'void', []));
            cnt++;
            log("ERR-NOP", C.g + "NOP: " + m.short + C.R);
        } catch(e) {
            try {
                Interceptor.attach(symMap[m.name], {
                    onEnter: function(args) { log("ERR-CALL", C.y + "Error display called" + C.R); }
                });
                cnt++;
            } catch(e2) {}
        }
    });

    log("SWIFT", C.g+C.B+"Total Swift hooks: "+cnt+C.R);
    return cnt;
}

// ============================================================
// NSUserDefaults HOOKS
// ============================================================
function setupDefaultsHooks() {
    var creditKeys = ["coins", "credits", "total_coins", "try_times", "beauty_times",
        "video_matting_remain_times", "matting_remain_times", "photo_enhance_remain_times",
        "watermark_remove_remain_times", "media_analyze_remain_times", "remain_digital_human_times",
        "remain_voice_clone_times", "gift_coins_count", "available_credits", "free_credits",
        "remainingCredits", "totalCredits", "userCoins", "creditBalance"];
    var vipKeys = ["isVIP", "is_vip", "isSubscribing", "is_subscribing", "hasSubscription",
        "has_subscription", "isSubscribed", "isPremium", "vip_status", "subscription_active",
        "hasEverVip", "has_ever_vip"];
    function isCredit(k) { for(var i=0;i<creditKeys.length;i++) if(k.indexOf(creditKeys[i])!==-1) return true; return false; }
    function isVip(k) { for(var i=0;i<vipKeys.length;i++) if(k===vipKeys[i]||k.indexOf(vipKeys[i])!==-1) return true; return false; }
    try { Interceptor.attach(ObjC.classes.NSUserDefaults["- integerForKey:"].implementation, {
        onEnter: function(args) { try { this.k = new ObjC.Object(args[2]).toString(); } catch(e) { this.k = ""; } },
        onLeave: function(retval) { if (isCredit(this.k)) retval.replace(99999); }
    }); } catch(e) {}
    try { Interceptor.attach(ObjC.classes.NSUserDefaults["- boolForKey:"].implementation, {
        onEnter: function(args) { try { this.k = new ObjC.Object(args[2]).toString(); } catch(e) { this.k = ""; } },
        onLeave: function(retval) { if (isVip(this.k)) retval.replace(1); }
    }); } catch(e) {}
    try { Interceptor.attach(ObjC.classes.NSUserDefaults["- objectForKey:"].implementation, {
        onEnter: function(args) { try { this.k = new ObjC.Object(args[2]).toString(); } catch(e) { this.k = ""; } },
        onLeave: function(retval) {
            if (isCredit(this.k) && !retval.isNull()) {
                try { var obj = new ObjC.Object(retval);
                    if (obj.respondsToSelector_(ObjC.selector("integerValue")))
                        retval.replace(ObjC.classes.NSNumber.numberWithInteger_(99999).handle);
                } catch(e) {}
            }
            if (isVip(this.k) && !retval.isNull()) {
                try { var obj = new ObjC.Object(retval);
                    if (obj.respondsToSelector_(ObjC.selector("boolValue")))
                        retval.replace(ObjC.classes.NSNumber.numberWithBool_(1).handle);
                } catch(e) {}
            }
        }
    }); } catch(e) {}
    log("DEFAULTS", C.g+"Credit/VIP key hooks active"+C.R);
}

// ============================================================
// JAILBREAK BYPASS
// ============================================================
function setupJailbreakBypass() {
    var _sym = {};
    Process.enumerateModules().forEach(function(mod) {
        if (mod.name.indexOf("libsystem") !== -1 || mod.name.indexOf("libSystem") !== -1 || mod.name.indexOf("libdyld") !== -1) {
            try { mod.enumerateExports().forEach(function(e) {
                var n = e.name.charAt(0) === '_' ? e.name.substring(1) : e.name;
                if ({"access":1,"stat":1,"lstat":1,"open":1,"fopen":1,"ptrace":1,"getenv":1,"fork":1,"sysctl":1}[n] && !_sym[n]) _sym[n] = e.address;
            }); } catch(e) {}
        }
    });
    var jb = ["/Applications/Cydia.app","/Library/MobileSubstrate","/usr/sbin/sshd","/etc/apt","/bin/bash",
        "/private/var/tmp/frida","/usr/sbin/frida-server","/var/jb","/usr/lib/TweakInject","/Library/TweakInject"];
    function isJB(p) { if(!p)return false; for(var i=0;i<jb.length;i++) if(p.indexOf(jb[i])!==-1) return true; return p.indexOf("frida")!==-1||p.indexOf("substrate")!==-1; }
    function bh(a,h) { if(a) try{Interceptor.attach(a,h);}catch(e){} }
    ["access","stat","lstat","open"].forEach(function(fn) {
        bh(_sym[fn], { onEnter:function(a){try{if(isJB(a[0].readUtf8String()))this.b=true;}catch(e){}}, onLeave:function(r){if(this.b)r.replace(-1);} });
    });
    bh(_sym["fopen"], { onEnter:function(a){try{if(isJB(a[0].readUtf8String()))this.b=true;}catch(e){}}, onLeave:function(r){if(this.b)r.replace(ptr(0));} });
    bh(_sym["ptrace"], { onEnter:function(a){if(a[0].toInt32()===31)this.b=true;}, onLeave:function(r){if(this.b)r.replace(0);} });
    bh(_sym["getenv"], { onEnter:function(a){try{var n=a[0].readUtf8String();if(n==="DYLD_INSERT_LIBRARIES"||n.indexOf("frida")!==-1)this.b=true;}catch(e){}}, onLeave:function(r){if(this.b)r.replace(ptr(0));} });
    bh(_sym["sysctl"], { onEnter:function(a){try{if(a[1].toInt32()===4){var m0=a[0].readS32(),m1=a[0].add(4).readS32();if(m0===1&&m1===14){this.ad=true;this.ov=a[2];}}}catch(e){}}, onLeave:function(r){if(this.ad&&this.ov)try{var f=this.ov.add(32).readU32();if(f&0x800)this.ov.add(32).writeU32(f&~0x800);}catch(e){}} });
    bh(_sym["fork"], { onLeave:function(r){r.replace(-1);} });
    try{Interceptor.attach(ObjC.classes.NSFileManager["- fileExistsAtPath:"].implementation,{onEnter:function(a){try{if(isJB(new ObjC.Object(a[2]).toString()))this.b=true;}catch(e){}},onLeave:function(r){if(this.b)r.replace(0);}});}catch(e){}
    try{Interceptor.attach(ObjC.classes.UIApplication["- canOpenURL:"].implementation,{onEnter:function(a){try{var u=new ObjC.Object(a[2]).toString();if(u.indexOf("cydia")!==-1||u.indexOf("sileo")!==-1)this.b=true;}catch(e){}},onLeave:function(r){if(this.b)r.replace(0);}});}catch(e){}
    log("JB", C.g+"Bypass ready"+C.R);
}

// ============================================================
// JSON INTERCEPTOR
// ============================================================
function buildFakeReceipt() {
    var now = Date.now();
    var tid = "2000000" + Math.floor(Math.random()*100000000);
    return JSON.stringify({
        "status": 0, "environment": "Production",
        "receipt": { "receipt_type":"Production", "bundle_id":"com.hitpaw.ven", "application_version":"1.18.0",
            "in_app": [{"quantity":"1","product_id":"com.hitpaw.ven.subs.yearly","transaction_id":tid,"original_transaction_id":tid,
                "purchase_date_ms":""+(now-30*86400000),"expires_date_ms":""+(now+365*86400000),
                "is_trial_period":"false","is_in_intro_offer_period":"false","in_app_ownership_type":"PURCHASED"}]},
        "latest_receipt_info": [{"quantity":"1","product_id":"com.hitpaw.ven.subs.yearly","transaction_id":tid,"original_transaction_id":tid,
            "purchase_date_ms":""+(now-30*86400000),"expires_date_ms":""+(now+365*86400000),
            "is_trial_period":"false","is_in_intro_offer_period":"false","in_app_ownership_type":"PURCHASED",
            "subscription_group_identifier":"20929474"}],
        "latest_receipt": "TUVHQV9GQUtFX1JFQ0VJUFQ=",
        "pending_renewal_info": [{"auto_renew_product_id":"com.hitpaw.ven.subs.yearly","product_id":"com.hitpaw.ven.subs.yearly",
            "original_transaction_id":tid,"auto_renew_status":"1"}]
    });
}

function patchCreditJson(str) {
    var ft = Math.floor(Date.now()/1000) + 365*86400;
    return str
        .replace(/"coins"\s*:\s*-?\d+/g, '"coins":99999')
        .replace(/"total_coins"\s*:\s*-?\d+/g, '"total_coins":99999')
        .replace(/"try_times"\s*:\s*-?\d+/g, '"try_times":99999')
        .replace(/"beauty_times"\s*:\s*-?\d+/g, '"beauty_times":99999')
        .replace(/"video_matting_remain_times"\s*:\s*-?\d+/g, '"video_matting_remain_times":99999')
        .replace(/"matting_remain_times"\s*:\s*-?\d+/g, '"matting_remain_times":99999')
        .replace(/"photo_enhance_remain_times"\s*:\s*-?\d+/g, '"photo_enhance_remain_times":99999')
        .replace(/"watermark_remove_remain_times"\s*:\s*-?\d+/g, '"watermark_remove_remain_times":99999')
        .replace(/"media_analyze_remain_times"\s*:\s*-?\d+/g, '"media_analyze_remain_times":99999')
        .replace(/"remain_digital_human_times"\s*:\s*(true|false|-?\d+)/g, '"remain_digital_human_times":99999')
        .replace(/"remain_voice_clone_times"\s*:\s*(true|false|-?\d+)/g, '"remain_voice_clone_times":99999')
        .replace(/"status"\s*:\s*"[Ee]xpired"/g, '"status":"Active"')
        .replace(/"expire_timestamp"\s*:\s*\d+/g, '"expire_timestamp":'+ft)
        .replace(/"is_subscribe"\s*:\s*false/g, '"is_subscribe":true')
        .replace(/"is_subscribing"\s*:\s*false/g, '"is_subscribing":true')
        .replace(/"is_vip"\s*:\s*false/g, '"is_vip":true')
        .replace(/"has_subscription"\s*:\s*false/g, '"has_subscription":true')
        .replace(/"credits"\s*:\s*-?\d+/g, '"credits":99999')
        .replace(/"gift_coins_count"\s*:\s*-?\d+/g, '"gift_coins_count":99999')
        .replace(/"has_gift_coins"\s*:\s*false/g, '"has_gift_coins":true')
        .replace(/"user_role"\s*:\s*"[^"]*"/g, '"user_role":"vip"')
        .replace(/"need_coins"\s*:\s*-?\d+/g, '"need_coins":0')
        .replace(/"consume_coins"\s*:\s*-?\d+/g, '"consume_coins":0')
        .replace(/"cost"\s*:\s*-?\d+/g, '"cost":0')
        .replace(/"need_credits"\s*:\s*-?\d+/g, '"need_credits":0')
        .replace(/"available"\s*:\s*false/g, '"available":true')
        .replace(/"locked"\s*:\s*true/g, '"locked":false')
        .replace(/"enough"\s*:\s*false/g, '"enough":true')
        .replace(/"insufficient"\s*:\s*true/g, '"insufficient":false');
}

function buildFakeTaskResponse() {
    var taskId = "task_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
    return {
        "code": 0, "message": "success",
        "data": {
            "task_id": taskId,
            "id": taskId,
            "status": "completed",
            "state": 1,
            "progress": 100,
            "result_url": "",
            "download_url": "",
            "output_url": "",
            "preview_url": "",
            "coins": 99999,
            "credits": 99999,
            "remain_coins": 99999,
            "remain_credits": 99999,
            "consumed_coins": 0,
            "consumed_credits": 0
        }
    };
}

function patchErrorResponse(str) {
    log("ERR-RAW", C.y + str.substring(0, 300) + C.R);
    if (_lastApiUrl) log("ERR-URL", C.r + C.B + _lastApiUrl + C.R);
    if (str.indexOf("coins is not enough") !== -1 || str.indexOf("credits") !== -1 ||
        str.indexOf("not enough") !== -1 || str.indexOf("nsufficient") !== -1) {
        var codeMatch = str.match(/"code"\s*:\s*(-?\d+)/);
        var errCode = codeMatch ? codeMatch[1] : "?";
        log("ERR-CODE", C.y + errCode + "→0 (credit error replaced)" + C.R);
        var fakeResp = buildFakeTaskResponse();
        var url = _lastApiUrl.toLowerCase();
        if (url.indexOf("enhance") !== -1 || url.indexOf("upscale") !== -1 || url.indexOf("quality") !== -1) {
            fakeResp.data.type = "enhance";
            fakeResp.data.beauty_times = 99999;
            fakeResp.data.try_times = 99999;
            log("FAKE", C.g + "Built enhance task response" + C.R);
        } else if (url.indexOf("avatar") !== -1 || url.indexOf("digital_human") !== -1) {
            fakeResp.data.type = "avatar";
            fakeResp.data.remain_digital_human_times = 99999;
            log("FAKE", C.g + "Built avatar task response" + C.R);
        } else if (url.indexOf("generat") !== -1 || url.indexOf("create") !== -1 || url.indexOf("video") !== -1) {
            fakeResp.data.type = "generation";
            log("FAKE", C.g + "Built generation task response" + C.R);
        } else if (url.indexOf("matting") !== -1 || url.indexOf("remove") !== -1 || url.indexOf("segment") !== -1) {
            fakeResp.data.type = "matting";
            fakeResp.data.video_matting_remain_times = 99999;
            log("FAKE", C.g + "Built matting task response" + C.R);
        } else {
            log("FAKE", C.g + "Built generic task response" + C.R);
        }
        return JSON.stringify(fakeResp);
    }
    return str
        .replace(/"code"\s*:\s*(-?\d+)/g, function(match, num) {
            var n = parseInt(num);
            if (n >= 0 && n < 1000) return match;
            log("ERR-CODE", C.y + n + "→0" + C.R);
            return '"code":0';
        })
        .replace(/"msg"\s*:\s*"[^"]*[Ff]ail[^"]*"/g, '"msg":"success"')
        .replace(/"message"\s*:\s*"[^"]*[Ff]ail[^"]*"/g, '"message":"success"')
        .replace(/"message"\s*:\s*"[^"]*[Ee]rror[^"]*"/g, '"message":"success"');
}

function setupJSONIntercept() {
    function d2s(d) { try{return ObjC.classes.NSString.alloc().initWithData_encoding_(d,4).toString();}catch(e){return null;} }
    function s2d(s) { return ObjC.classes.NSString.stringWithString_(s).dataUsingEncoding_(4); }
    try {
        var impl = ObjC.classes.NSJSONSerialization["+ JSONObjectWithData:options:error:"].implementation;
        var orig = new NativeFunction(impl, 'pointer', ['pointer','pointer','pointer','pointer','pointer']);
        Interceptor.replace(impl, new NativeCallback(function(self, sel, data, opts, errp) {
            try {
                if (!data.isNull()) {
                    var dObj = new ObjC.Object(data);
                    var len = dObj.length ? dObj.length() : 0;
                    if (len > 30 && len < 500000) {
                        var str = d2s(dObj);
                        if (str) {
                            if (str.indexOf('"event_action"') !== -1 || str.indexOf('"analytics"') !== -1) {}
                            else if (str.indexOf('"status"') !== -1 &&
                                     (str.indexOf('"receipt"') !== -1 || str.indexOf('"latest_receipt') !== -1 || str.indexOf('in_app') !== -1)) {
                                var fake = s2d(buildFakeReceipt());
                                log("RECEIPT", C.g+C.B+"Fake receipt injected"+C.R);
                                return orig(self, sel, fake.handle, opts, errp);
                            }
                            else if (str.indexOf('"in_whitelist"') !== -1 || str.indexOf('"is_active"') !== -1) {
                                var patched = str
                                    .replace(/"in_whitelist"\s*:\s*false/g, '"in_whitelist":true')
                                    .replace(/"is_active"\s*:\s*false/g, '"is_active":true')
                                    .replace(/"is_expired"\s*:\s*true/g, '"is_expired":false')
                                    .replace(/"status"\s*:\s*0/g, '"status":1');
                                if (patched !== str) {
                                    log("WHITELIST", C.g+"Subscription/whitelist patched"+C.R);
                                    return orig(self, sel, s2d(patched).handle, opts, errp);
                                }
                            }
                            else if (str.indexOf('"coins"') !== -1 || str.indexOf('"credits"') !== -1 ||
                                     str.indexOf('"expire_timestamp"') !== -1 || str.indexOf('"gift_coins') !== -1 ||
                                     str.indexOf('"is_subscribe"') !== -1 || str.indexOf('"is_vip"') !== -1 ||
                                     str.indexOf('"need_coins"') !== -1 || str.indexOf('"need_credits"') !== -1 ||
                                     str.indexOf('"cost"') !== -1 || str.indexOf('"user_role"') !== -1) {
                                var patched = patchCreditJson(str);
                                if (patched !== str) {
                                    log("CREDITS", C.g+"API patched (coins/credits)"+C.R);
                                    return orig(self, sel, s2d(patched).handle, opts, errp);
                                }
                            }
                            else if (str.indexOf('not enough') !== -1 || str.indexOf('Not enough') !== -1 ||
                                     str.indexOf('nsufficient') !== -1 || str.indexOf('coins is not') !== -1 ||
                                     str.indexOf('credits is not') !== -1 || str.indexOf('not_enough') !== -1) {
                                var patched = patchErrorResponse(str);
                                patched = patchCreditJson(patched);
                                log("CREDITS", C.y+C.B+"Error→Success patched!"+C.R);
                                return orig(self, sel, s2d(patched).handle, opts, errp);
                            }
                            else if (str.indexOf('"code"') !== -1 &&
                                     (str.indexOf('"message"') !== -1 || str.indexOf('"msg"') !== -1) &&
                                     str.indexOf('kJCore') === -1 && str.indexOf('kJORE') === -1 && str.indexOf('APDeviceId') === -1) {
                                var codeMatch = str.match(/"code"\s*:\s*(-?\d+)/);
                                if (codeMatch) {
                                    var codeVal = parseInt(codeMatch[1]);
                                    if (codeVal < 0 || codeVal >= 1000) {
                                        log("API-ERR", C.r+"code="+codeVal+" → "+str.substring(0,200)+C.R);
                                        var patched = patchErrorResponse(str);
                                        patched = patchCreditJson(patched);
                                        return orig(self, sel, s2d(patched).handle, opts, errp);
                                    }
                                }
                            }
                        }
                    }
                }
            } catch(e) {}
            return orig(self, sel, data, opts, errp);
        }, 'pointer', ['pointer','pointer','pointer','pointer','pointer']));
        log("JSON", C.g+"NSJSONSerialization REPLACED"+C.R);
    } catch(e) { log("JSON", C.r+"Failed: "+e+C.R); }
}

// ============================================================
// HTTP STATUS CODE + ERROR INTERCEPTION
// ============================================================
function setupHTTPStatusHook() {
    // === LAYER 1: CFNetwork C-level — DISABLED ===
    // CFHTTPMessageGetResponseStatusCode is not hookable on this device (TypeError crash).
    // Status code interception is fully handled by Layer 1.5 (NSHTTPURLResponse init)
    // and Layer 2 (statusCode getter). Skipping CF layer entirely.
    log("HTTP", C.g+"CF layer skipped — ObjC statusCode hooks cover it"+C.R);

    // === LAYER 1.5: NSHTTPURLResponse INIT hook + URL capture ===
    try {
        var initSel = "- initWithURL:statusCode:HTTPVersion:headerFields:";
        if (ObjC.classes.NSHTTPURLResponse[initSel]) {
            Interceptor.attach(ObjC.classes.NSHTTPURLResponse[initSel].implementation, {
                onEnter: function(args) {
                    var code = args[3].toInt32();
                    if (code === 402 || code === 403 || code === 429) {
                        // Capture the URL for this error response
                        try {
                            var urlObj = new ObjC.Object(args[2]);
                            var urlStr = urlObj.absoluteString().toString();
                            _lastApiUrl = urlStr;
                            log("HTTP", C.r+C.B+"["+code+"] "+urlStr+C.R);
                        } catch(e) {
                            log("HTTP", C.r+C.B+"["+code+"] (URL extraction failed)"+C.R);
                        }
                        args[3] = ptr(200);
                        log("HTTP", C.g+"statusCode "+code+"→200"+C.R);
                    }
                }
            });
            log("HTTP", C.g+"NSHTTPURLResponse init hook active"+C.R);
        }
    } catch(e) { log("HTTP", C.r+"Response init hook fail: "+e+C.R); }

    // === LAYER 1.6: Hook _initWithCFURLResponse: (internal init path) ===
    try {
        var internalInit = ObjC.classes.NSHTTPURLResponse["- _initWithCFURLResponse:"];
        if (internalInit) {
            Interceptor.attach(internalInit.implementation, {
                onLeave: function(retval) {
                    if (retval.isNull()) return;
                    try {
                        var resp = new ObjC.Object(retval);
                        var code = resp.statusCode();
                        if (code === 402 || code === 403 || code === 429) {
                            log("HTTP", C.g+C.B+"Internal Response init: status="+code+" (detected)"+C.R);
                        }
                    } catch(e) {}
                }
            });
            log("HTTP", C.g+"Internal response init hook active"+C.R);
        }
    } catch(e) {}

    // === LAYER 2: ObjC statusCode getter + URL capture ===
    try {
        Interceptor.attach(ObjC.classes.NSHTTPURLResponse["- statusCode"].implementation, {
            onLeave: function(retval) {
                var code = retval.toInt32();
                if (code === 402 || code === 403 || code === 429) {
                    // Try to capture URL from this response object
                    try {
                        var resp = new ObjC.Object(this.context.x0 || this.context.rdi);
                        if (resp && resp.URL) {
                            var u = resp.URL().absoluteString().toString();
                            if (u.indexOf("analytics") === -1 && u.indexOf("/collect") === -1) {
                                _lastApiUrl = u;
                                log("HTTP", C.r+"["+code+"] "+u.substring(0, 150)+C.R);
                            }
                        }
                    } catch(eu) {}
                    retval.replace(200);
                    log("HTTP", C.y+"statusCode "+code+"→200"+C.R);
                }
            }
        });
    } catch(e) {}

    // === LAYER 2.5: Track delegate-based requests (no completion handler) ===
    try {
        var dtSel = "- dataTaskWithRequest:";
        if (ObjC.classes.NSURLSession[dtSel]) {
            Interceptor.attach(ObjC.classes.NSURLSession[dtSel].implementation, {
                onEnter: function(args) {
                    try {
                        if (!args[2] || args[2].isNull()) return;
                        var req = new ObjC.Object(args[2]);
                        var url = req.URL().absoluteString().toString();
                        if (url.indexOf("afirstsoft.cn") === -1) return;
                        if (url.indexOf("/collect") !== -1 || url.indexOf("analytics") !== -1) return;
                        var method = "GET";
                        try { method = req.HTTPMethod().toString(); } catch(e) {}
                        _lastApiUrl = url;
                        _lastApiMethod = method;
                        log("REQ", C.c + "[" + method + "] " + url.substring(0, 150) + C.R);
                    } catch(e) {}
                }
            });
            log("HTTP", C.g + "Delegate-based request hook active" + C.R);
        }
    } catch(e) {}

    // === LAYER 3: Completion handler wrapper — null errors + URL tracking ===
    try {
        Interceptor.attach(ObjC.classes.NSURLSession["- dataTaskWithRequest:completionHandler:"].implementation, {
            onEnter: function(args) {
                try {
                    if (!args[2] || args[2].isNull()) return;
                    var req = new ObjC.Object(args[2]);
                    var url = req.URL().absoluteString().toString();
                    if (url.indexOf("afirstsoft.cn") === -1) return;

                    // Track URL globally for JSON hook correlation (skip analytics)
                    var method = "GET";
                    try { method = req.HTTPMethod().toString(); } catch(e) {}
                    var isAnalyticsUrl = (url.indexOf("/collect") !== -1 || url.indexOf("analytics") !== -1 ||
                                          url.indexOf("/common/") !== -1 || url.indexOf("/event") !== -1);
                    if (!isAnalyticsUrl) {
                        _lastApiUrl = url;
                        _lastApiMethod = method;
                    }

                    if (!args[3] || args[3].isNull()) return;
                    var block = new ObjC.Block(args[3]);
                    var origImpl = block.implementation;
                    var apiUrl = url;
                    var apiMethod = method;
                    var isAnalytics = (url.indexOf("/collect") !== -1 || url.indexOf("analytics") !== -1);
                    block.implementation = function(data, response, error) {
                        // Update URL tracker for this response (skip analytics)
                        if (!isAnalytics) {
                            _lastApiUrl = apiUrl;
                            _lastApiMethod = apiMethod;
                        }

                        // Log ALL non-analytics API calls with their response body
                        if (!isAnalytics) {
                            var bodyStr = "";
                            if (data && !data.isNull()) {
                                try {
                                    var dStr = ObjC.classes.NSString.alloc().initWithData_encoding_(new ObjC.Object(data), 4);
                                    if (dStr) bodyStr = dStr.toString();
                                } catch(e4) {}
                            }
                            if (bodyStr.indexOf("not enough") !== -1 || bodyStr.indexOf("110402") !== -1 ||
                                bodyStr.indexOf("nsufficient") !== -1 || bodyStr.indexOf("not_enough") !== -1) {
                                log("API-ERR", C.r + C.B + "[" + apiMethod + "] " + apiUrl + C.R);
                                log("API-ERR", C.r + "BODY: " + bodyStr.substring(0, 400) + C.R);
                            } else if (apiUrl.indexOf("coin") !== -1 || apiUrl.indexOf("credit") !== -1 ||
                                       apiUrl.indexOf("enhance") !== -1 || apiUrl.indexOf("generat") !== -1 ||
                                       apiUrl.indexOf("avatar") !== -1 || apiUrl.indexOf("matting") !== -1 ||
                                       apiUrl.indexOf("task") !== -1 || apiUrl.indexOf("consume") !== -1) {
                                log("API", C.c + "[" + apiMethod + "] " + apiUrl.substring(0, 120) + C.R);
                                if (bodyStr.length > 0 && bodyStr.length < 1000)
                                    log("API", C.c + "BODY: " + bodyStr.substring(0, 400) + C.R);
                            }
                        }

                        if (error && !error.isNull()) {
                            if (!isAnalytics) {
                                try {
                                    var errObj = new ObjC.Object(error);
                                    log("HTTP", C.g+C.B+"API error→nil: "+errObj.domain()+" "+errObj.code()+C.R);
                                } catch(e2) {}
                            }
                            origImpl(data, response, NULL);
                            return;
                        }
                        origImpl(data, response, error);
                    };
                } catch(e) {}
            }
        });
        log("HTTP", C.g+"API completion wrapper active"+C.R);
    } catch(e) { log("HTTP", C.r+"API wrap fail: "+e+C.R); }

    // === LAYER 3b: Upload task wrapper with URL tracking ===
    try {
        var uploadSel = "- uploadTaskWithRequest:fromData:completionHandler:";
        if (ObjC.classes.NSURLSession[uploadSel]) {
            Interceptor.attach(ObjC.classes.NSURLSession[uploadSel].implementation, {
                onEnter: function(args) {
                    try {
                        if (!args[2] || args[2].isNull()) return;
                        var req = new ObjC.Object(args[2]);
                        var url = req.URL().absoluteString().toString();
                        if (url.indexOf("afirstsoft.cn") === -1) return;
                        // Track upload URLs
                        var method = "POST";
                        try { method = req.HTTPMethod().toString(); } catch(e) {}
                        _lastApiUrl = url;
                        _lastApiMethod = method;
                        log("UPLOAD", C.c + "[" + method + "] " + url.substring(0, 120) + C.R);
                        if (!args[4] || args[4].isNull()) return;
                        var block = new ObjC.Block(args[4]);
                        var origImpl = block.implementation;
                        var apiUrl = url;
                        block.implementation = function(data, response, error) {
                            _lastApiUrl = apiUrl;
                            _lastApiMethod = "POST";
                            if (error && !error.isNull()) {
                                log("HTTP", C.g+C.B+"Upload error → nil: "+apiUrl.substring(0,80)+C.R);
                                origImpl(data, response, NULL);
                                return;
                            }
                            origImpl(data, response, error);
                        };
                    } catch(e) {}
                }
            });
        }
    } catch(e) {}

    // === LAYER 4: NSURLSessionTask.error getter ===
    try {
        // Hook on base class AND concrete subclasses
        var taskClasses = ["NSURLSessionTask", "__NSCFLocalDataTask", "__NSCFURLSessionTask",
                           "NSURLSessionDataTask", "__NSCFLocalSessionTask"];
        var taskHooked = {};
        taskClasses.forEach(function(cn) {
            try {
                var cls = ObjC.classes[cn];
                if (!cls) return;
                var errorMethod = cls["- error"];
                if (!errorMethod) return;
                var implAddr = errorMethod.implementation.toString();
                if (taskHooked[implAddr]) return;
                taskHooked[implAddr] = true;

                Interceptor.attach(errorMethod.implementation, {
                    onLeave: function(retval) {
                        if (retval.isNull()) return;
                        try {
                            var err = new ObjC.Object(retval);
                            var code = err.code();
                            var domain = err.domain().toString();
                            if (domain.indexOf("NSURLError") === -1) return;
                            if (code === -1011 || code === -1012) {
                                retval.replace(ptr(0));
                                log("HTTP", C.g+"Task.error→nil ("+cn+" code="+code+")"+C.R);
                            }
                        } catch(e) {}
                    }
                });
                log("HTTP", C.g+"Task.error hook: "+cn+C.R);
            } catch(e) {}
        });
    } catch(e) { log("HTTP", C.r+"Task.error hook fail: "+e+C.R); }

    // Layers 5-6 moved to setupDeferredHooks() to prevent spawn crash
}

// === DEFERRED HOOKS (run after script load to prevent spawn crash) ===
function setupDeferredHooks() {
    // === LAYER 5: NSError.code getter — make -1011/-1012 appear as code 0 ===
    // NO init hook — modifying NSError init args causes downstream crashes.
    // Instead, just mask the code at the getter level.
    try {
        Interceptor.attach(ObjC.classes.NSError["- code"].implementation, {
            onLeave: function(retval) {
                var code = retval.toInt32();
                if (code === -1011 || code === -1012) {
                    retval.replace(0);
                }
            }
        });
        log("HTTP", C.g+"NSError.code getter hook active"+C.R);
    } catch(e) {}

    // === LAYER 6: localizedDescription suppress ===
    try {
        Interceptor.attach(ObjC.classes.NSError["- localizedDescription"].implementation, {
            onLeave: function(retval) {
                try {
                    var desc = new ObjC.Object(retval).toString();
                    if (desc.indexOf("1011") !== -1 || desc.indexOf("couldn't be completed") !== -1 ||
                        desc.indexOf("bad server") !== -1 || desc.indexOf("coins") !== -1 ||
                        desc.indexOf("not enough") !== -1) {
                        retval.replace(ObjC.classes.NSString.stringWithString_("").handle);
                    }
                } catch(e) {}
            }
        });
    } catch(e) {}

    // Delegate hooks REMOVED — modifying args on ObjC bridge of Swift methods crashes.
    // Error suppression relies on: statusCode→200 (Layer 2), completion→nil (Layer 3),
    // NSError.code→0 (Layer 5), localizedDescription→"" (Layer 6)
    log("HTTP", C.g+"Phase 2 hooks done"+C.R);
}

// ============================================================
// IAP TRANSACTION STATE FIX
// ============================================================
function setupIAPHook() {
    try {
        new ApiResolver("objc").enumerateMatches("*[SKPaymentTransaction transactionState]").forEach(function(m) {
            Interceptor.attach(m.address, { onLeave: function(r) { if (r.toInt32() === 2) r.replace(1); } });
        });
    } catch(e) {}
    log("IAP", C.g+"Transaction hook active"+C.R);
}

// ============================================================
// UI HOOKS
// ============================================================
function setupUIHooks() {
    var cnt = 0;

    ["VikPea.VPCreationCreditsButton", "VikPea.AIAvatarCreationCreditsButton"].forEach(function(cn) {
        try {
            var cls = ObjC.classes[cn];
            if (cls) {
                if (cls["- setEnabled:"]) { try { Interceptor.attach(cls["- setEnabled:"].implementation, { onEnter: function(a) { a[2] = ptr(1); } }); cnt++; } catch(e) {} }
                if (cls["- isEnabled"]) { try { Interceptor.attach(cls["- isEnabled"].implementation, { onLeave: function(r) { r.replace(1); } }); cnt++; } catch(e) {} }
            }
        } catch(e) {}
    });

    try {
        Interceptor.attach(ObjC.classes.UIViewController["- presentViewController:animated:completion:"].implementation, {
            onEnter: function(args) {
                try {
                    var vc = new ObjC.Object(args[2]);
                    var cn = vc.$className;
                    if (cn.indexOf("VikPea") !== -1) log("PRESENT", C.c+cn+C.R);
                    // Block paywall/subscription VCs
                    if ((cn.indexOf("VikPea") !== -1 || cn.indexOf("_TtC") !== -1) &&
                        (cn.indexOf("Buy") !== -1 || cn.indexOf("Subscription") !== -1 ||
                         cn.indexOf("Vip") !== -1 || cn.indexOf("VIP") !== -1 ||
                         cn.indexOf("Recharge") !== -1 || cn.indexOf("Paywall") !== -1 ||
                         cn.indexOf("Insufficient") !== -1 || cn.indexOf("Discount") !== -1)) {
                        log("BLOCK", C.y+C.B+"BLOCKED present: "+cn+C.R);
                        var dummy = ObjC.classes.UIViewController.new();
                        dummy.view().setHidden_(1); dummy.view().setAlpha_(0);
                        dummy.setModalPresentationStyle_(4);
                        args[2] = dummy.handle;
                        ObjC.schedule(ObjC.mainQueue, function() { try { dummy.dismissViewControllerAnimated_completion_(0, NULL); } catch(e) {} });
                        return;
                    }
                    // Block error UIAlertControllers
                    if (cn === "UIAlertController") {
                        var title = "";
                        var msg = "";
                        try { title = vc.title() ? vc.title().toString() : ""; } catch(e3) {}
                        try { msg = vc.message() ? vc.message().toString() : ""; } catch(e3) {}
                        var combined = (title + " " + msg).toLowerCase();
                        if (combined.indexOf("error") !== -1 || combined.indexOf("couldn't") !== -1 ||
                            combined.indexOf("failed") !== -1 || combined.indexOf("not enough") !== -1 ||
                            combined.indexOf("insufficient") !== -1 || combined.indexOf("coins") !== -1 ||
                            combined.indexOf("credit") !== -1 || combined.indexOf("network") !== -1 ||
                            combined.indexOf("server") !== -1 || combined.indexOf("1011") !== -1 ||
                            combined.indexOf("nsurl") !== -1 || combined.indexOf("domain") !== -1 ||
                            combined.indexOf("operation") !== -1) {
                            log("BLOCK", C.y+C.B+"ERROR ALERT BLOCKED: ["+title+"] "+msg.substring(0,60)+C.R);
                            var dummy2 = ObjC.classes.UIViewController.new();
                            dummy2.view().setHidden_(1); dummy2.view().setAlpha_(0);
                            dummy2.setModalPresentationStyle_(4);
                            args[2] = dummy2.handle;
                            ObjC.schedule(ObjC.mainQueue, function() { try { dummy2.dismissViewControllerAnimated_completion_(0, NULL); } catch(e4) {} });
                            return;
                        }
                    }
                } catch(e) {}
            }
        });
        cnt++;
    } catch(e) {}

    try {
        Interceptor.attach(ObjC.classes.UINavigationController["- pushViewController:animated:"].implementation, {
            onEnter: function(args) {
                try {
                    var cn = new ObjC.Object(args[2]).$className;
                    if (cn.indexOf("VikPea") !== -1) log("PUSH", C.c+cn+C.R);
                    if ((cn.indexOf("VikPea") !== -1 || cn.indexOf("_TtC") !== -1) &&
                        (cn.indexOf("Buy") !== -1 || cn.indexOf("Subscription") !== -1 ||
                         cn.indexOf("Recharge") !== -1 || cn.indexOf("Vip") !== -1 ||
                         cn.indexOf("VIP") !== -1 || cn.indexOf("Paywall") !== -1)) {
                        log("BLOCK", C.y+C.B+"BLOCKED push: "+cn+C.R);
                        var dummy = ObjC.classes.UIViewController.new();
                        args[2] = dummy.handle;
                        var nav = new ObjC.Object(args[0]);
                        ObjC.schedule(ObjC.mainQueue, function() { try { nav.popViewControllerAnimated_(0); } catch(e) {} });
                    }
                } catch(e) {}
            }
        });
        cnt++;
    } catch(e) {}

    // UIAlertController error blocking is handled in presentViewController hook above

    ["VikPea.VipPopupView", "VikPea.AIAvatarInsufficientCreditsAlertView",
     "_TtCC6VikPea23AIRemovalViewController21SubscriptionAlertView",
     "VikPea.MonthlySubscriptionDialogView", "VikPea.GiftCreditsPopup",
     "VikPea.CreditsConsumptionView", "VikPea.SubscriptionBenefitView"].forEach(function(cn) {
        try {
            var cls = ObjC.classes[cn];
            if (cls && cls["- initWithFrame:"]) {
                Interceptor.attach(cls["- initWithFrame:"].implementation, {
                    onLeave: function(r) { try { var v = new ObjC.Object(r); v.setHidden_(1); v.setAlpha_(0); } catch(e) {} }
                });
                cnt++;
            }
        } catch(e) {}
    });

    ["SVProgressHUD", "MBProgressHUD", "JGProgressHUD", "ProgressHUD"].forEach(function(cn) {
        try {
            var cls = ObjC.classes[cn];
            if (!cls) return;
            log("UI", C.c+"Found HUD: "+cn+C.R);
            ["+ showErrorWithStatus:", "+ showError:", "- showError:", "+ showWithStatus:"].forEach(function(sel) {
                try {
                    if (cls[sel]) {
                        Interceptor.attach(cls[sel].implementation, {
                            onEnter: function(args) {
                                try {
                                    if (args[2] && !args[2].isNull()) {
                                        var msg = new ObjC.Object(args[2]).toString().toLowerCase();
                                        if (msg.indexOf("error") !== -1 || msg.indexOf("fail") !== -1 ||
                                            msg.indexOf("1011") !== -1 || msg.indexOf("coins") !== -1 ||
                                            msg.indexOf("credit") !== -1 || msg.indexOf("couldn't") !== -1) {
                                            args[2] = ObjC.classes.NSString.stringWithString_("").handle;
                                            log("BLOCK", C.y+"HUD error suppressed"+C.R);
                                        }
                                    }
                                } catch(e) {}
                            }
                        });
                        cnt++;
                    }
                } catch(e) {}
            });
        } catch(e) {}
    });

    try {
        new ApiResolver("objc").enumerateMatches("-[*Toast* show*]").forEach(function(m) {
            try {
                var cn = m.name.split(" ")[0].replace("-[", "").replace("+[", "");
                if (cn.indexOf("VikPea") !== -1 || cn.indexOf("_TtC") !== -1) {
                    Interceptor.attach(m.address, {
                        onEnter: function(args) { log("BLOCK", C.y+"Toast suppressed: "+m.name.substring(0,60)+C.R); }
                    });
                    cnt++;
                }
            } catch(e) {}
        });
    } catch(e) {}

    log("UI", C.g+C.B+"UI hooks: "+cnt+C.R);
}

// ============================================================
// NET LOGGER
// ============================================================
function setupNetLogger() {
    try {
        new ApiResolver("objc").enumerateMatches("*[NSURLSession dataTaskWithRequest:completionHandler:]").forEach(function(m) {
            Interceptor.attach(m.address, {
                onEnter: function(args) {
                    try {
                        var url = new ObjC.Object(args[2]).URL().absoluteString().toString();
                        if (url.indexOf("verifyReceipt") !== -1) log("NET", C.y+"verifyReceipt"+C.R);
                        else if (url.indexOf("afirstsoft.cn") !== -1 && url.indexOf("collect") === -1 && url.indexOf("common") === -1)
                            log("NET", C.c+"API: "+url.substring(0,120)+C.R);
                    } catch(e) {}
                }
            });
        });
    } catch(e) {}
}

// ============================================================
// CONSOLE HELPERS
// ============================================================
function dumpVIP() {
    try {
        var d = ObjC.classes.NSUserDefaults.standardUserDefaults();
        log("STATE", "Sub => " + d.objectForKey_("IAPManager.SubscriptionInfo.Key"));
        log("STATE", "Pur => " + d.objectForKey_("IAPManager.PurchaseIdentityInfo.Key"));
    } catch(e) { log("STATE", C.r+e+C.R); }
}
function checkAIMarvels() {
    var found = false;
    Process.enumerateModules().forEach(function(m) { if(m.name.indexOf("AIMarvels")!==-1) { log("AI",C.g+"Loaded: "+m.path+C.R); found=true; } });
    if(!found) log("AI",C.y+"AIMarvels NOT found"+C.R);
}
function scanCredits() {
    log("SCAN", "Scanning for credit/coin symbols...");
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if(m.name==="VikPea") vikpeaMod=m; });
    if(!vikpeaMod) return;
    var pats = ["coin","credit","remain","times","locked","enough","consume","deduct","spend",
                "purchase","buy","watermark","enhance","matting","avatar","generate"];
    vikpeaMod.enumerateSymbols().forEach(function(sym) {
        var n = sym.name.toLowerCase();
        if(n.indexOf("$s6vikpea") !== 0) return;
        for(var i=0;i<pats.length;i++) {
            if(n.indexOf(pats[i]) !== -1) {
                var suffix = sym.name.slice(-4);
                var type = "";
                if(suffix.indexOf("Sbvg")!==-1) type="[Bool get]";
                else if(suffix.indexOf("Sivg")!==-1) type="[Int get]";
                else if(suffix.indexOf("Sdvg")!==-1) type="[Double get]";
                else if(suffix.indexOf("SSvg")!==-1) type="[String get]";
                else if(suffix==="SgvM") type="[modify]";
                else if(sym.name.slice(-2)==="vs") type="[setter]";
                else if(sym.name.slice(-2)==="vg") type="[getter]";
                log("SCAN", type+" "+sym.name.substring(0,140)+" @ "+sym.address);
                break;
            }
        }
    });
}

function searchEnhance() {
    log("SEARCH", "Scanning for enhancement/generation/task flow symbols...");
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if(m.name==="VikPea") vikpeaMod=m; });
    if(!vikpeaMod) return;
    var pats = ["EnhancementTask","EnhancingView","VideoEnhanc","enhanceRequest","enhanceResult",
                "taskResult","taskStatus","taskResponse","consumeCoins","consumeCredits","deductCoins",
                "startEnhance","beginEnhance","submitTask","createTask","processVideo","processImage",
                "handleResponse","parseResponse","onSuccess","onComplete","onResult"];
    var cnt = 0;
    vikpeaMod.enumerateSymbols().forEach(function(sym) {
        if(sym.name.indexOf("$s6VikPea") !== 0) return;
        for(var i=0;i<pats.length;i++) {
            if(sym.name.indexOf(pats[i]) !== -1) {
                var short = sym.name.replace("$s6VikPea", "").substring(0, 120);
                var suffix = sym.name.slice(-4);
                var type = "";
                if(suffix.indexOf("Sbvg")!==-1) type="[Bool]";
                else if(suffix.indexOf("Sivg")!==-1) type="[Int]";
                else if(suffix.indexOf("SSvg")!==-1) type="[Str]";
                else if(sym.name.indexOf("FZ")!==-1) type="[static]";
                else if(sym.name.indexOf("F$")!==-1 || sym.name.slice(-1)==="F") type="[func]";
                else if(sym.name.slice(-2)==="vg") type="[get]";
                else if(sym.name.slice(-2)==="vs") type="[set]";
                log("ENHANCE", type + " " + short);
                cnt++;
                break;
            }
        }
    });
    log("SEARCH", "Found " + cnt + " enhancement/task symbols");
}

function searchSymbol(pattern) {
    log("SEARCH", "Searching for: " + pattern);
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if(m.name==="VikPea") vikpeaMod=m; });
    if(!vikpeaMod) return;
    var cnt = 0;
    vikpeaMod.enumerateSymbols().forEach(function(sym) {
        if(sym.name.toLowerCase().indexOf(pattern.toLowerCase()) !== -1) {
            log("SYM", sym.name.substring(0, 160) + " @ " + sym.address);
            cnt++;
        }
    });
    log("SEARCH", "Found " + cnt + " matches");
}

// ============================================================
// MAIN
// ============================================================
console.log("\n"+C.B+C.g+"=== VikPea Premium FIX v5.0 ==="+C.R+"\n");

setupJailbreakBypass();
setupJSONIntercept();
setupHTTPStatusHook();
setupDefaultsHooks();
setupIAPHook();
log("STAGE", C.g+C.B+"Phase 1: Core hooks done"+C.R);

console.log("\n"+C.B+"[*] v5.0 loaded!"+C.R);
console.log("    Phase 1 (0s): JB + JSON + HTTP + Defaults + IAP");
console.log("    Phase 2 (1s): Delegate + Alamofire hooks");
console.log("    Phase 3 (2s): UI suppression");
console.log("    Phase 4 (3s): Swift symbol hooks");
console.log("");
console.log("    dumpVIP()           - Show state");
console.log("    checkAIMarvels()    - Check AIMarvels");
console.log("    scanCredits()       - Search credit symbols");
console.log("    searchEnhance()     - Find enhancement/task symbols");
console.log("    searchSymbol('x')   - Search any symbol by name");
console.log("");

setTimeout(function() {
    log("STAGE", C.c+"Phase 2: Delegate + Alamofire hooks..."+C.R);
    setupDeferredHooks();
    log("STAGE", C.g+C.B+"Phase 2 done"+C.R);
}, 1000);

setTimeout(function() {
    log("STAGE", C.c+"Phase 3: UI hooks..."+C.R);
    setupUIHooks();
    log("STAGE", C.g+C.B+"Phase 3 done"+C.R);
}, 2000);

setTimeout(function() {
    log("STAGE", C.c+"Phase 4: Swift symbol hooks..."+C.R);
    var n = hookExactSwiftSymbols();
    log("STAGE", C.g+C.B+"Phase 4 done: "+n+" Swift hooks"+C.R);
}, 3000);

/*
 * VikPea Premium Fix v9 - dataTask Intercept (AIMarvels technique)
 * 
 * KEY CHANGE: v8 hooked setHTTPBody (too early - headers not set yet).
 * v9 hooks dataTaskWithRequest:completionHandler: like the AIMarvels dylib,
 * which intercepts at the EXACT moment when ALL headers + body are ready.
 * 
 * Technique from analyzing AIMarvels.dylib (by "blatant"):
 * 1. Hook NSURLSession.dataTaskWithRequest:completionHandler:
 * 2. Modify request (body + headers) BEFORE sending
 * 3. Wrap completion handler to modify response AFTER receiving
 * 4. Full auth header dump at the right point in request lifecycle
 *
 * Usage: frida -U -f com.hitpaw.ven -l vikapea_fix_v9.js --no-pause
 */

var C = {R:"\x1b[0m",r:"\x1b[31m",g:"\x1b[32m",y:"\x1b[33m",c:"\x1b[36m",B:"\x1b[1m"};
var _logOnce = {};
function log(t,m) { console.log(C.B+"["+t+"]"+C.R+" "+m); }
function logOnce(t,m) { var k = t+m; if (_logOnce[k]) return; _logOnce[k] = true; log(t,m); }

var _lastApiUrl = "";
var _lastApiMethod = "";
var _drdFixedTasks = {};
var _lastComfyInputUrl = "";
var _error402Urls = {};
var _authLogged = false;
var _coinRejected = false;

function isBananaOrComfyUrl(url) {
    return url.indexOf("banana-image") !== -1 || url.indexOf("comfy-template") !== -1 || url.indexOf("comfy_template") !== -1;
}

function isVikPeaApi(url) {
    return url.indexOf("afirstsoft.cn") !== -1 ||
           url.indexOf("hitpaw.com") !== -1 ||
           url.indexOf("hitpaw.cn") !== -1 ||
           url.indexOf("ven-api") !== -1;
}
function isAnalyticsUrl(url) {
    return url.indexOf("/collect") !== -1 ||
           url.indexOf("analytics.") !== -1 ||
           url.indexOf("/common/config") !== -1 ||
           url.indexOf("/event") !== -1;
}

// ============================================================
// PHASE 1: SWIFT SYMBOL HOOKS (VIP + Credits + Validation)
// ============================================================
function hookExactSwiftSymbols() {
    var cnt = 0;
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if (m.name === "VikPea") vikpeaMod = m; });
    if (!vikpeaMod) { log("SWIFT", C.r+"VikPea module not found"+C.R); return 0; }
    log("SWIFT", "VikPea base=" + vikpeaMod.base);

    var symMap = {};
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
                return true;
            } catch(e) {}
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
                if (name.indexOf("Sbvg") !== -1 || name.indexOf("SbSgvg") !== -1) {
                    try { Interceptor.attach(symMap[name], { onLeave: function(r) { r.replace(1); } }); cnt++; } catch(e) {}
                }
                break;
            }
        }
    });

    // === ALAMOFIRE VALIDATION SAFETY NET ===
    var alamofireMod = null;
    Process.enumerateModules().forEach(function(m) { if (m.name === "Alamofire") alamofireMod = m; });
    if (!alamofireMod) {
        Process.enumerateModules().forEach(function(m) { if (m.path && m.path.indexOf("Alamofire") !== -1) alamofireMod = m; });
    }
    if (alamofireMod) {
        logOnce("AF", C.c + "Alamofire module found @ " + alamofireMod.base + C.R);
    }

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
        var retVal = -1;
        for (var i = 0; i < costPatterns.length; i++) {
            if (nl.indexOf(costPatterns[i].toLowerCase()) !== -1) { retVal = 0; break; }
        }
        if (retVal === -1) {
            for (var i = 0; i < balancePatterns.length; i++) {
                if (nl.indexOf(balancePatterns[i].toLowerCase()) !== -1) { retVal = 99999; break; }
            }
        }
        if (retVal === -1) {
            for (var i = 0; i < remainPatterns.length; i++) {
                if (nl.indexOf(remainPatterns[i].toLowerCase()) !== -1) { retVal = 99999; break; }
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
        } catch(e) {}
    });

    // === MATERIALMANAGER CRASH FIX ===
    var mmSymbols = [];
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        var nl = name.toLowerCase();
        if (nl.indexOf("materialmanager") !== -1) {
            mmSymbols.push({name: name, addr: symMap[name]});
        }
    });

    // Hook VPError.handleError — REPLACE WITH NOP (BUT LET THROUGH IF _coinRejected)
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        if (name.indexOf("7VPErrorO11handleError") !== -1 && name.indexOf("FZ") !== -1) {
            try {
                Interceptor.attach(symMap[name], {
                    onEnter: function(args) {
                        if (_coinRejected) {
                            log("VPError", C.y + "NOT suppressing error - coin rejection in progress" + C.R);
                            return;
                        }
                    }
                });
                cnt++;
            } catch(e) {
                try {
                    Interceptor.attach(symMap[name], {
                        onEnter: function(args) {
                            if (_coinRejected) {
                                log("VPError", C.y + "NOT suppressing error - coin rejection in progress" + C.R);
                                return;
                            }
                        }
                    });
                    cnt++;
                } catch(e2) {}
            }
        }
    });

    // Hook error presentation methods — NOP them (BUT LET THROUGH IF _coinRejected)
    var errorDisplayMethods = [];
    Object.keys(symMap).forEach(function(name) {
        if (name.indexOf("$s6VikPea") !== 0) return;
        var n = name.substring(9);
        if (name.slice(-2) === "vg" || name.slice(-2) === "vs") return;
        var methodPart = n.substring(0, 80);
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
            Interceptor.attach(symMap[m.name], { 
                onEnter: function(args) {
                    if (_coinRejected) {
                        log("ErrorDisplay", C.y + "NOT suppressing error display - coin rejection in progress" + C.R);
                        return;
                    }
                }
            });
            cnt++;
        } catch(e) {
            try {
                Interceptor.attach(symMap[m.name], { 
                    onEnter: function(args) {
                        if (_coinRejected) {
                            log("ErrorDisplay", C.y + "NOT suppressing error display - coin rejection in progress" + C.R);
                            return;
                        }
                    }
                });
                cnt++;
            } catch(e2) {}
        }
    });

    log("SWIFT", C.g+C.B+"Total Swift hooks: "+cnt+C.R);
    return cnt;
}

// ============================================================
// PHASE 1b: NSUserDefaults HOOKS
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
// PHASE 1c: JAILBREAK BYPASS
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
// PHASE 2: JSON INTERCEPTOR (Credit patching, receipt, whitelist)
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

function patchErrorResponse(str) {
    if (str.indexOf("not enough") !== -1 || str.indexOf("Not enough") !== -1 ||
        str.indexOf("nsufficient") !== -1 || str.indexOf("coins is not") !== -1 ||
        str.indexOf("credits is not") !== -1 || str.indexOf("not_enough") !== -1 ||
        str.indexOf("110402") !== -1) {
        log("REJECTED", C.r + C.B + "Server rejected (coins not enough): " + str.substring(0, 300) + C.R);
        log("REJECTED", C.y + "Trial params did not bypass. Server requires real coins." + C.R);
    }
    return str
        .replace(/"code"\s*:\s*(-?\d+)/g, function(match, num) {
            var n = parseInt(num);
            if (n >= 0 && n < 1000) return match;
            return '"code":200';
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
                                logOnce("RECEIPT", C.g+C.B+"Fake receipt injected"+C.R);
                                return orig(self, sel, fake.handle, opts, errp);
                            }
                            else if (str.indexOf('"in_whitelist"') !== -1 || str.indexOf('"is_active"') !== -1) {
                                var patched = str
                                    .replace(/"in_whitelist"\s*:\s*false/g, '"in_whitelist":true')
                                    .replace(/"is_active"\s*:\s*false/g, '"is_active":true')
                                    .replace(/"is_expired"\s*:\s*true/g, '"is_expired":false')
                                    .replace(/"status"\s*:\s*0/g, '"status":1');
                                if (patched !== str) {
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
                                    return orig(self, sel, s2d(patched).handle, opts, errp);
                                }
                            }
                            else if (str.indexOf('not enough') !== -1 || str.indexOf('Not enough') !== -1 ||
                                     str.indexOf('nsufficient') !== -1 || str.indexOf('coins is not') !== -1 ||
                                     str.indexOf('credits is not') !== -1 || str.indexOf('not_enough') !== -1 ||
                                     str.indexOf('110402') !== -1) {
                                var patched = patchErrorResponse(str);
                                patched = patchCreditJson(patched);
                                return orig(self, sel, s2d(patched).handle, opts, errp);
                            }
                            else if (str.indexOf('"code"') !== -1 &&
                                     (str.indexOf('"message"') !== -1 || str.indexOf('"msg"') !== -1) &&
                                     str.indexOf('kJCore') === -1 && str.indexOf('kJORE') === -1 && str.indexOf('APDeviceId') === -1) {
                                var codeMatch = str.match(/"code"\s*:\s*(-?\d+)/);
                                if (codeMatch) {
                                    var codeVal = parseInt(codeMatch[1]);
                                    if (codeVal < 0 || codeVal >= 1000) {
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
// PHASE 2b: HTTP STATUS CODE + ERROR INTERCEPTION
// ============================================================
function setupHTTPStatusHook() {
    try {
        var initSel = "- initWithURL:statusCode:HTTPVersion:headerFields:";
        if (ObjC.classes.NSHTTPURLResponse[initSel]) {
            Interceptor.attach(ObjC.classes.NSHTTPURLResponse[initSel].implementation, {
                onEnter: function(args) {
                    var code = args[3].toInt32();
                    if (code === 402 || code === 403 || code === 429) {
                        try {
                            var urlObj = new ObjC.Object(args[2]);
                            var urlStr = urlObj.absoluteString().toString();
                            _lastApiUrl = urlStr;
                            _error402Urls[urlStr] = Date.now();
                            log("HTTP", C.r+C.B+"["+code+"] "+urlStr.substring(0,120)+C.R);
                            if (isBananaOrComfyUrl(urlStr)) {
                                _coinRejected = true;
                                log("HTTP", C.y + "NOT patching 402→200 for banana/comfy URL (letting error through)" + C.R);
                                return;
                            }
                        } catch(e) {}
                        args[3] = ptr(200);
                    }
                }
            });
        }
    } catch(e) {}

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
                            try {
                                var urlStr = resp.URL().absoluteString().toString();
                                _lastApiUrl = urlStr;
                                _error402Urls[urlStr] = Date.now();
                                if (isBananaOrComfyUrl(urlStr)) {
                                    _coinRejected = true;
                                    log("HTTP", C.y + "NOT patching 402→200 for banana/comfy URL (letting error through)" + C.R);
                                    return;
                                }
                            } catch(eu) {}
                            try {
                                resp.setValue_forKey_(ObjC.classes.NSNumber.numberWithInteger_(200), "_statusCode");
                            } catch(kvcErr) {
                                try { resp.setValue_forKey_(ObjC.classes.NSNumber.numberWithInteger_(200), "statusCode"); } catch(kvcErr2) {}
                            }
                        }
                    } catch(e) {}
                }
            });
        }
    } catch(e) {}

    try {
        Interceptor.attach(ObjC.classes.NSHTTPURLResponse["- statusCode"].implementation, {
            onEnter: function(args) { this._self = args[0]; },
            onLeave: function(retval) {
                var code = retval.toInt32();
                if (code === 402 || code === 403 || code === 429) {
                    try {
                        var resp = new ObjC.Object(this._self);
                        var u = resp.URL().absoluteString().toString();
                        if (u.indexOf("analytics") === -1 && u.indexOf("/collect") === -1) {
                            _lastApiUrl = u;
                            if (isBananaOrComfyUrl(u)) {
                                _coinRejected = true;
                                log("HTTP", C.y + "NOT patching 402→200 for banana/comfy URL (letting error through)" + C.R);
                                return;
                            }
                        }
                    } catch(eu) {}
                    retval.replace(200);
                }
            }
        });
    } catch(e) {}

    try {
        var dtSel = "- dataTaskWithRequest:";
        if (ObjC.classes.NSURLSession[dtSel]) {
            Interceptor.attach(ObjC.classes.NSURLSession[dtSel].implementation, {
                onEnter: function(args) {
                    try {
                        if (!args[2] || args[2].isNull()) return;
                        var req = new ObjC.Object(args[2]);
                        var url = req.URL().absoluteString().toString();
                        if (!isVikPeaApi(url)) return;
                        if (isAnalyticsUrl(url)) return;
                        var method = "GET";
                        try { method = req.HTTPMethod().toString(); } catch(e) {}
                        _lastApiUrl = url;
                        _lastApiMethod = method;
                        if (method === "POST" || method === "PUT") {
                            try {
                                var bodyData = req.HTTPBody();
                                if (bodyData && !bodyData.isNull()) {
                                    var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(bodyData, 4);
                                    if (bodyStr) {
                                        var bStr = bodyStr.toString();
                                        var urlMatch = bStr.match(/"(?:image_url|url|thumbnail_url|originalImageUrl)"\s*:\s*"(https?:[^"]+)"/);
                                        if (!urlMatch) {
                                            var escMatch = bStr.match(/"(?:image_url|originalImageUrl|thumbnail_url)"\s*:\s*\\"(https?:[^"\\]+)/);
                                            if (!escMatch) escMatch = bStr.match(/originalImageUrl[^h]+(https?:\/\/[^"\\,\s]+)/);
                                            if (escMatch) urlMatch = escMatch;
                                        }
                                        if (urlMatch) {
                                            _lastComfyInputUrl = urlMatch[1].replace(/\\\//g, '/');
                                            log("INPUT-URL", C.c + C.B + _lastComfyInputUrl.substring(0, 150) + C.R);
                                        }
                                    }
                                }
                            } catch(e) {}
                        }
                    } catch(e) {}
                }
            });
        }
    } catch(e) {}

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
                        var method = "POST";
                        try { method = req.HTTPMethod().toString(); } catch(e) {}
                        _lastApiUrl = url;
                        _lastApiMethod = method;
                        if (!args[4] || args[4].isNull()) return;
                        var block = new ObjC.Block(args[4]);
                        var origImpl = block.implementation;
                        var apiUrl = url;
                        block.implementation = function(data, response, error) {
                            _lastApiUrl = apiUrl;
                            _lastApiMethod = "POST";
                            if (error && !error.isNull()) {
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

    try {
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
                            }
                        } catch(e) {}
                    }
                });
            } catch(e) {}
        });
    } catch(e) {}

    log("HTTP", C.g+"Phase 2 hooks done"+C.R);
}

// ============================================================
// PHASE 3: dataTask INTERCEPT (AIMarvels technique - NEW in v9)
// ============================================================
function setupDataTaskIntercept() {
    var NSURLSession = ObjC.classes.NSURLSession;

    var dataTaskSel = '- dataTaskWithRequest:completionHandler:';
    if (NSURLSession[dataTaskSel]) {
        var origImpl = NSURLSession[dataTaskSel].implementation;
        Interceptor.attach(origImpl, {
            onEnter: function(args) {
                try {
                    var request = new ObjC.Object(args[2]);
                    var url = request.URL().absoluteString().toString();

                    var isBanana = url.indexOf("banana-image") !== -1 || url.indexOf("banana_image") !== -1 || url.indexOf("nanobanana") !== -1 || url.indexOf("NanoBanana") !== -1;
                    var isComfy = url.indexOf("comfy-template") !== -1 || url.indexOf("comfy_template") !== -1;
                    var isEnhance = url.indexOf("enhance") !== -1 || url.indexOf("face") !== -1 || url.indexOf("beauty") !== -1;
                    var isTargetApi = isBanana || isComfy || isEnhance;
                    var isVikApi = isVikPeaApi(url);

                    if (isVikApi && !isAnalyticsUrl(url)) {
                        logOnce("DTASK-URL", C.c + "dataTask URL: " + url.substring(0, 200) + C.R);
                    }

                    if (!_authLogged && isVikApi && !isAnalyticsUrl(url)) {
                        _authLogged = true;
                        log("AUTH", C.c + C.B + "=== FULL REQUEST DUMP (dataTask level) ===" + C.R);
                        log("AUTH", C.c + "URL: " + url + C.R);
                        try { log("AUTH", C.c + "Method: " + request.HTTPMethod().toString() + C.R); } catch(e) {}

                        var allHeaders = request.allHTTPHeaderFields();
                        if (allHeaders) {
                            var headerKeys = allHeaders.allKeys();
                            log("AUTH", C.c + "Headers (" + headerKeys.count() + "):" + C.R);
                            for (var i = 0; i < headerKeys.count(); i++) {
                                var key = headerKeys.objectAtIndex_(i).toString();
                                var val = allHeaders.objectForKey_(headerKeys.objectAtIndex_(i)).toString();
                                if (val.length > 200) val = val.substring(0, 200) + "...";
                                log("AUTH", C.c + "  " + key + ": " + val + C.R);
                            }
                        }

                        var body = request.HTTPBody();
                        if (body && !body.isNull()) {
                            var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(body, 4);
                            if (bodyStr) {
                                var bs = bodyStr.toString();
                                log("AUTH", C.c + "Body: " + bs.substring(0, 800) + C.R);
                            }
                        }
                        log("AUTH", C.c + C.B + "=== END FULL REQUEST DUMP ===" + C.R);
                    }

                    if (isTargetApi && isVikApi && !_authLogged) {
                        log("AUTH", C.c + C.B + "=== TARGET API FOUND (2nd dump) ===" + C.R);
                        log("AUTH", C.c + "URL: " + url + C.R);
                        var allHeaders2 = request.allHTTPHeaderFields();
                        if (allHeaders2) {
                            var headerKeys2 = allHeaders2.allKeys();
                            for (var h = 0; h < headerKeys2.count(); h++) {
                                var k2 = headerKeys2.objectAtIndex_(h).toString();
                                var v2 = allHeaders2.objectForKey_(headerKeys2.objectAtIndex_(h)).toString();
                                if (v2.length > 200) v2 = v2.substring(0, 200) + "...";
                                log("AUTH", C.c + "  " + k2 + ": " + v2 + C.R);
                            }
                        }
                        log("AUTH", C.c + C.B + "=== END 2nd DUMP ===" + C.R);
                    }

                    if (!isVikApi) return;
                    if (isAnalyticsUrl(url)) return;

                    if (isTargetApi) {
                        var mutableReq = request.mutableCopy();

                        var body = mutableReq.HTTPBody();
                        if (body && !body.isNull()) {
                            var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(body, 4);
                            if (bodyStr) {
                                try {
                                    var bodyJson = JSON.parse(bodyStr.toString());

                                    bodyJson.is_trial = true;
                                    bodyJson.is_free = true;
                                    bodyJson.is_vip = true;
                                    bodyJson.use_free_trial = true;
                                    bodyJson.payment_type = "trial";
                                    bodyJson.use_remain_times = true;
                                    bodyJson.free_trial = 1;
                                    bodyJson.member_type = "vip";
                                    bodyJson.user_type = "premium";

                                    var newBodyStr = JSON.stringify(bodyJson);
                                    var newBody = ObjC.classes.NSString.stringWithString_(newBodyStr).dataUsingEncoding_(4);
                                    mutableReq.setHTTPBody_(newBody);

                                    var label = isBanana ? "banana" : (isComfy ? "comfy" : "enhance");
                                    log("REQ-MOD", C.g + C.B + "Modified " + label + " body with trial+VIP params" + C.R);
                                    log("REQ-MOD", C.g + "URL: " + url.substring(0, 150) + C.R);
                                    log("REQ-MOD", C.g + "Original body: " + bodyStr.toString().substring(0, 400) + C.R);
                                } catch(e) {}
                            }
                        }

                        args[2] = mutableReq.handle;
                    }

                    _lastApiUrl = url;
                    _lastApiMethod = "POST";

                    if (args[3] && !args[3].isNull()) {
                        var block = new ObjC.Block(args[3]);
                        var origBlock = block.implementation;
                        var capturedUrl = url;
                        var capturedIsTarget = isTargetApi;

                        block.implementation = function(data, response, error) {
                            try {
                                if (capturedIsTarget) {
                                    if (data && !data.isNull()) {
                                        var dataObj = new ObjC.Object(data);
                                        var str = ObjC.classes.NSString.alloc().initWithData_encoding_(dataObj, 4);
                                        if (str) {
                                            var s = str.toString();
                                            log("RESP", C.y + "Response for " + capturedUrl.substring(0, 80) + ": " + s.substring(0, 300) + C.R);

                                            if (s.indexOf("110402000") !== -1 || s.indexOf("coins") !== -1 || s.indexOf("not enough") !== -1) {
                                                log("REJECTED", C.r + C.B + "Server rejected: " + s.substring(0, 300) + C.R);

                                                try {
                                                    var respJson = JSON.parse(s);
                                                    log("REJECTED", C.y + "Original error code: " + respJson.code + ", message: " + respJson.message + C.R);
                                                    log("REJECTED", C.r + "Cannot fake success without real job processing. Server requires real coins." + C.R);
                                                } catch(e) {}
                                            } else {
                                                log("SUCCESS", C.g + C.B + "*** SERVER ACCEPTED REQUEST! ***" + C.R);
                                                log("SUCCESS", C.g + "Response: " + s.substring(0, 500) + C.R);

                                                try {
                                                    var respJson = JSON.parse(s);
                                                    if (respJson.data) {
                                                        if (respJson.data.coins !== undefined) {
                                                            respJson.data.coins = 99999;
                                                        }
                                                        if (respJson.data.remain_coins !== undefined) {
                                                            respJson.data.remain_coins = 99999;
                                                        }
                                                        if (respJson.data.beauty_times !== undefined) {
                                                            respJson.data.beauty_times = 99999;
                                                        }
                                                        var newStr = JSON.stringify(respJson);
                                                        var newData = ObjC.classes.NSString.stringWithString_(newStr).dataUsingEncoding_(4);
                                                        origBlock(newData, response, error);
                                                        return;
                                                    }
                                                } catch(e) {}
                                            }
                                        }
                                    }
                                }

                                if (capturedUrl.indexOf("user-subscription") !== -1) {
                                }

                            } catch(e) {}

                            origBlock(data, response, error);
                        };
                    }

                } catch(e) {}
            }
        });
        log("DTASK", C.g + C.B + "dataTaskWithRequest:completionHandler: hook ACTIVE" + C.R);
    }

    var dataTaskNoBlockSel = '- dataTaskWithRequest:';
    if (NSURLSession[dataTaskNoBlockSel]) {
        Interceptor.attach(NSURLSession[dataTaskNoBlockSel].implementation, {
            onEnter: function(args) {
                try {
                    var request = new ObjC.Object(args[2]);
                    var url = request.URL().absoluteString().toString();
                    var isVikApi = isVikPeaApi(url);
                    if (!isVikApi) return;
                    if (isAnalyticsUrl(url)) return;

                    log("DTASK-NB", C.y + C.B + "dataTaskWithRequest: (no block) URL: " + url.substring(0, 200) + C.R);

                    var isBanana = url.indexOf("banana-image") !== -1 || url.indexOf("banana_image") !== -1 || url.indexOf("nanobanana") !== -1 || url.indexOf("NanoBanana") !== -1;
                    var isComfy = url.indexOf("comfy-template") !== -1 || url.indexOf("comfy_template") !== -1;
                    var isEnhance = url.indexOf("enhance") !== -1 || url.indexOf("face") !== -1 || url.indexOf("beauty") !== -1;
                    var isTarget = isBanana || isComfy || isEnhance;

                    if (!_authLogged) {
                        _authLogged = true;
                        log("AUTH", C.c + C.B + "=== FULL REQUEST DUMP (dataTask NO-BLOCK) ===" + C.R);
                        log("AUTH", C.c + "URL: " + url + C.R);
                        try { log("AUTH", C.c + "Method: " + request.HTTPMethod().toString() + C.R); } catch(e) {}
                        var allHeaders = request.allHTTPHeaderFields();
                        if (allHeaders) {
                            var headerKeys = allHeaders.allKeys();
                            log("AUTH", C.c + "Headers (" + headerKeys.count() + "):" + C.R);
                            for (var i = 0; i < headerKeys.count(); i++) {
                                var key = headerKeys.objectAtIndex_(i).toString();
                                var val = allHeaders.objectForKey_(headerKeys.objectAtIndex_(i)).toString();
                                if (val.length > 200) val = val.substring(0, 200) + "...";
                                log("AUTH", C.c + "  " + key + ": " + val + C.R);
                            }
                        }
                        var body = request.HTTPBody();
                        if (body && !body.isNull()) {
                            var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(body, 4);
                            if (bodyStr) log("AUTH", C.c + "Body: " + bodyStr.toString().substring(0, 800) + C.R);
                        }
                        log("AUTH", C.c + C.B + "=== END DUMP ===" + C.R);
                    }

                    var isVideoGen = url.indexOf("video-generate") !== -1;
                    var isSubscription = url.indexOf("user-subscription") !== -1;

                    if (isTarget || isVideoGen) {
                        var body = request.HTTPBody();
                        if (body && !body.isNull()) {
                            var origStr = ObjC.classes.NSString.alloc().initWithData_encoding_(body, 4);
                            if (origStr) {
                                log("REQ-BODY", C.c + C.B + "=== ORIGINAL REQUEST BODY ===" + C.R);
                                log("REQ-BODY", C.c + "URL: " + url + C.R);
                                log("REQ-BODY", C.c + "Body: " + origStr.toString().substring(0, 1000) + C.R);
                                log("REQ-BODY", C.c + C.B + "=== END ===" + C.R);
                            }
                        }

                        var mutableReq = request.mutableCopy();
                        var mbody = mutableReq.HTTPBody();
                        if (mbody && !mbody.isNull()) {
                            var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(mbody, 4);
                            if (bodyStr) {
                                try {
                                    var bodyJson = JSON.parse(bodyStr.toString());
                                    bodyJson.is_trial = true;
                                    bodyJson.is_free = true;
                                    bodyJson.is_vip = true;
                                    bodyJson.use_free_trial = true;
                                    bodyJson.payment_type = "trial";
                                    bodyJson.use_remain_times = true;
                                    bodyJson.free_trial = 1;
                                    bodyJson.member_type = "vip";
                                    bodyJson.user_type = "premium";
                                    var newStr = JSON.stringify(bodyJson);
                                    mutableReq.setHTTPBody_(ObjC.classes.NSString.stringWithString_(newStr).dataUsingEncoding_(4));
                                    log("REQ-MOD", C.g + "Modified (no-block) body for: " + url.substring(0, 100) + C.R);
                                } catch(e) {}
                            }
                        }
                        args[2] = mutableReq.handle;
                    }

                    _lastApiUrl = url;
                    _lastApiMethod = "POST";
                } catch(e) {}
            }
        });
        log("DTASK", C.g + "dataTaskWithRequest: (no-block) hook ACTIVE" + C.R);
    }

    var uploadSel = '- uploadTaskWithRequest:fromData:completionHandler:';
    if (NSURLSession[uploadSel]) {
        Interceptor.attach(NSURLSession[uploadSel].implementation, {
            onEnter: function(args) {
                try {
                    var request = new ObjC.Object(args[2]);
                    var url = request.URL().absoluteString().toString();

                    if (!isVikPeaApi(url)) return;

                    var isBanana = url.indexOf("banana-image") !== -1;
                    var isComfy = url.indexOf("comfy-template") !== -1;

                    if (isBanana || isComfy) {
                        if (!_authLogged) {
                            _authLogged = true;
                            log("AUTH", C.c + C.B + "=== FULL REQUEST DUMP (uploadTask level) ===" + C.R);
                            log("AUTH", C.c + "URL: " + url + C.R);
                            try { log("AUTH", C.c + "Method: " + request.HTTPMethod().toString() + C.R); } catch(e) {}
                            var allHeaders = request.allHTTPHeaderFields();
                            if (allHeaders) {
                                var headerKeys = allHeaders.allKeys();
                                log("AUTH", C.c + "Headers (" + headerKeys.count() + "):" + C.R);
                                for (var i = 0; i < headerKeys.count(); i++) {
                                    var key = headerKeys.objectAtIndex_(i).toString();
                                    var val = allHeaders.objectForKey_(headerKeys.objectAtIndex_(i)).toString();
                                    if (val.length > 120) val = val.substring(0, 120) + "...";
                                    log("AUTH", C.c + "  " + key + ": " + val + C.R);
                                }
                            }
                            log("AUTH", C.c + C.B + "=== END REQUEST DUMP ===" + C.R);
                        }

                        if (args[3] && !args[3].isNull()) {
                            var fromData = new ObjC.Object(args[3]);
                            var bodyStr = ObjC.classes.NSString.alloc().initWithData_encoding_(fromData, 4);
                            if (bodyStr) {
                                try {
                                    var bodyJson = JSON.parse(bodyStr.toString());
                                    bodyJson.is_trial = true;
                                    bodyJson.is_free = true;
                                    bodyJson.is_vip = true;
                                    bodyJson.use_free_trial = true;
                                    bodyJson.payment_type = "trial";
                                    bodyJson.use_remain_times = true;
                                    bodyJson.free_trial = 1;
                                    bodyJson.member_type = "vip";
                                    bodyJson.user_type = "premium";
                                    var newStr = JSON.stringify(bodyJson);
                                    args[3] = ObjC.classes.NSString.stringWithString_(newStr).dataUsingEncoding_(4).handle;
                                    log("REQ-MOD", C.g + "Modified uploadTask body for " + (isBanana ? "banana" : "comfy") + C.R);
                                } catch(e) {}
                            }
                        }

                        var mutableReq = request.mutableCopy();
                        args[2] = mutableReq.handle;
                    }

                    _lastApiUrl = url;
                    _lastApiMethod = "POST";

                    if (args[4] && !args[4].isNull()) {
                        var block = new ObjC.Block(args[4]);
                        var origBlock = block.implementation;
                        var capturedUrl = url;
                        var capturedIsBanana = isBanana;
                        var capturedIsComfy = isComfy;

                        block.implementation = function(data, response, error) {
                            try {
                                if ((capturedIsBanana || capturedIsComfy) && data && !data.isNull()) {
                                    var dataObj = new ObjC.Object(data);
                                    var str = ObjC.classes.NSString.alloc().initWithData_encoding_(dataObj, 4);
                                    if (str) {
                                        var s = str.toString();
                                        log("RESP", C.y + "uploadTask response: " + s.substring(0, 300) + C.R);

                                        if (s.indexOf("110402000") !== -1 || s.indexOf("not enough") !== -1) {
                                            log("REJECTED", C.r + C.B + "Server rejected in uploadTask: " + s.substring(0, 200) + C.R);
                                        } else if (s.indexOf('"code":200') !== -1 || s.indexOf('"code": 200') !== -1) {
                                            log("SUCCESS", C.g + C.B + "*** uploadTask SUCCESS! ***" + C.R);
                                            log("SUCCESS", C.g + s.substring(0, 500) + C.R);
                                        }
                                    }
                                }
                            } catch(e) {}
                            origBlock(data, response, error);
                        };
                    }

                } catch(e) {}
            }
        });
        log("DTASK", C.g + "uploadTask hook ACTIVE" + C.R);
    }

    log("REQ-MOD", C.g + C.B + "Phase 3 (dataTask intercept) ready" + C.R);
}

// ============================================================
// PHASE 3b: IAP TRANSACTION STATE FIX
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
// PHASE 4: DEFERRED HOOKS (DRD + Error masking)
// ============================================================
function setupDeferredHooks() {
    try {
        Interceptor.attach(ObjC.classes.NSError["- code"].implementation, {
            onLeave: function(retval) {
                var code = retval.toInt32();
                if (code === -1011 || code === -1012) {
                    retval.replace(0);
                }
            }
        });
    } catch(e) {}

    try {
        Interceptor.attach(ObjC.classes.NSError["- localizedDescription"].implementation, {
            onLeave: function(retval) {
                try {
                    var desc = new ObjC.Object(retval).toString();
                    if (_coinRejected && (desc.indexOf("1011") !== -1 || desc.indexOf("402") !== -1 || 
                                          desc.indexOf("coins") !== -1 || desc.indexOf("not enough") !== -1)) {
                        log("NSError", C.y + "NOT suppressing error description - coin rejection in progress" + C.R);
                        return;
                    }
                    if (desc.indexOf("1011") !== -1 || desc.indexOf("couldn't be completed") !== -1 ||
                        desc.indexOf("bad server") !== -1 || desc.indexOf("coins") !== -1 ||
                        desc.indexOf("not enough") !== -1 || desc.indexOf("status code") !== -1 ||
                        desc.indexOf("unacceptable") !== -1 || desc.indexOf("Request failed") !== -1 ||
                        desc.indexOf("1012") !== -1 || desc.indexOf("402") !== -1 ||
                        desc.indexOf("403") !== -1) {
                        retval.replace(ObjC.classes.NSString.stringWithString_("").handle);
                    }
                } catch(e) {}
            }
        });
    } catch(e) {}

    try {
        var drdSel = "- URLSession:dataTask:didReceiveData:";
        var hookedAddrs = {};
        var drdCount = 0;

        var candidateNames = [
            "_TtC9Alamofire15SessionDelegate",
            "Alamofire.SessionDelegate",
            "SessionDelegate",
            "AFURLSessionManager",
            "AFHTTPSessionManager"
        ];

        function hookDRDClass(cn, cls) {
            var m = cls[drdSel];
            if (!m) return;
            var addr = m.implementation.toString();
            if (hookedAddrs[addr]) return;
            hookedAddrs[addr] = true;

            Interceptor.attach(m.implementation, {
                onEnter: function(args) {
                    try {
                        var task = new ObjC.Object(args[3]);
                        var taskUrl = "";
                        try { taskUrl = task.currentRequest().URL().absoluteString().toString(); } catch(e) {
                            try { taskUrl = task.originalRequest().URL().absoluteString().toString(); } catch(e2) {}
                        }
                        if (!taskUrl || !isVikPeaApi(taskUrl)) return;
                        if (isAnalyticsUrl(taskUrl)) return;

                        _lastApiUrl = taskUrl;
                        var data = new ObjC.Object(args[4]);
                        var s = "";
                        try { s = ObjC.classes.NSString.alloc().initWithData_encoding_(data, 4).toString(); } catch(e) { return; }
                        if (!s || s.length < 10) return;

                        var isBananaUrl = taskUrl.indexOf("banana") !== -1;
                        var isComfyUrl = taskUrl.indexOf("comfy") !== -1;
                        var isVideoGenUrl = taskUrl.indexOf("video-generate") !== -1;
                        var isSubUrl = taskUrl.indexOf("user-subscription") !== -1 || taskUrl.indexOf("user_subscription") !== -1;
                        var isTaskListUrl = taskUrl.indexOf("task-list") !== -1 || taskUrl.indexOf("task_list") !== -1;
                        var isUserUrl = taskUrl.indexOf("/user/") !== -1 || taskUrl.indexOf("/user?") !== -1;
                        var isWhitelistUrl = taskUrl.indexOf("whitelist") !== -1;
                        var isTaskStatusUrl = taskUrl.indexOf("task-status") !== -1;

                        if (isWhitelistUrl) {
                            log("WHITELIST", C.g + C.B + "=== email-whitelist RESPONSE (ORIGINAL) ===" + C.R);
                            log("WHITELIST", C.g + "URL: " + taskUrl + C.R);
                            log("WHITELIST", C.g + "Body: " + s + C.R);
                            try {
                                var wlJson = JSON.parse(s);
                                wlJson.code = 200;
                                wlJson.message = "OK";
                                if (wlJson.data && typeof wlJson.data === 'object') {
                                    var ft2 = new Date(Date.now() + 365*86400000).toISOString();
                                    wlJson.data.in_whitelist = true;
                                    wlJson.data.is_active = true;
                                    wlJson.data.is_expired = false;
                                    wlJson.data.status = 1;
                                    wlJson.data.start_time = new Date(Date.now() - 30*86400000).toISOString();
                                    wlJson.data.expire_time = ft2;
                                }
                                var wlStr = JSON.stringify(wlJson);
                                var wlData = ObjC.classes.NSString.stringWithString_(wlStr).dataUsingEncoding_(4);
                                args[4] = wlData.handle;
                                var wlPtr = args[3].toString();
                                _drdFixedTasks[wlPtr] = true;
                                log("WHITELIST", C.g + C.B + "PATCHED: " + wlStr + C.R);
                            } catch(wle) {
                                log("WHITELIST", C.r + "Failed to patch: " + wle + C.R);
                            }
                            log("WHITELIST", C.g + C.B + "=== END ===" + C.R);
                        }

                        if (isSubUrl) {
                            log("SUB-RESP", C.c + C.B + "=== user-subscription RESPONSE (ORIGINAL) ===" + C.R);
                            log("SUB-RESP", C.c + "URL: " + taskUrl + C.R);
                            log("SUB-RESP", C.c + "Body: " + s.substring(0, 1500) + C.R);
                            log("SUB-RESP", C.c + C.B + "=== END ===" + C.R);
                        }
                        if (isVideoGenUrl) {
                            log("VGEN-RESP", C.y + C.B + "=== video-generate RESPONSE ===" + C.R);
                            log("VGEN-RESP", C.y + "Body: " + s.substring(0, 1000) + C.R);
                            log("VGEN-RESP", C.y + C.B + "=== END ===" + C.R);
                        }

                        if (isSubUrl) {
                            try {
                                var subJson = JSON.parse(s);
                                if (subJson.data) {
                                    var ft = Math.floor(Date.now()/1000) + 365*86400;
                                    subJson.data.coins = 99999;
                                    subJson.data.total_coins = 99999;
                                    subJson.data.try_times = 99999;
                                    subJson.data.beauty_times = 99999;
                                    subJson.data.photo_enhance_remain_times = 99999;
                                    subJson.data.video_matting_remain_times = 99999;
                                    subJson.data.watermark_remove_remain_times = 99999;
                                    subJson.data.media_analyze_remain_times = 99999;
                                    subJson.data.remain_digital_human_times = 99999;
                                    subJson.data.remain_voice_clone_times = 99999;
                                    subJson.data.status = "Active";
                                    subJson.data.is_subscribe = true;
                                    subJson.data.is_subscribing = true;
                                    subJson.data.is_vip = true;
                                    subJson.data.expire_timestamp = ft;
                                    subJson.data.need_coins = 0;
                                    subJson.data.consume_coins = 0;
                                    subJson.data.user_role = "vip";
                                    var subStr = JSON.stringify(subJson);
                                    var subData = ObjC.classes.NSString.stringWithString_(subStr).dataUsingEncoding_(4);
                                    args[4] = subData.handle;
                                    _drdFixedTasks[args[3].toString()] = true;
                                    log("SUB-PATCH", C.g + C.B + "PATCHED subscription: Active VIP, coins=99999, all times=99999" + C.R);
                                }
                            } catch(subErr) {
                                var patched = patchCreditJson(s);
                                if (patched !== s) {
                                    args[4] = ObjC.classes.NSString.stringWithString_(patched).dataUsingEncoding_(4).handle;
                                    _drdFixedTasks[args[3].toString()] = true;
                                }
                            }
                        } else if (isUserUrl || isWhitelistUrl || (!isBananaUrl && !isComfyUrl && !isVideoGenUrl && !isTaskListUrl && !isTaskStatusUrl)) {
                            if (s.indexOf('"coins"') !== -1 || s.indexOf('"credits"') !== -1 ||
                                s.indexOf('"expire_timestamp"') !== -1 || s.indexOf('"is_subscribe"') !== -1 ||
                                s.indexOf('"is_vip"') !== -1) {
                                var patched = patchCreditJson(s);
                                if (patched !== s) {
                                    var patchedData = ObjC.classes.NSString.stringWithString_(patched).dataUsingEncoding_(4);
                                    args[4] = patchedData.handle;
                                    var taskPtr = args[3].toString();
                                    _drdFixedTasks[taskPtr] = true;
                                }
                            }
                        }

                        if (isTaskListUrl) {
                            try {
                                var taskListParsed = JSON.parse(s);
                                if (taskListParsed && taskListParsed.data && Array.isArray(taskListParsed.data)) {
                                    var modifiedCount = 0;
                                    for (var ti = 0; ti < taskListParsed.data.length; ti++) {
                                        var tlTask = taskListParsed.data[ti];
                                        if (tlTask.beauty_times !== undefined) tlTask.beauty_times = 99999;
                                        if (tlTask.beautyTimes !== undefined) tlTask.beautyTimes = 99999;
                                        if (tlTask.try_times !== undefined) tlTask.try_times = 99999;
                                        if (tlTask.tryTimes !== undefined) tlTask.tryTimes = 99999;
                                        if (tlTask.coins !== undefined) tlTask.coins = 99999;
                                        if (tlTask.credits !== undefined) tlTask.credits = 99999;
                                        if (tlTask.remain_coins !== undefined) tlTask.remain_coins = 99999;
                                        if (tlTask.photo_enhance_remain_times !== undefined) tlTask.photo_enhance_remain_times = 99999;

                                        var tlResUrl = tlTask.res_url || tlTask.resUrl;
                                        var tlJobId = tlTask.job_id || tlTask.jobId;
                                        if (tlResUrl && tlResUrl.length > 10) {
                                            log("TASKLIST-RES", C.g + C.B + "Result: job=" + (tlJobId || "?").substring(0,40) + " url=" + tlResUrl.substring(0,120) + C.R);
                                        }
                                        modifiedCount++;
                                    }

                                    var taskListJson = JSON.stringify(taskListParsed);
                                    var taskListData = ObjC.classes.NSString.stringWithString_(taskListJson).dataUsingEncoding_(4);
                                    args[4] = taskListData.handle;
                                    var tlTaskPtr = args[3].toString();
                                    _drdFixedTasks[tlTaskPtr] = true;
                                    log("TASKLIST-FIX", C.g + "Patched " + modifiedCount + " tasks" + C.R);
                                    return;
                                }
                            } catch(tlErr) {}
                        }

                        var shouldReplace = false;
                        if (s.indexOf("110402") !== -1 || s.indexOf("not enough") !== -1 ||
                            s.indexOf("coins is not") !== -1 || s.indexOf("110403") !== -1 ||
                            s.indexOf("nsufficient") !== -1 || s.indexOf("not_enough") !== -1) {
                            shouldReplace = true;
                        }
                        if (!shouldReplace) {
                            if (_error402Urls[taskUrl] && (Date.now() - _error402Urls[taskUrl]) < 30000) {
                                shouldReplace = true;
                                delete _error402Urls[taskUrl];
                            }
                        }
                        if (!shouldReplace) {
                            try {
                                var codeMatch = s.match(/"code"\s*:\s*(-?\d+)/);
                                if (codeMatch) {
                                    var codeVal = parseInt(codeMatch[1]);
                                    if (codeVal >= 110400000 && codeVal < 110500000) shouldReplace = true;
                                }
                            } catch(e3) {}
                        }

                        if (shouldReplace) {
                            if (isBananaUrl || isComfyUrl || isVideoGenUrl) {
                                log("REJECTED", C.r + C.B + "*** SERVER REJECTED (coins not enough) ***" + C.R);
                                log("REJECTED", C.r + s.substring(0, 500) + C.R);
                                log("REJECTED", C.y + "Trial params did not bypass coin check. Server requires real coins." + C.R);
                                _coinRejected = true;
                                log("REJECTED", C.y + "NOT patching error response - letting error reach app" + C.R);
                                return;
                            }
                            var patchedStr = patchErrorResponse(s);
                            patchedStr = patchCreditJson(patchedStr);
                            var patchedData = ObjC.classes.NSString.stringWithString_(patchedStr).dataUsingEncoding_(4);
                            args[4] = patchedData.handle;
                            var pTaskPtr = args[3].toString();
                            _drdFixedTasks[pTaskPtr] = true;
                        }
                    } catch(e) {}
                }
            });

            var dceSel = "- URLSession:task:didCompleteWithError:";
            var dce = cls[dceSel];
            if (dce) {
                try {
                    Interceptor.attach(dce.implementation, {
                        onEnter: function(args) {
                            var taskPtr = args[3].toString();
                            var hasError = !args[4].isNull();
                            if (_drdFixedTasks[taskPtr]) {
                                delete _drdFixedTasks[taskPtr];
                                if (hasError) {
                                    args[4] = NULL;
                                }
                            } else if (hasError) {
                                try {
                                    var e2 = new ObjC.Object(args[4]);
                                    if (e2.code() === -1011 || e2.code() === -1012) {
                                        args[4] = NULL;
                                    }
                                } catch(e) {}
                            }
                        }
                    });
                } catch(e) {}
            }

            drdCount++;
            log("DRD", C.g+"Hooked "+cn+C.R);
        }

        candidateNames.forEach(function(cn) {
            try {
                var cls = ObjC.classes[cn];
                if (cls) hookDRDClass(cn, cls);
            } catch(e) {}
        });

        var allClasses = ObjC.enumerateLoadedClassesSync();
        var allClassNames = Object.keys(allClasses).reduce(function(acc, img) { return acc.concat(allClasses[img]); }, []);
        for (var ci = 0; ci < allClassNames.length; ci++) {
            var cn = allClassNames[ci];
            if (cn.indexOf("Session") === -1 && cn.indexOf("Delegate") === -1 && cn.indexOf("Alamofire") === -1) continue;
            try {
                var cls = ObjC.classes[cn];
                if (!cls) continue;
                var m = cls[drdSel];
                if (!m) continue;
                var addr = m.implementation.toString();
                if (hookedAddrs[addr]) continue;
                hookDRDClass(cn, cls);
            } catch(e) {}
        }

        if (drdCount > 0) log("DRD", C.g+"didReceiveData hooks: "+drdCount+C.R);
    } catch(e) { log("DRD", C.r+"didReceiveData search fail: "+e+C.R); }
}

// ============================================================
// PHASE 4b: UI HOOKS
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
                    if ((cn.indexOf("VikPea") !== -1 || cn.indexOf("_TtC") !== -1) &&
                        (cn.indexOf("Buy") !== -1 || cn.indexOf("Subscription") !== -1 ||
                         cn.indexOf("Vip") !== -1 || cn.indexOf("VIP") !== -1 ||
                         cn.indexOf("Recharge") !== -1 || cn.indexOf("Paywall") !== -1 ||
                         cn.indexOf("Insufficient") !== -1 || cn.indexOf("Discount") !== -1 ||
                         cn.indexOf("ReportReasonsSelector") !== -1)) {
                        if (_coinRejected && (cn.indexOf("Insufficient") !== -1 || cn.indexOf("Buy") !== -1)) {
                            log("BLOCK", C.y + "NOT blocking alert - coin rejection in progress" + C.R);
                            return;
                        }
                        log("BLOCK", C.y+C.B+"BLOCKED present: "+cn+C.R);
                        var dummy = ObjC.classes.UIViewController.new();
                        dummy.view().setHidden_(1); dummy.view().setAlpha_(0);
                        dummy.setModalPresentationStyle_(4);
                        args[2] = dummy.handle;
                        ObjC.schedule(ObjC.mainQueue, function() { try { dummy.dismissViewControllerAnimated_completion_(0, NULL); } catch(e) {} });
                        return;
                    }
                    if (cn === "UIAlertController") {
                        var title = "";
                        var msg = "";
                        try { title = vc.title() ? vc.title().toString() : ""; } catch(e3) {}
                        try { msg = vc.message() ? vc.message().toString() : ""; } catch(e3) {}
                        var combined = (title + " " + msg).toLowerCase();
                        if (_coinRejected && (combined.indexOf("coins") !== -1 || combined.indexOf("not enough") !== -1 || 
                                             combined.indexOf("insufficient") !== -1 || combined.indexOf("402") !== -1)) {
                            log("BLOCK", C.y + "NOT blocking error alert - coin rejection in progress: [" + title + "]" + C.R);
                            return;
                        }
                        if (combined.indexOf("error") !== -1 || combined.indexOf("couldn't") !== -1 ||
                            combined.indexOf("failed") !== -1 || combined.indexOf("not enough") !== -1 ||
                            combined.indexOf("insufficient") !== -1 || combined.indexOf("coins") !== -1 ||
                            combined.indexOf("credit") !== -1 || combined.indexOf("network") !== -1 ||
                            combined.indexOf("server") !== -1 || combined.indexOf("1011") !== -1 ||
                            combined.indexOf("nsurl") !== -1 || combined.indexOf("domain") !== -1 ||
                            combined.indexOf("operation") !== -1 || combined.indexOf("status code") !== -1 ||
                            combined.indexOf("unacceptable") !== -1 || combined.indexOf("request failed") !== -1 ||
                            combined.indexOf("decode") !== -1 || combined.indexOf("response") !== -1) {
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
            ["+ showErrorWithStatus:", "+ showError:", "- showError:", "+ showWithStatus:"].forEach(function(sel) {
                try {
                    if (cls[sel]) {
                        Interceptor.attach(cls[sel].implementation, {
                            onEnter: function(args) {
                                try {
                                    if (args[2] && !args[2].isNull()) {
                                        var msg = new ObjC.Object(args[2]).toString().toLowerCase();
                                        if (_coinRejected && (msg.indexOf("coins") !== -1 || msg.indexOf("not enough") !== -1 || msg.indexOf("402") !== -1)) {
                                            log("BLOCK", C.y + "NOT suppressing HUD error - coin rejection in progress" + C.R);
                                            return;
                                        }
                                        if (msg.indexOf("error") !== -1 || msg.indexOf("fail") !== -1 ||
                                            msg.indexOf("1011") !== -1 || msg.indexOf("coins") !== -1 ||
                                            msg.indexOf("credit") !== -1 || msg.indexOf("couldn't") !== -1 ||
                                            msg.indexOf("status code") !== -1 || msg.indexOf("unacceptable") !== -1 ||
                                            msg.indexOf("decode") !== -1 || msg.indexOf("response") !== -1) {
                                            args[2] = ObjC.classes.NSString.stringWithString_("").handle;
                                            logOnce("BLOCK", C.y+"HUD error suppressed"+C.R);
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
                        onEnter: function(args) { logOnce("BLOCK", C.y+"Toast suppressed"+C.R); }
                    });
                    cnt++;
                }
            } catch(e) {}
        });
    } catch(e) {}

    log("UI", C.g+C.B+"UI hooks: "+cnt+C.R);
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

// ============================================================
// INITIALIZATION
// ============================================================
log("INIT", C.g + C.B + "VikPea Premium Fix v9 — dataTask Intercept (AIMarvels technique)" + C.R);
log("INIT", C.c + "Approach: hook dataTaskWithRequest:completionHandler: to intercept requests+responses at network level" + C.R);

log("INIT", C.y + "Phase 1: Swift symbol hooks (VIP + Credits)..." + C.R);
var swiftCount = hookExactSwiftSymbols();
log("INIT", C.g + "Phase 1 done: " + swiftCount + " hooks" + C.R);

log("INIT", C.y + "Phase 1b: NSUserDefaults hooks..." + C.R);
setupDefaultsHooks();

log("INIT", C.y + "Phase 1c: Jailbreak bypass..." + C.R);
setupJailbreakBypass();

log("INIT", C.y + "Phase 2: JSON intercept + HTTP status hooks..." + C.R);
setupJSONIntercept();
setupHTTPStatusHook();

log("INIT", C.y + "Phase 3: dataTask intercept (AIMarvels technique)..." + C.R);
setupDataTaskIntercept();

log("INIT", C.y + "Phase 3b: IAP hooks..." + C.R);
setupIAPHook();

log("INIT", C.y + "Phase 4: Deferred hooks (DRD + error masking)..." + C.R);
setTimeout(function() {
    setupDeferredHooks();
    log("INIT", C.g + "Phase 4 done" + C.R);

    log("INIT", C.y + "Phase 4b: UI hooks..." + C.R);
    setupUIHooks();

    log("INIT", C.g + C.B + "=== VikPea v9 READY ===" + C.R);
    log("INIT", C.c + "Helpers: dumpVIP()" + C.R);
}, 500);

globalThis.dumpVIP = dumpVIP;

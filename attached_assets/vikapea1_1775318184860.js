/*
 * VikPea Premium Fix v4.4 - EXACT Swift Symbol Hooks
 *
 * v4.3 found 161 symbols but only hooked 4. Missing critical isVIP getters.
 * v4.4 uses EXACT symbol names from the dump for guaranteed hooking.
 *
 * Usage: frida -U -f com.hitpaw.ven -l frida_vikpea_fix_v4.js --no-pause
 */

var C = {R:"\x1b[0m",r:"\x1b[31m",g:"\x1b[32m",y:"\x1b[33m",c:"\x1b[36m",B:"\x1b[1m"};
function log(t,m) { console.log(C.B+"["+t+"]"+C.R+" "+m); }

// ============================================================
// EXACT SWIFT SYMBOL HOOKS (from v4.3 symbol dump)
// ============================================================
function hookExactSwiftSymbols() {
    var cnt = 0;
    var vikpeaMod = null;
    Process.enumerateModules().forEach(function(m) { if (m.name === "VikPea") vikpeaMod = m; });
    if (!vikpeaMod) { log("SWIFT", C.r+"VikPea module not found"+C.R); return 0; }
    log("SWIFT", "VikPea base=" + vikpeaMod.base);

    // Build symbol lookup table from symbol table (nlist), NOT export trie
    // These symbols are NOT exports - findExportByName won't find them!
    var symMap = {};
    log("SWIFT", "Building symbol table...");
    try {
        vikpeaMod.enumerateSymbols().forEach(function(sym) {
            symMap[sym.name] = sym.address;
        });
    } catch(e) { log("SWIFT", C.r+"enumerateSymbols failed: "+e+C.R); return 0; }
    log("SWIFT", "Symbol table: " + Object.keys(symMap).length + " entries");

    function hookSym(name, retVal, label) {
        var addr = symMap[name];
        if (!addr) {
            // Try with underscore prefix (Mach-O convention)
            addr = symMap["_" + name];
        }
        if (addr) {
            try {
                Interceptor.attach(addr, {
                    onLeave: function(retval) { retval.replace(retVal); }
                });
                cnt++;
                log("SWIFT", (retVal ? C.g : C.c) + C.B + (retVal?"TRUE":"FALSE") + ": " + label + C.R);
                return true;
            } catch(e) { log("SWIFT", C.r+"Hook fail: "+label+" => "+e+C.R); }
        } else {
            log("SWIFT", C.y+"Not found: "+label+C.R);
        }
        return false;
    }

    // === HOOK TRUE (return 1) ===
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

    // === HOOK FALSE (return 0) ===
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC9isInvalidSbvg", 0, "SubInfo.isInvalid");
    hookSym("$s6VikPea10IAPManagerC16SubscriptionInfoC12shouldUpdateSbvg", 0, "SubInfo.shouldUpdate");

    // === HOOK isVip SETTER on HomeVC (force value to true) ===
    var setVipAddr = symMap["$s6VikPea18HomeViewControllerC5isVip33_68938E885D7C1C8457B60DFE3E7CB6CALLSbvs"];
    if (setVipAddr) {
        try {
            Interceptor.attach(setVipAddr, {
                onEnter: function(args) { args[0] = ptr(1); }
            });
            cnt++;
            log("SWIFT", C.g+"HomeVC.isVip setter → force true"+C.R);
        } catch(e) {}
    }

    log("SWIFT", C.g+C.B+"Total Swift hooks: "+cnt+C.R);
    return cnt;
}

// ============================================================
// 1. JAILBREAK BYPASS
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
// 2. FAKE RECEIPT + CREDIT JSON PATCHER
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
        .replace(/"coins"\s*:\s*\d+/g, '"coins":99999')
        .replace(/"total_coins"\s*:\s*\d+/g, '"total_coins":99999')
        .replace(/"try_times"\s*:\s*-?\d+/g, '"try_times":99999')
        .replace(/"beauty_times"\s*:\s*-?\d+/g, '"beauty_times":99999')
        .replace(/"video_matting_remain_times"\s*:\s*-?\d+/g, '"video_matting_remain_times":99999')
        .replace(/"matting_remain_times"\s*:\s*-?\d+/g, '"matting_remain_times":99999')
        .replace(/"photo_enhance_remain_times"\s*:\s*-?\d+/g, '"photo_enhance_remain_times":99999')
        .replace(/"watermark_remove_remain_times"\s*:\s*-?\d+/g, '"watermark_remove_remain_times":99999')
        .replace(/"media_analyze_remain_times"\s*:\s*-?\d+/g, '"media_analyze_remain_times":99999')
        .replace(/"remain_digital_human_times"\s*:\s*(true|false|\d+)/g, '"remain_digital_human_times":99999')
        .replace(/"remain_voice_clone_times"\s*:\s*(true|false|\d+)/g, '"remain_voice_clone_times":99999')
        .replace(/"status"\s*:\s*"[Ee]xpired"/g, '"status":"Active"')
        .replace(/"expire_timestamp"\s*:\s*\d+/g, '"expire_timestamp":'+ft)
        .replace(/"is_subscribe"\s*:\s*false/g, '"is_subscribe":true')
        .replace(/"is_subscribing"\s*:\s*false/g, '"is_subscribing":true')
        .replace(/"is_vip"\s*:\s*false/g, '"is_vip":true')
        .replace(/"has_subscription"\s*:\s*false/g, '"has_subscription":true')
        .replace(/"credits"\s*:\s*\d+/g, '"credits":99999')
        .replace(/"gift_coins_count"\s*:\s*\d+/g, '"gift_coins_count":99999')
        .replace(/"has_gift_coins"\s*:\s*false/g, '"has_gift_coins":true')
        .replace(/"user_role"\s*:\s*"[^"]*"/g, '"user_role":"vip"');
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
                            else if (str.indexOf('"coins"') !== -1 || str.indexOf('"credits"') !== -1 ||
                                     str.indexOf('"expire_timestamp"') !== -1 || str.indexOf('"gift_coins') !== -1 ||
                                     str.indexOf('"is_subscribe"') !== -1 || str.indexOf('"is_vip"') !== -1 ||
                                     str.indexOf('"user_role"') !== -1) {
                                var patched = patchCreditJson(str);
                                if (patched !== str) {
                                    log("CREDITS", C.g+"API patched (coins=99999)"+C.R);
                                    return orig(self, sel, s2d(patched).handle, opts, errp);
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
// 3. IAP TRANSACTION STATE FIX
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
// 4. UI HOOKS - Block BuyViewController
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

    // Block present
    try {
        Interceptor.attach(ObjC.classes.UIViewController["- presentViewController:animated:completion:"].implementation, {
            onEnter: function(args) {
                try {
                    var cn = new ObjC.Object(args[2]).$className;
                    if (cn.indexOf("VikPea") !== -1) log("PRESENT", C.c+cn+C.R);
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
                    }
                } catch(e) {}
            }
        });
        cnt++;
    } catch(e) {}

    // Block push
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

    // Hide subscription views
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

    log("UI", C.g+C.B+"UI hooks: "+cnt+C.R);
}

// ============================================================
// 5. NET LOGGER
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

// ============================================================
// MAIN
// ============================================================
console.log("\n"+C.B+C.g+"=== VikPea Premium FIX v4.4 ==="+C.R+"\n");

// Phase 1: Lightweight hooks (immediate, safe at spawn)
setupJailbreakBypass();
setupJSONIntercept();
setupIAPHook();
log("STAGE", C.g+C.B+"Phase 1: Core hooks done"+C.R);

// Phase 2: EXACT Swift symbol hooks (3s - after modules loaded)
setTimeout(function() {
    log("STAGE", C.c+"Phase 2: Swift symbol hooks..."+C.R);
    var n = hookExactSwiftSymbols();
    log("STAGE", C.g+C.B+"Phase 2 done: "+n+" Swift hooks"+C.R);
}, 3000);

// Phase 3: UI hooks (2s)
setTimeout(function() {
    log("STAGE", C.c+"Phase 3: UI hooks..."+C.R);
    setupUIHooks();
    setupNetLogger();
}, 2000);

console.log("\n"+C.g+C.B+"[*] v4.4 loaded!"+C.R);
console.log("    Phase 1 (0s): JB + JSON + IAP");
console.log("    Phase 2 (3s): "+C.g+C.B+"EXACT Swift symbol hooks"+C.R+" (isVIP, isSubscribing, etc.)");
console.log("    Phase 3 (2s): UI suppression + NET");
console.log(C.y+"    Key: Hook isVIP/isSubscribing GETTERS → always true"+C.R);
console.log(C.c+"\n    dumpVIP()        - Show state");
console.log("    checkAIMarvels() - Check AIMarvels"+C.R+"\n");

/*
 * BlurrrFull v2.0 — MobileSubstrate Tweak (All-in-One)
 * Target: com.pinguo.msgAries (Blurrr v2.3.56)
 *
 * Built to match BlurrrVip.dylib structure exactly:
 * - No ARC (manual retain/release not needed — hooks are simple)
 * - flat_namespace for safe symbol resolution
 * - Same libraries as original
 */

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import "sdk/usr/include/substrate.h"

#define JUICE_AMOUNT 99999
#define VIP_EXPIRE 9999999999.0

static NSDictionary *fakeSVIPResponse(void) {
    return [NSDictionary dictionaryWithObjects:(id[]){
        @1, @"yearSvip", @"svip", @"svip", @YES, @YES,
        @"yearly_membership_pkg3", @(VIP_EXPIRE),
        @NO, @NO, @(VIP_EXPIRE),
        @"lv3", @"lv3", @YES, @0, @NO
    } forKeys:(id[]){
        @"vipState", @"vip", @"stage", @"grade", @"year", @"svip",
        @"validSubscribeProductID", @"vipExpireTime",
        @"isTrialPeriod", @"trialPeriod", @"expire",
        @"creatorBadge", @"mentorBadge", @"goldbg", @"errorCode", @"sandbox"
    } count:16];
}

static NSDictionary *fakeJuiceResponse(void) {
    return [NSDictionary dictionaryWithObjects:(id[]){@(JUICE_AMOUNT)}
                                      forKeys:(id[]){@"amount"} count:1];
}

static NSDictionary *fakeConsumeResponse(void) {
    return [NSDictionary dictionaryWithObjects:(id[]){@0, @(JUICE_AMOUNT), @(JUICE_AMOUNT)}
                                      forKeys:(id[]){@"errorCode", @"balance", @"amount"} count:3];
}

static NSData *dictToJSON(NSDictionary *dict) {
    if (!dict) return nil;
    return [NSJSONSerialization dataWithJSONObject:dict options:0 error:nil];
}

static void (*orig_didReceiveData)(id, SEL, id, id, id);
static void hook_didReceiveData(id self, SEL _cmd, id session, id dataTask, id data) {
    if (!dataTask || !data) {
        orig_didReceiveData(self, _cmd, session, dataTask, data);
        return;
    }

    NSURLRequest *request = nil;
    if ([dataTask respondsToSelector:@selector(currentRequest)]) {
        request = [dataTask performSelector:@selector(currentRequest)];
    }
    if (!request) {
        orig_didReceiveData(self, _cmd, session, dataTask, data);
        return;
    }

    NSURL *reqURL = [request URL];
    if (!reqURL) {
        orig_didReceiveData(self, _cmd, session, dataTask, data);
        return;
    }

    NSString *url = [reqURL absoluteString];
    if (!url) {
        orig_didReceiveData(self, _cmd, session, dataTask, data);
        return;
    }

    NSString *httpMethod = [request HTTPMethod];

    if ([url containsString:@"subscribe"] ||
        [url containsString:@"/user/vip"] ||
        [url containsString:@"membership"] ||
        [url containsString:@"report-receipt"] ||
        [url containsString:@"usercenter"] ||
        [url containsString:@"user/info"]) {

        NSData *fakeData = dictToJSON(fakeSVIPResponse());
        if (fakeData) {
            orig_didReceiveData(self, _cmd, session, dataTask, fakeData);
            return;
        }
    }

    BOOL isJuice = [url containsString:@"/juice"];
    BOOL isCoin = [url containsString:@"/coin"];

    if (isJuice || isCoin) {
        if ([url containsString:@"consume"] ||
            [url containsString:@"expend"] ||
            [url containsString:@"deduct"] ||
            [url containsString:@"spend"] ||
            ([httpMethod isEqualToString:@"POST"] &&
             ![url containsString:@"config"] &&
             ![url containsString:@"log"] &&
             ![url containsString:@"purchase"])) {

            NSData *fakeData = dictToJSON(fakeConsumeResponse());
            if (fakeData) {
                orig_didReceiveData(self, _cmd, session, dataTask, fakeData);
                return;
            }
        }

        if (![url containsString:@"config"] &&
            ![url containsString:@"log"] &&
            ![url containsString:@"purchase"]) {

            NSData *fakeData = dictToJSON(fakeJuiceResponse());
            if (fakeData) {
                orig_didReceiveData(self, _cmd, session, dataTask, fakeData);
                return;
            }
        }
    }

    orig_didReceiveData(self, _cmd, session, dataTask, data);
}

static NSInteger (*orig_balanceJuice)(id, SEL);
static NSInteger hook_balanceJuice(id self, SEL _cmd) { return JUICE_AMOUNT; }

static void (*orig_setBalanceJuice)(id, SEL, NSInteger);
static void hook_setBalanceJuice(id self, SEL _cmd, NSInteger val) {
    if (orig_setBalanceJuice) orig_setBalanceJuice(self, _cmd, JUICE_AMOUNT);
}

static NSInteger (*orig_juiceFromServer)(id, SEL);
static NSInteger hook_juiceFromServer(id self, SEL _cmd) { return JUICE_AMOUNT; }

static void (*orig_setJuiceFromServer)(id, SEL, NSInteger);
static void hook_setJuiceFromServer(id self, SEL _cmd, NSInteger val) {
    if (orig_setJuiceFromServer) orig_setJuiceFromServer(self, _cmd, JUICE_AMOUNT);
}

static BOOL (*orig_isVip)(id, SEL);
static BOOL hook_isVip(id self, SEL _cmd) { return YES; }

static void (*orig_setIsVip)(id, SEL, BOOL);
static void hook_setIsVip(id self, SEL _cmd, BOOL val) {
    if (orig_setIsVip) orig_setIsVip(self, _cmd, YES);
}

static NSInteger (*orig_balanceExportCard)(id, SEL);
static NSInteger hook_balanceExportCard(id self, SEL _cmd) { return JUICE_AMOUNT; }

static NSInteger (*orig_balanceInvite)(id, SEL);
static NSInteger hook_balanceInvite(id self, SEL _cmd) { return JUICE_AMOUNT; }

static BOOL (*orig_consumeCoinTips)(id, SEL);
static BOOL hook_consumeCoinTips(id self, SEL _cmd) { return NO; }

static BOOL (*orig_evaluateServerTrust)(id, SEL, id, id);
static BOOL hook_evaluateServerTrust(id self, SEL _cmd, id trust, id domain) { return YES; }

static BOOL (*orig_fileExistsAtPath)(id, SEL, NSString*);
static BOOL hook_fileExistsAtPath(id self, SEL _cmd, NSString *path) {
    if (path) {
        if ([path containsString:@"Cydia"] ||
            [path containsString:@"MobileSubstrate"] ||
            [path containsString:@"/bin/bash"] ||
            [path containsString:@"sshd"] ||
            [path containsString:@"/etc/apt"] ||
            [path containsString:@"var/lib/apt"] ||
            [path containsString:@"var/lib/cydia"] ||
            [path containsString:@"Sileo"] ||
            [path containsString:@"/var/jb"] ||
            [path containsString:@"Zebra"]) {
            return NO;
        }
    }
    return orig_fileExistsAtPath(self, _cmd, path);
}

static BOOL (*orig_canOpenURL)(id, SEL, NSURL*);
static BOOL hook_canOpenURL(id self, SEL _cmd, NSURL *url) {
    if (url) {
        NSString *s = [url absoluteString];
        if (s && ([s containsString:@"cydia"] || [s containsString:@"sileo"] ||
            [s containsString:@"zbra"] || [s containsString:@"filza"])) {
            return NO;
        }
    }
    return orig_canOpenURL(self, _cmd, url);
}

__attribute__((constructor))
static void blurrfull_init(void) {
    NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
    [defaults setInteger:1 forKey:@"vipState"];
    [defaults setObject:@"yearSvip" forKey:@"vip"];
    [defaults setObject:@"yearly_membership_pkg3" forKey:@"validSubscribeProductID"];
    [defaults setDouble:VIP_EXPIRE forKey:@"vipExpireTime"];
    [defaults setBool:NO forKey:@"isVipTrialPeriod"];
    [defaults setBool:YES forKey:@"isExistSubscribeHistoryWithUser"];
    [defaults setInteger:JUICE_AMOUNT forKey:@"balanceJuice"];
    [defaults setInteger:JUICE_AMOUNT forKey:@"balanceExportCard"];
    [defaults setInteger:JUICE_AMOUNT forKey:@"balanceInvite"];
    [defaults setBool:NO forKey:@"consumeCoinTips"];
    [defaults synchronize];

    Class sessionDelegate = objc_getClass("Alamofire.SessionDelegate");
    if (sessionDelegate) {
        MSHookMessageEx(sessionDelegate,
            @selector(URLSession:dataTask:didReceiveData:),
            (IMP)&hook_didReceiveData,
            (IMP*)&orig_didReceiveData);
    }

    Class userHelper = objc_getClass("Aries.MSUserDefaultHelper");
    if (userHelper) {
        MSHookMessageEx(userHelper, @selector(balanceJuice),       (IMP)&hook_balanceJuice,       (IMP*)&orig_balanceJuice);
        MSHookMessageEx(userHelper, @selector(setBalanceJuice:),   (IMP)&hook_setBalanceJuice,    (IMP*)&orig_setBalanceJuice);
        MSHookMessageEx(userHelper, @selector(juiceFromServer),    (IMP)&hook_juiceFromServer,    (IMP*)&orig_juiceFromServer);
        MSHookMessageEx(userHelper, @selector(setJuiceFromServer:),(IMP)&hook_setJuiceFromServer, (IMP*)&orig_setJuiceFromServer);
        MSHookMessageEx(userHelper, @selector(isVip),              (IMP)&hook_isVip,              (IMP*)&orig_isVip);
        MSHookMessageEx(userHelper, @selector(setIsVip:),          (IMP)&hook_setIsVip,           (IMP*)&orig_setIsVip);
        MSHookMessageEx(userHelper, @selector(balanceExportCard),  (IMP)&hook_balanceExportCard,  (IMP*)&orig_balanceExportCard);
        MSHookMessageEx(userHelper, @selector(balanceInvite),      (IMP)&hook_balanceInvite,      (IMP*)&orig_balanceInvite);
        MSHookMessageEx(userHelper, @selector(consumeCoinTips),    (IMP)&hook_consumeCoinTips,    (IMP*)&orig_consumeCoinTips);
    }

    Class afPolicy = objc_getClass("AFSecurityPolicy");
    if (afPolicy) {
        MSHookMessageEx(afPolicy, @selector(evaluateServerTrust:forDomain:),
            (IMP)&hook_evaluateServerTrust, (IMP*)&orig_evaluateServerTrust);
    }

    Class fmClass = objc_getClass("NSFileManager");
    if (fmClass) {
        MSHookMessageEx(fmClass, @selector(fileExistsAtPath:),
            (IMP)&hook_fileExistsAtPath, (IMP*)&orig_fileExistsAtPath);
    }

    Class appClass = objc_getClass("UIApplication");
    if (appClass) {
        MSHookMessageEx(appClass, @selector(canOpenURL:),
            (IMP)&hook_canOpenURL, (IMP*)&orig_canOpenURL);
    }

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        NSUserDefaults *def = [NSUserDefaults standardUserDefaults];
        [def setInteger:JUICE_AMOUNT forKey:@"balanceJuice"];
        [def setInteger:JUICE_AMOUNT forKey:@"balanceExportCard"];
        [def setBool:YES forKey:@"isVip"];
        [def synchronize];

        if (!orig_didReceiveData) {
            Class sd = objc_getClass("Alamofire.SessionDelegate");
            if (sd) {
                MSHookMessageEx(sd,
                    @selector(URLSession:dataTask:didReceiveData:),
                    (IMP)&hook_didReceiveData,
                    (IMP*)&orig_didReceiveData);
            }
        }
    });
}

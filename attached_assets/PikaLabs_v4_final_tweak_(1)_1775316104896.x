#include <objc/runtime.h>
#include <objc/message.h>
#include <dlfcn.h>
#include <string.h>
#include <syslog.h>

#define nil ((id)0)

static BOOL (*orig_boolForKey)(id self, SEL _cmd, id key);
static id (*orig_objectForKey)(id self, SEL _cmd, id key);
static void (*orig_setBool)(id self, SEL _cmd, BOOL value, id key);
static BOOL (*orig_fileExistsAtPath)(id self, SEL _cmd, id path);

static id createNSString(const char *str) {
    Class NSString = objc_getClass("NSString");
    SEL sel = sel_registerName("stringWithUTF8String:");
    return ((id(*)(Class, SEL, const char*))objc_msgSend)(NSString, sel, str);
}

static BOOL isEqualToString(id str1, const char *cstr) {
    SEL sel = sel_registerName("isEqualToString:");
    id nsstr = createNSString(cstr);
    return ((BOOL(*)(id, SEL, id))objc_msgSend)(str1, sel, nsstr);
}

static const char* toCString(id nsstr) {
    SEL sel = sel_registerName("UTF8String");
    return ((const char*(*)(id, SEL))objc_msgSend)(nsstr, sel);
}

static BOOL hook_boolForKey(id self, SEL _cmd, id key) {
    if (key && isEqualToString(key, "isPremium")) {
        return YES;
    }
    return orig_boolForKey(self, _cmd, key);
}

static id hook_objectForKey(id self, SEL _cmd, id key) {
    if (key && isEqualToString(key, "isPremium")) {
        return ((id(*)(Class, SEL, BOOL))objc_msgSend)(objc_getClass("NSNumber"), sel_registerName("numberWithBool:"), YES);
    }
    return orig_objectForKey(self, _cmd, key);
}

static void hook_setBool(id self, SEL _cmd, BOOL value, id key) {
    if (key && isEqualToString(key, "isPremium")) {
        orig_setBool(self, _cmd, YES, key);
        return;
    }
    orig_setBool(self, _cmd, value, key);
}

static BOOL hook_fileExistsAtPath(id self, SEL _cmd, id path) {
    if (path) {
        const char *p = toCString(path);
        if (p && (strstr(p, "Cydia") || strstr(p, "substrate") ||
                  strstr(p, "binpack") || strstr(p, "sshd") ||
                  strstr(p, "/bin/bash") || strstr(p, "/etc/apt") ||
                  strstr(p, "cycript") || strstr(p, "dpkg"))) {
            return NO;
        }
    }
    return orig_fileExistsAtPath(self, _cmd, path);
}

__attribute__((constructor))
static void init(void) {
    syslog(LOG_WARNING, "[PikaBypass] LOADING...");

    Class NSUserDefaults = objc_getClass("NSUserDefaults");
    Class NSFileManager = objc_getClass("NSFileManager");

    if (!NSUserDefaults || !NSFileManager) {
        syslog(LOG_ERR, "[PikaBypass] Classes not found!");
        return;
    }

    Method m1 = class_getInstanceMethod(NSUserDefaults, sel_registerName("boolForKey:"));
    Method m2 = class_getInstanceMethod(NSUserDefaults, sel_registerName("objectForKey:"));
    Method m3 = class_getInstanceMethod(NSUserDefaults, sel_registerName("setBool:forKey:"));
    Method m4 = class_getInstanceMethod(NSFileManager, sel_registerName("fileExistsAtPath:"));

    if (m1) {
        orig_boolForKey = (BOOL(*)(id, SEL, id))method_getImplementation(m1);
        method_setImplementation(m1, (IMP)hook_boolForKey);
        syslog(LOG_WARNING, "[PikaBypass] boolForKey: HOOKED");
    }
    if (m2) {
        orig_objectForKey = (id(*)(id, SEL, id))method_getImplementation(m2);
        method_setImplementation(m2, (IMP)hook_objectForKey);
        syslog(LOG_WARNING, "[PikaBypass] objectForKey: HOOKED");
    }
    if (m3) {
        orig_setBool = (void(*)(id, SEL, BOOL, id))method_getImplementation(m3);
        method_setImplementation(m3, (IMP)hook_setBool);
        syslog(LOG_WARNING, "[PikaBypass] setBool:forKey: HOOKED");
    }
    if (m4) {
        orig_fileExistsAtPath = (BOOL(*)(id, SEL, id))method_getImplementation(m4);
        method_setImplementation(m4, (IMP)hook_fileExistsAtPath);
        syslog(LOG_WARNING, "[PikaBypass] fileExistsAtPath: HOOKED");
    }

    id ud = ((id(*)(Class, SEL))objc_msgSend)(NSUserDefaults, sel_registerName("standardUserDefaults"));
    ((void(*)(id, SEL, BOOL, id))objc_msgSend)(ud, sel_registerName("setBool:forKey:"), YES, createNSString("isPremium"));
    ((void(*)(id, SEL))objc_msgSend)(ud, sel_registerName("synchronize"));

    syslog(LOG_WARNING, "[PikaBypass] DONE — isPremium = YES");
}

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@interface PigeonDocumentSnapshot : NSObject
@property (copy, nonatomic) NSString *path;
@property (retain, nonatomic) NSDictionary *data;
@end

@interface FLTFirebaseFirestorePlugin : NSObject
- (void)documentReferenceGetApp:(id)app request:(id)request completion:(void (^)(PigeonDocumentSnapshot *, id))completion;
@end

static NSString *detectedUID = nil;
static NSString *shownVideoPath = nil;
static NSString *shownPdfPath = nil;

static BOOL isJBPath(NSString *path) {
    static NSArray *jbPaths = nil;
    if (!jbPaths) {
        jbPaths = @[
            @"/Applications/Cydia.app",
            @"/Library/MobileSubstrate/MobileSubstrate.dylib",
            @"/bin/bash",
            @"/usr/sbin/sshd",
            @"/etc/apt",
            @"/usr/bin/ssh",
            @"/var/jb",
            @"/var/binpack",
            @"/.bootstrapped",
            @"/usr/lib/TweakInject",
            @"/Library/TweakInject"
        ];
    }
    for (NSString *jb in jbPaths) {
        if ([path isEqualToString:jb]) return YES;
    }
    if ([path containsString:@"Cydia"] || [path containsString:@"substrate"] || [path containsString:@"TweakInject"]) return YES;
    return NO;
}

static void showPopup(NSString *title, NSArray<NSDictionary *> *items) {
    dispatch_async(dispatch_get_main_queue(), ^{
        UIAlertController *alert = [UIAlertController alertControllerWithTitle:title message:nil preferredStyle:UIAlertControllerStyleActionSheet];

        for (NSDictionary *item in items) {
            NSString *name = item[@"name"];
            NSString *url = item[@"url"];

            UIAlertAction *action = [UIAlertAction actionWithTitle:name style:UIAlertActionStyleDefault handler:^(UIAlertAction *a) {
                [UIPasteboard generalPasteboard].string = url;

                UIAlertController *copied = [UIAlertController alertControllerWithTitle:@"Copied!" message:url preferredStyle:UIAlertControllerStyleAlert];
                [copied addAction:[UIAlertAction actionWithTitle:@"Open" style:UIAlertActionStyleDefault handler:^(UIAlertAction *a2) {
                    [[UIApplication sharedApplication] openURL:[NSURL URLWithString:url] options:@{} completionHandler:nil];
                }]];
                [copied addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleCancel handler:nil]];

                UIViewController *vc = [UIApplication sharedApplication].keyWindow.rootViewController;
                while (vc.presentedViewController) vc = vc.presentedViewController;
                [vc presentViewController:copied animated:YES completion:nil];
            }];
            [alert addAction:action];
        }

        [alert addAction:[UIAlertAction actionWithTitle:@"Close" style:UIAlertActionStyleCancel handler:nil]];

        UIViewController *vc = [UIApplication sharedApplication].keyWindow.rootViewController;
        while (vc.presentedViewController) vc = vc.presentedViewController;
        [vc presentViewController:alert animated:YES completion:nil];
    });
}

%hook NSFileManager
- (BOOL)fileExistsAtPath:(NSString *)path {
    if (isJBPath(path)) return NO;
    return %orig;
}
- (BOOL)fileExistsAtPath:(NSString *)path isDirectory:(BOOL *)isDirectory {
    if (isJBPath(path)) return NO;
    return %orig;
}
%end

%hook UIApplication
- (BOOL)canOpenURL:(NSURL *)url {
    NSString *s = url.absoluteString;
    if ([s containsString:@"cydia"] || [s containsString:@"sileo"] || [s containsString:@"zebra"] || [s containsString:@"filza"]) return NO;
    return %orig;
}
%end

%hook FLTFirebaseFirestorePlugin
- (void)documentReferenceGetApp:(id)app request:(id)request completion:(void (^)(PigeonDocumentSnapshot *, id))completion {
    void (^newCompletion)(PigeonDocumentSnapshot *, id) = ^(PigeonDocumentSnapshot *snapshot, id error) {
        @try {
            if (snapshot && snapshot.path) {
                NSString *sp = snapshot.path;

                if ([sp hasPrefix:@"users/"] && ![sp containsString:@"allowUsers"] && ![sp containsString:@"/notifications"] && !detectedUID) {
                    NSArray *parts = [sp componentsSeparatedByString:@"/"];
                    if (parts.count == 2) {
                        detectedUID = [parts[1] copy];
                        NSLog(@"[3afer] UID: %@", detectedUID);
                    }
                }

                if ([sp containsString:@"allowUsers/allowUser"] && detectedUID) {
                    NSMutableDictionary *mData;
                    if (snapshot.data) {
                        mData = [snapshot.data mutableCopy];
                    } else {
                        mData = [NSMutableDictionary dictionary];
                    }

                    NSMutableDictionary *activationList;
                    if (mData[@"activation list"]) {
                        activationList = [mData[@"activation list"] mutableCopy];
                    } else {
                        activationList = [NSMutableDictionary dictionary];
                    }

                    activationList[detectedUID] = @{
                        @"data": @"2024-01-01",
                        @"endDate": @"2030-12-31"
                    };
                    mData[@"activation list"] = activationList;
                    snapshot.data = mData;
                    NSLog(@"[3afer] BYPASS: %@", sp);
                }

                if ([sp containsString:@"/videos/"] && ![sp isEqualToString:shownVideoPath]) {
                    shownVideoPath = [sp copy];
                    NSDictionary *d = snapshot.data;
                    if (d && d[@"video_list"]) {
                        NSArray *vList = d[@"video_list"];
                        NSMutableArray *items = [NSMutableArray array];
                        for (NSUInteger i = 0; i < vList.count; i++) {
                            NSDictionary *v = vList[i];
                            NSString *vurl = v[@"video_url"] ?: @"";
                            NSString *ch = v[@"chapter Num"] ?: [NSString stringWithFormat:@"Video %lu", (unsigned long)(i+1)];
                            if (ch.length == 0) ch = [NSString stringWithFormat:@"Video %lu", (unsigned long)(i+1)];
                            if (vurl.length > 0) {
                                [items addObject:@{@"name": ch, @"url": vurl}];
                            }
                        }
                        if (items.count > 0) {
                            NSLog(@"[3afer] VIDEOS: %lu", (unsigned long)items.count);
                            showPopup([NSString stringWithFormat:@"Videos (%lu)", (unsigned long)items.count], items);
                        }
                    }
                }

                if ([sp containsString:@"/pdfs/"] && ![sp isEqualToString:shownPdfPath]) {
                    shownPdfPath = [sp copy];
                    NSDictionary *d = snapshot.data;
                    if (d && d[@"pdf_list"]) {
                        NSArray *pList = d[@"pdf_list"];
                        NSMutableArray *items = [NSMutableArray array];
                        for (NSUInteger i = 0; i < pList.count; i++) {
                            NSDictionary *p = pList[i];
                            NSString *purl = p[@"pdf_url"] ?: @"";
                            NSString *ch = p[@"lecturer Num"] ?: [NSString stringWithFormat:@"PDF %lu", (unsigned long)(i+1)];
                            if (ch.length == 0) ch = [NSString stringWithFormat:@"PDF %lu", (unsigned long)(i+1)];
                            if (purl.length > 0) {
                                [items addObject:@{@"name": ch, @"url": purl}];
                            }
                        }
                        if (items.count > 0) {
                            NSLog(@"[3afer] PDFS: %lu", (unsigned long)items.count);
                            showPopup([NSString stringWithFormat:@"PDFs (%lu)", (unsigned long)items.count], items);
                        }
                    }
                }
            }
        } @catch (NSException *e) {}

        if (completion) completion(snapshot, error);
    };
    %orig(app, request, newCompletion);
}
%end

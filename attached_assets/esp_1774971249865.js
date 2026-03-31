/*
 * spott codm - v22
 * frida -U -f com.spott.codm -l test_esp.js
 */

function waitForClass(name, cb) {
    var t = setInterval(function() { if (ObjC.classes[name]) { clearInterval(t); cb(); } }, 300);
}

function setup() {
    waitForClass('HackViewController', function() {
        setTimeout(function() {
            ObjC.schedule(ObjC.mainQueue, function() {
                try {
                    var app = ObjC.classes.UIApplication.sharedApplication();
                    var mainWin = app.keyWindow() || app.windows().objectAtIndex_(0);
                    var scene = mainWin.windowScene();
                    var screen = ObjC.classes.UIScreen.mainScreen().bounds();
                    var sw = screen[1][0];
                    var sh = screen[1][1];

                    var win = ObjC.classes.HUDOverlayWindow.alloc().initWithWindowScene_(scene);
                    win.setFrame_([[0, 0], [sw, sh]]);
                    win.setWindowLevel_(2147483647);
                    win.setBackgroundColor_(ObjC.classes.UIColor.clearColor());
                    win.setUserInteractionEnabled_(false);

                    var vc = ObjC.classes.UIViewController.alloc().init();
                    vc.view().setBackgroundColor_(ObjC.classes.UIColor.clearColor());
                    win.setRootViewController_(vc);
                    win.setHidden_(false);
                    win.makeKeyAndVisible();
                    console.log("[+] Window created");

                    // QBL 0 label (top)
                    var lbl = ObjC.classes.UILabel.alloc().init();
                    lbl.setFrame_([[sw / 2 - 40, 15], [80, 25]]);
                    lbl.setText_("QBL 0");
                    lbl.setTextColor_(ObjC.classes.UIColor.greenColor());
                    lbl.setFont_(ObjC.classes.UIFont.boldSystemFontOfSize_(14));
                    lbl.setTextAlignment_(1);
                    lbl.setBackgroundColor_(ObjC.classes.UIColor.colorWithRed_green_blue_alpha_(0, 0, 0, 0.5));
                    vc.view().addSubview_(lbl);

                    console.log("[+] QBL 0 added!");
                    console.log("[*] Check top of screen");
                    console.log("[*] Then switch to Gemini");

                    var wins = app.windows();
                    console.log("[*] Windows: " + wins.count());
                    for (var i = 0; i < wins.count(); i++) {
                        var w = wins.objectAtIndex_(i);
                        console.log("  " + i + ": " + w.$className + " level=" + w.windowLevel());
                    }

                } catch(e) {
                    console.log("[-] " + e.message);
                    console.log(e.stack);
                }
            });
        }, 3000);
    });
}

console.log("========================================");
console.log("  spott codm - v22");
console.log("========================================");
setup();

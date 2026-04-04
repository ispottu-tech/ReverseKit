"""Ghidra Headless Decompilation Script (postScript)
Runs inside Ghidra's Jython environment after auto-analysis.
Decompiles all functions and writes C output to a file.
"""
# @category ReverseKit
# @description Decompile all functions and export C code

import os

from ghidra.app.decompiler import DecompInterface, DecompileOptions
from ghidra.util.task import ConsoleTaskMonitor

output_path = os.environ.get("REVERSEKIT_OUTPUT", "/tmp/ghidra_decompiled.c")

decomp = DecompInterface()
opts = DecompileOptions()
decomp.setOptions(opts)
decomp.openProgram(currentProgram)

monitor = ConsoleTaskMonitor()
func_mgr = currentProgram.getFunctionManager()

functions = func_mgr.getFunctions(True)
results = []

lang = currentProgram.getLanguage()
results.append("// Decompiled by Ghidra 11.3.2")
results.append("// Binary: %s" % str(currentProgram.getName()))
results.append("// Architecture: %s / %s" % (str(lang.getProcessor()), str(lang.getLanguageID())))
results.append("")

count = 0
skipped = 0
errors = 0
max_funcs = 300

for func in functions:
    if count >= max_funcs:
        results.append("// ... truncated at %d functions" % max_funcs)
        break

    if func.isExternal() or func.isThunk():
        skipped += 1
        continue

    name = str(func.getName())
    addr = str(func.getEntryPoint())

    try:
        res = decomp.decompileFunction(func, 60, monitor)
        if res is not None and res.decompileCompleted():
            dFunc = res.getDecompiledFunction()
            if dFunc is not None:
                c_code = dFunc.getC()
                if c_code and len(c_code.strip()) > 0:
                    results.append("// Function: %s @ %s" % (name, addr))
                    results.append(c_code.rstrip())
                    results.append("")
                    count += 1
                else:
                    errors += 1
            else:
                errors += 1
        else:
            err_msg = ""
            if res is not None:
                err_msg = str(res.getErrorMessage()) if res.getErrorMessage() else ""
            results.append("// Could not decompile %s @ %s: %s" % (name, addr, err_msg))
            errors += 1
    except Exception as e:
        results.append("// Exception decompiling %s: %s" % (name, str(e)))
        errors += 1

decomp.dispose()

results.append("")
results.append("// Summary: %d functions decompiled, %d skipped (external/thunk), %d errors" % (count, skipped, errors))

with open(output_path, "w") as f:
    f.write("\n".join(results))

print("REVERSEKIT_DECOMPILED:%d functions to %s" % (count, output_path))

#!/usr/bin/env python3
import sys
import json
import subprocess
import os
import struct

def run_cmd(cmd, timeout=30):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip()
    except Exception as e:
        return ""

def get_file_info(path):
    out = run_cmd(["file", path])
    return out

def get_strings(path, min_len=4):
    out = run_cmd(["strings", "-a", "-n", str(min_len), path])
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    # filter useful strings
    useful = []
    seen = set()
    for l in lines:
        if l not in seen and len(l) >= min_len:
            seen.add(l)
            useful.append(l)
    return useful[:300]

def get_symbols(path):
    out = run_cmd(["llvm-nm", "--defined-only", "--arch=arm64", path])
    if not out:
        out = run_cmd(["llvm-nm", "--defined-only", path])
    symbols = []
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            symbols.append({"addr": parts[0], "type": parts[1], "name": parts[2]})
    return symbols

def get_imports(path):
    out = run_cmd(["llvm-nm", "--undefined-only", "--arch=arm64", path])
    if not out:
        out = run_cmd(["llvm-nm", "--undefined-only", path])
    imports = []
    for line in out.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) >= 2:
            name = parts[-1].lstrip("_")
            imports.append(name)
    return list(set(imports))

def get_linked_libs(path):
    out = run_cmd(["llvm-objdump", "--macho", "--dylibs-used", path])
    libs = []
    for line in out.splitlines():
        line = line.strip()
        if line and not line.endswith(":") and "/" in line:
            libs.append(line.split()[0])
    return libs

def get_disassembly(path, arch="arm64"):
    out = run_cmd(["llvm-objdump", "--macho", f"--arch={arch}", "--disassemble", path], timeout=60)
    return out[:8000] if out else ""

def get_radare2_analysis(path):
    cmd = [
        "r2", "-q", "-e", "bin.relocs.apply=true",
        "-c", "aaa; afl; s entry0; pd 30",
        path
    ]
    out = run_cmd(cmd, timeout=60)
    lines = [l for l in out.splitlines() if not l.startswith("INFO") and not l.startswith("WARN") and not l.startswith("ERROR")]
    return "\n".join(lines)[:5000]

def get_radare2_pseudo_c(path):
    cmd = [
        "r2", "-q", "-e", "bin.relocs.apply=true",
        "-c", "aaa; afva@@@F; s entry0; pdc",
        path
    ]
    out = run_cmd(cmd, timeout=60)
    lines = [l for l in out.splitlines() if not l.startswith("INFO") and not l.startswith("WARN") and not l.startswith("ERROR")]
    return "\n".join(lines)[:6000]

def get_sections(path):
    out = run_cmd(["llvm-objdump", "--macho", "--arch=arm64", "--section-headers", path])
    if not out:
        out = run_cmd(["llvm-objdump", "--macho", "--section-headers", path])
    sections = []
    for line in out.splitlines():
        parts = line.strip().split()
        if len(parts) >= 3 and parts[0].startswith("_"):
            sections.append(line.strip())
    return sections

def get_mach_o_info(path):
    try:
        import lief
        fat = lief.parse(path)
        if fat is None:
            return {"error": "Could not parse binary"}

        result = {}

        if isinstance(fat, lief.MachO.FatBinary):
            result["type"] = "FAT Binary"
            result["architectures"] = []
            for binary in fat:
                arch_info = {
                    "cpu_type": str(binary.header.cpu_type).split(".")[-1],
                    "file_type": str(binary.header.file_type).split(".")[-1],
                    "flags": [str(f).split(".")[-1] for f in binary.header.flags_list],
                }
                result["architectures"].append(arch_info)

            # Use first non-armv7 slice for details
            main_bin = None
            for b in fat:
                cpu = str(b.header.cpu_type).split(".")[-1]
                if "ARM64" in cpu.upper():
                    main_bin = b
                    break
            if main_bin is None:
                main_bin = fat[0]
        else:
            main_bin = fat
            result["type"] = "Thin Binary"
            result["architectures"] = [{
                "cpu_type": str(main_bin.header.cpu_type).split(".")[-1],
                "file_type": str(main_bin.header.file_type).split(".")[-1],
            }]

        # ObjC classes
        objc_classes = []
        try:
            for cls in main_bin.classes:
                methods = [str(m.name) for m in cls.methods[:20]]
                objc_classes.append({"name": str(cls.name), "methods": methods})
        except:
            pass

        result["objc_classes"] = objc_classes[:50]

        # Encryption info
        result["encrypted"] = False
        try:
            for cmd in main_bin.commands:
                cmd_str = str(type(cmd).__name__)
                if "Encryption" in cmd_str:
                    result["encrypted"] = True
                    result["encryption_info"] = str(cmd)
        except:
            pass

        # Libraries
        linked = []
        try:
            for lib in main_bin.libraries:
                linked.append(str(lib.name))
        except:
            pass
        result["linked_libraries"] = linked

        return result
    except Exception as e:
        return {"error": str(e)}

def detect_security_features(strings_list, imports_list, symbols_list):
    features = []
    all_text = " ".join(strings_list + imports_list + [s.get("name","") for s in symbols_list]).lower()

    checks = [
        ("SSL Pinning", ["ssl", "certificate", "pinning", "trustkit", "afnetworking", "nsurlsession"]),
        ("Anti-Debug", ["ptrace", "isattached", "debugger", "sysctl", "syscall"]),
        ("Jailbreak Detection", ["cydia", "substrate", "jailbreak", "cyclick", "sileo", "/bin/bash", "mobile substrate"]),
        ("Encryption", ["aes", "des", "rsa", "encrypt", "decrypt", "crypt", "cipher"]),
        ("Network", ["http", "https", "socket", "nsurlsession", "alamofire", "request"]),
        ("Root Detection", ["root", "su binary", "/etc/sudoers", "jailbreak"]),
        ("Frida Detection", ["frida", "gum", "stalker", "interceptor"]),
        ("Anti-Tampering", ["checksum", "integrity", "hash", "signature"]),
    ]

    for name, keywords in checks:
        found = [k for k in keywords if k in all_text]
        if found:
            features.append({"feature": name, "evidence": found[:3]})

    return features

def analyze(path):
    result = {}

    # Basic file info
    result["file_info"] = get_file_info(path)
    result["file_size"] = os.path.getsize(path)

    # Mach-O deep analysis via lief
    result["macho"] = get_mach_o_info(path)

    # Strings
    result["strings"] = get_strings(path)

    # Symbols
    result["symbols"] = get_symbols(path)

    # Imports
    result["imports"] = get_imports(path)

    # Linked libraries
    result["linked_libraries"] = get_linked_libs(path)

    # Sections
    result["sections"] = get_sections(path)

    # Disassembly (ARM64 preferred)
    result["disassembly"] = get_disassembly(path, "arm64")

    # Radare2 analysis
    result["r2_analysis"] = get_radare2_analysis(path)

    # Pseudo-C
    result["pseudo_c"] = get_radare2_pseudo_c(path)

    # Security features detection
    result["security_features"] = detect_security_features(
        result["strings"],
        result["imports"],
        result["symbols"]
    )

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    path = sys.argv[1]
    if not os.path.exists(path):
        print(json.dumps({"error": f"File not found: {path}"}))
        sys.exit(1)

    try:
        result = analyze(path)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

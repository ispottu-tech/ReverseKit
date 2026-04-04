#!/usr/bin/env python3
"""
iOS Binary Analyzer — Unified Analysis Engine
Tools: lief, capstone, r2pipe, ROPgadget, pwntools, strings, llvm-nm, llvm-objdump
"""
import sys
import json
import subprocess
import os
import struct
import hashlib

import tempfile
import shutil

PYTHON_BIN = sys.executable
ROPGADGET_BIN = os.path.join(os.path.dirname(PYTHON_BIN), "ROPgadget")
GHIDRA_HEADLESS = "/nix/store/2pbav18pr4rn4v2ngimf29gjkv6l47l6-ghidra-11.3.2/bin/ghidra-analyzeHeadless"
RETDEC_BIN = "/nix/store/v6k7ayjdqaflpia7hcbjv3vh9dyz4ck6-retdec-5.0/bin/retdec-decompiler"
GHIDRA_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ghidra_decompile.py")

BINARY_EXTENSIONS = {".dylib", ".so", ".a", ".o", ".framework"}
MACHO_MAGICS = {b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'}


def is_macho_or_elf(path):
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
        if magic in MACHO_MAGICS:
            return True
        if magic[:4] == b'\x7fELF':
            return True
        return False
    except Exception:
        return False


def extract_binary_from_deb(deb_path):
    extract_dir = tempfile.mkdtemp(prefix="deb_extract_")
    try:
        subprocess.run(["ar", "x", deb_path], cwd=extract_dir, capture_output=True, timeout=30)

        data_tar = None
        for name in os.listdir(extract_dir):
            if name.startswith("data.tar"):
                data_tar = os.path.join(extract_dir, name)
                break
        if not data_tar:
            return None, extract_dir

        if data_tar.endswith(".zst"):
            try:
                import zstandard
                decompressed = data_tar.replace(".zst", "")
                with open(data_tar, "rb") as fin:
                    dctx = zstandard.ZstdDecompressor()
                    with open(decompressed, "wb") as fout:
                        dctx.copy_stream(fin, fout)
                data_tar = decompressed
            except ImportError:
                return None, extract_dir
        elif data_tar.endswith(".xz"):
            import lzma
            decompressed = data_tar.replace(".xz", "")
            with lzma.open(data_tar) as fin:
                with open(decompressed, "wb") as fout:
                    fout.write(fin.read())
            data_tar = decompressed

        import tarfile
        data_dir = os.path.join(extract_dir, "data")
        os.makedirs(data_dir, exist_ok=True)
        with tarfile.open(data_tar) as tf:
            tf.extractall(data_dir, filter="data")

        candidates = []
        for root, dirs, files in os.walk(data_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                _, ext = os.path.splitext(fname.lower())
                if ext in BINARY_EXTENSIONS or is_macho_or_elf(fpath):
                    fsize = os.path.getsize(fpath)
                    candidates.append((fsize, fpath, fname))

        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1], extract_dir

        return None, extract_dir
    except Exception:
        return None, extract_dir


def extract_binary_from_ipa(ipa_path):
    extract_dir = tempfile.mkdtemp(prefix="ipa_extract_")
    try:
        import zipfile
        with zipfile.ZipFile(ipa_path, 'r') as zf:
            zf.extractall(extract_dir)

        candidates = []
        for root, dirs, files in os.walk(extract_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                _, ext = os.path.splitext(fname.lower())
                if ext in BINARY_EXTENSIONS or is_macho_or_elf(fpath):
                    fsize = os.path.getsize(fpath)
                    candidates.append((fsize, fpath, fname))

        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1], extract_dir

        return None, extract_dir
    except Exception:
        return None, extract_dir


def extract_binary_from_archive(file_path, filename):
    lower = filename.lower()
    if lower.endswith(".deb"):
        return extract_binary_from_deb(file_path)
    elif lower.endswith(".ipa") or lower.endswith(".zip"):
        return extract_binary_from_ipa(file_path)
    return None, None

def run_cmd(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace")
        return r.stdout.strip()
    except Exception:
        return ""

def get_hashes(path):
    with open(path, "rb") as f:
        data = f.read()
    return {
        "md5": hashlib.md5(data).hexdigest(),
        "sha1": hashlib.sha1(data).hexdigest(),
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    }

def get_file_info(path):
    return run_cmd(["file", path])

def get_strings(path, min_len=5):
    out = run_cmd(["strings", "-a", "-n", str(min_len), path])
    lines = list(dict.fromkeys(l.strip() for l in out.splitlines() if l.strip() and len(l.strip()) >= min_len))
    return lines[:400]

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
    imports = list(set(line.strip().split()[-1].lstrip("_") for line in out.splitlines() if line.strip().split()))
    return sorted(imports)

def get_disassembly(path):
    out = run_cmd(["llvm-objdump", "--macho", "--arch=arm64", "--disassemble", path], timeout=90)
    return out[:10000] if out else ""

def get_lief_analysis(path):
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {"error": "Cannot parse binary"}

        result = {}

        # Handle FAT binary
        if isinstance(binary, lief.MachO.FatBinary):
            result["type"] = "FAT Binary (Universal)"
            result["architectures"] = []
            main_bin = None
            for b in binary:
                cpu = str(b.header.cpu_type).split(".")[-1]
                ft = str(b.header.file_type).split(".")[-1]
                flags = [str(f).split(".")[-1] for f in b.header.flags_list]
                result["architectures"].append({"cpu": cpu, "file_type": ft, "flags": flags})
                if "ARM64" in cpu.upper() and main_bin is None:
                    main_bin = b
            if main_bin is None:
                main_bin = binary[0]
        else:
            main_bin = binary
            cpu = str(main_bin.header.cpu_type).split(".")[-1]
            ft = str(main_bin.header.file_type).split(".")[-1]
            result["type"] = f"Thin Binary ({cpu})"
            result["architectures"] = [{"cpu": cpu, "file_type": ft}]

        # ObjC classes + methods
        objc_classes = []
        try:
            for cls in main_bin.classes:
                methods = [str(m.name) for m in cls.methods[:30]]
                protocols = [str(p) for p in getattr(cls, 'protocols', [])]
                objc_classes.append({
                    "name": str(cls.name),
                    "methods": methods,
                    "protocols": protocols,
                    "method_count": len(list(cls.methods)),
                })
        except Exception:
            pass
        result["objc_classes"] = objc_classes[:60]

        # Encryption detection
        result["encrypted"] = False
        result["encryption_details"] = []
        try:
            for cmd in main_bin.commands:
                cmd_name = type(cmd).__name__
                if "Encryption" in cmd_name:
                    enc_data = {"command": cmd_name}
                    if hasattr(cmd, 'crypt_id'):
                        enc_data["crypt_id"] = cmd.crypt_id
                        result["encrypted"] = cmd.crypt_id != 0
                    result["encryption_details"].append(enc_data)
        except Exception:
            pass

        # Libraries
        try:
            result["linked_libraries"] = [str(lib.name) for lib in main_bin.libraries]
        except Exception:
            result["linked_libraries"] = []

        # Load commands
        try:
            result["load_commands"] = list(set(type(c).__name__ for c in main_bin.commands))
        except Exception:
            result["load_commands"] = []

        # Entitlements (if present)
        try:
            if hasattr(main_bin, 'code_signature') and main_bin.code_signature:
                result["has_code_signature"] = True
        except Exception:
            result["has_code_signature"] = False

        # Sections with sizes
        sections = []
        try:
            for seg in main_bin.segments:
                for sec in seg.sections:
                    sections.append({
                        "name": f"{seg.name},{sec.name}",
                        "size": sec.size,
                        "offset": sec.offset,
                    })
        except Exception:
            pass
        result["sections"] = sections

        return result
    except Exception as e:
        return {"error": str(e)}

def get_radare2_analysis(path):
    try:
        import r2pipe
        r2 = r2pipe.open(path, flags=["-2"])
        r2.cmd("e bin.relocs.apply=true")
        r2.cmd("aaa")

        # Function list
        funcs = r2.cmdj("aflj") or []
        func_list = [{"name": f.get("name",""), "size": f.get("size",0), "addr": hex(f.get("offset",0))} for f in funcs[:30]]

        # Entrypoints
        entries = r2.cmdj("iej") or []

        # Basic blocks of first interesting function
        pseudo_c = ""
        if funcs:
            for fn in funcs:
                name = fn.get("name", "")
                if "logos" in name or "init" in name.lower() or "hook" in name.lower():
                    r2.cmd(f"s {fn['offset']}")
                    pseudo_c = r2.cmd("pdc") or ""
                    break
            if not pseudo_c and funcs:
                r2.cmd(f"s {funcs[0]['offset']}")
                pseudo_c = r2.cmd("pdc") or ""

        # Filter INFO/WARN lines
        clean_pc = "\n".join(l for l in pseudo_c.splitlines() if not l.startswith(("INFO", "WARN", "ERROR")))

        r2.quit()
        return {
            "functions": func_list,
            "entrypoints": entries,
            "pseudo_c": clean_pc[:8000],
        }
    except Exception as e:
        return {"error": str(e), "functions": [], "pseudo_c": ""}

def get_ropgadgets(path):
    try:
        out = run_cmd([ROPGADGET_BIN, "--binary", path, "--rop", "--depth", "5"], timeout=60)
        gadgets = []
        for line in out.splitlines():
            if " : " in line and "0x" in line:
                parts = line.strip().split(" : ", 1)
                if len(parts) == 2:
                    gadgets.append({"addr": parts[0].strip(), "gadget": parts[1].strip()})
        return gadgets[:100]
    except Exception as e:
        return []

def get_checksec(path):
    try:
        context_import = "from pwn import *; context.log_level='error'"
        script = f"""
{context_import}
import json, sys
try:
    e = ELF("{path}", checksec=False)
    print(json.dumps({{"pie": e.pie, "nx": e.nx, "canary": e.canary, "relro": e.relro, "arch": e.arch}}))
except Exception as ex:
    print(json.dumps({{"error": str(ex)}}))
"""
        r = subprocess.run([PYTHON_BIN, "-c", script], capture_output=True, text=True, timeout=15)
        if r.stdout.strip():
            parsed = json.loads(r.stdout.strip())
            if "error" not in parsed:
                return parsed
    except Exception:
        pass
    # Manual Mach-O security checks via lief
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {}
        main = binary[0] if isinstance(binary, lief.MachO.FatBinary) else binary
        flags = [str(f).split(".")[-1] for f in main.header.flags_list]
        has_pie = "PIE" in flags
        # Check for stack protection via symbols
        syms = [str(s.name) for s in main.symbols]
        has_canary = any("stack_chk" in s for s in syms)
        has_arc = any("objc_release" in s or "objc_retain" in s for s in syms)
        return {
            "pie": has_pie,
            "stack_canary": has_canary,
            "arc": has_arc,
            "flags": flags,
        }
    except Exception as e:
        return {"error": str(e)}

def capstone_disasm(path):
    """Direct ARM64 disassembly using capstone with annotations"""
    try:
        import lief
        import capstone
        binary = lief.parse(path)
        if binary is None:
            return ""
        main = binary[0] if isinstance(binary, lief.MachO.FatBinary) else binary

        # Find __text section
        text_section = None
        for seg in main.segments:
            for sec in seg.sections:
                if sec.name == "__text":
                    text_section = sec
                    break

        if text_section is None:
            return ""

        content = bytes(text_section.content[:4096])
        cs = capstone.Cs(capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM)
        cs.detail = True

        lines = []
        for insn in cs.disasm(content, text_section.virtual_address):
            lines.append(f"0x{insn.address:08x}:  {insn.mnemonic:<10} {insn.op_str}")
            if len(lines) >= 200:
                break

        return "\n".join(lines)
    except Exception as e:
        return f"Error: {e}"

def extract_thin_arm64(path):
    """Extract arm64 thin slice from FAT/universal binary using llvm-lipo"""
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
        if magic != b'\xca\xfe\xba\xbe':
            return path, None

        tmp_dir = tempfile.mkdtemp(prefix="lipo_")
        thin_path = os.path.join(tmp_dir, os.path.basename(path) + ".arm64")
        r = subprocess.run(
            ["llvm-lipo", path, "-thin", "arm64", "-output", thin_path],
            capture_output=True, text=True, timeout=30
        )
        if r.returncode == 0 and os.path.exists(thin_path):
            return thin_path, tmp_dir

        return path, None
    except Exception:
        return path, None


def ghidra_decompile(path):
    """Run Ghidra headless decompiler to produce C source code"""
    thin_path, lipo_dir = extract_thin_arm64(path)
    try:
        if not os.path.exists(GHIDRA_HEADLESS):
            return {"error": "Ghidra not available", "source": ""}

        tmp_dir = tempfile.mkdtemp(prefix="ghidra_")
        output_file = os.path.join(tmp_dir, "decompiled.c")
        project_dir = os.path.join(tmp_dir, "project")
        os.makedirs(project_dir, exist_ok=True)

        env = os.environ.copy()
        env["REVERSEKIT_OUTPUT"] = output_file

        cmd_analyze = [
            GHIDRA_HEADLESS,
            project_dir, "ReverseKit",
            "-import", thin_path,
            "-postScript", GHIDRA_SCRIPT,
            "-scriptPath", os.path.dirname(GHIDRA_SCRIPT),
            "-deleteProject",
        ]

        r = subprocess.run(cmd_analyze, capture_output=True, text=True, timeout=120, env=env, errors="replace")

        source = ""
        func_count = 0
        if os.path.exists(output_file):
            with open(output_file, "r", errors="replace") as f:
                source = f.read()
            for line in r.stdout.splitlines():
                if "REVERSEKIT_DECOMPILED:" in line:
                    try:
                        func_count = int(line.split(":")[1].split()[0])
                    except Exception:
                        pass

        shutil.rmtree(tmp_dir, ignore_errors=True)

        return {
            "source": source[:50000],
            "functions_decompiled": func_count,
            "engine": "Ghidra 11.3.2",
        }
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"error": "Ghidra decompilation timed out (120s limit)", "source": ""}
    except Exception as e:
        return {"error": str(e), "source": ""}
    finally:
        if lipo_dir:
            shutil.rmtree(lipo_dir, ignore_errors=True)


def retdec_decompile(path):
    """Run RetDec decompiler to produce C source code"""
    thin_path, lipo_dir = extract_thin_arm64(path)
    try:
        if not os.path.exists(RETDEC_BIN):
            return {"error": "RetDec not available", "source": ""}

        tmp_dir = tempfile.mkdtemp(prefix="retdec_")
        output_file = os.path.join(tmp_dir, "decompiled.c")

        cmd = [
            RETDEC_BIN,
            thin_path,
            "-o", output_file,
        ]

        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, errors="replace")

        source = ""
        if os.path.exists(output_file):
            with open(output_file, "r", errors="replace") as f:
                source = f.read()

        shutil.rmtree(tmp_dir, ignore_errors=True)

        return {
            "source": source[:50000],
            "engine": "RetDec 5.0",
        }
    except subprocess.TimeoutExpired:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return {"error": "RetDec decompilation timed out (120s limit)", "source": ""}
    except Exception as e:
        return {"error": str(e), "source": ""}
    finally:
        if lipo_dir:
            shutil.rmtree(lipo_dir, ignore_errors=True)


def extract_objc_headers(path):
    """Extract ObjC class headers (class-dump equivalent) using lief"""
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {"error": "Cannot parse binary", "headers": ""}

        main = binary[0] if isinstance(binary, lief.MachO.FatBinary) else binary

        lines = []
        lines.append("// ObjC Headers — extracted by ReverseKit (lief)")
        lines.append(f"// Binary: {os.path.basename(path)}")
        lines.append("")

        try:
            classes = list(main.classes)
        except Exception:
            classes = []

        if not classes:
            return {"headers": "// No Objective-C class metadata found in this binary.", "class_count": 0}

        for cls in classes[:100]:
            cls_name = str(cls.name)

            protocols = []
            try:
                protocols = [str(p) for p in cls.protocols]
            except Exception:
                pass

            super_class = ""
            try:
                if hasattr(cls, 'super_class') and cls.super_class:
                    super_class = str(cls.super_class.name) if hasattr(cls.super_class, 'name') else str(cls.super_class)
            except Exception:
                pass

            proto_str = ""
            if protocols:
                proto_str = " <" + ", ".join(protocols) + ">"

            if super_class:
                lines.append(f"@interface {cls_name} : {super_class}{proto_str}")
            else:
                lines.append(f"@interface {cls_name}{proto_str}")

            properties = []
            try:
                if hasattr(cls, 'properties'):
                    for prop in cls.properties:
                        prop_name = str(prop.name) if hasattr(prop, 'name') else str(prop)
                        properties.append(prop_name)
            except Exception:
                pass

            for prop_name in properties[:30]:
                lines.append(f"@property (nonatomic) id {prop_name};")

            ivars = []
            try:
                if hasattr(cls, 'instance_variables'):
                    for iv in cls.instance_variables:
                        iv_name = str(iv.name) if hasattr(iv, 'name') else str(iv)
                        ivars.append(iv_name)
            except Exception:
                pass

            if ivars:
                lines.append("{")
                for iv in ivars[:30]:
                    lines.append(f"    id {iv};")
                lines.append("}")

            methods = []
            try:
                methods = list(cls.methods)
            except Exception:
                pass

            for method in methods[:50]:
                m_name = str(method.name)
                is_class = getattr(method, 'is_class_method', False) if hasattr(method, 'is_class_method') else False
                prefix = "+" if is_class else "-"
                lines.append(f"{prefix} (id){m_name};")

            lines.append("@end")
            lines.append("")

        return {
            "headers": "\n".join(lines),
            "class_count": len(classes),
        }
    except Exception as e:
        return {"error": str(e), "headers": ""}


def radare2_full_decompile(path):
    """Enhanced r2 decompilation — decompile ALL functions with pdc"""
    try:
        import r2pipe
        r2 = r2pipe.open(path, flags=["-2"])
        r2.cmd("e bin.relocs.apply=true")
        r2.cmd("aaa")

        funcs = r2.cmdj("aflj") or []
        func_list = [{"name": f.get("name",""), "size": f.get("size",0), "addr": hex(f.get("offset",0))} for f in funcs[:100]]

        entries = r2.cmdj("iej") or []

        all_pseudo_c = []
        decompiled_count = 0
        for fn in funcs[:50]:
            name = fn.get("name", "")
            offset = fn.get("offset", 0)
            try:
                r2.cmd(f"s {offset}")
                pdc = r2.cmd("pdc") or ""
                clean = "\n".join(l for l in pdc.splitlines() if not l.startswith(("INFO", "WARN", "ERROR")))
                if clean.strip():
                    all_pseudo_c.append(f"// --- {name} @ {hex(offset)} ---")
                    all_pseudo_c.append(clean)
                    all_pseudo_c.append("")
                    decompiled_count += 1
            except Exception:
                pass

        r2.quit()
        return {
            "functions": func_list,
            "entrypoints": entries,
            "pseudo_c": "\n".join(all_pseudo_c)[:30000],
            "functions_decompiled": decompiled_count,
        }
    except Exception as e:
        return {"error": str(e), "functions": [], "pseudo_c": "", "functions_decompiled": 0}


def detect_obfuscation(strings_list, symbols, disasm):
    """Detect obfuscation techniques"""
    findings = []
    all_text = " ".join(strings_list).lower()
    sym_names = " ".join(s.get("name","") for s in symbols).lower()

    # Check for known obfuscators
    if "hikari" in all_text or "hikari" in sym_names:
        findings.append({"type": "LLVM Hikari Obfuscator", "severity": "high", "note": "Control flow flattening detected"})
    if "ollvm" in all_text or "fla_" in sym_names:
        findings.append({"type": "OLLVM Obfuscation", "severity": "high", "note": "String and control flow obfuscation"})

    # Check for anti-debug patterns
    anti_debug = []
    if "ptrace" in all_text or "ptrace" in sym_names:
        anti_debug.append("ptrace")
    if "sysctl" in all_text or "sysctl" in sym_names:
        anti_debug.append("sysctl")
    if "isattached" in sym_names or "debugger" in all_text:
        anti_debug.append("debugger-check")
    if "task_get_exception_ports" in sym_names:
        anti_debug.append("exception-port-check")
    if anti_debug:
        findings.append({"type": "Anti-Debug Techniques", "severity": "high", "evidence": anti_debug})

    # Jailbreak detection
    jb_patterns = []
    jb_checks = ["/Applications/Cydia.app", "/bin/bash", "cydia", "substrate", "sileo", "/etc/apt", "jailbreak", "MobileSubstrate"]
    for p in jb_checks:
        if p.lower() in all_text:
            jb_patterns.append(p)
    if jb_patterns:
        findings.append({"type": "Jailbreak Detection", "severity": "medium", "evidence": jb_patterns[:5]})

    # Frida detection
    frida_patterns = [p for p in ["frida", "frida-gadget", "fridaserver", "gumjs", "stalker"] if p in all_text]
    if frida_patterns:
        findings.append({"type": "Frida Detection", "severity": "high", "evidence": frida_patterns, "note": "Binary actively detects Frida — use Frida anti-detection scripts"})

    # SSL Pinning
    ssl_patterns = [p for p in ["ssl", "pinning", "certificate", "trustkit", "afnetworking", "nsurlsession", "SecTrustEvaluate"] if p.lower() in all_text or p.lower() in sym_names]
    if ssl_patterns:
        findings.append({"type": "SSL Pinning", "severity": "medium", "evidence": ssl_patterns[:5], "bypass": "Use SSL Kill Switch or Frida ssl-pinning-bypass script"})

    # String encryption hints (XOR patterns in asm)
    if "eor" in disasm.lower() or "xor" in disasm.lower():
        xor_count = disasm.lower().count("eor")
        if xor_count > 10:
            findings.append({"type": "Possible String Encryption (XOR/EOR)", "severity": "low", "note": f"Found {xor_count} EOR instructions — may indicate XOR string decryption"})

    # Root detection
    root_patterns = [p for p in ["getuid", "isRoot", "/etc/sudoers", "checkRoot", "id_look_up"] if p in all_text or p in sym_names]
    if root_patterns:
        findings.append({"type": "Root/Privilege Detection", "severity": "medium", "evidence": root_patterns[:3]})

    return findings

def detect_security_features(strings_list, imports_list, symbols_list):
    """Quick security feature scan"""
    features = []
    all_text = " ".join(strings_list + imports_list + [s.get("name","") for s in symbols_list]).lower()

    checks = [
        ("SSL/TLS Pinning", ["ssl", "certificate", "pinning", "trustkit"]),
        ("Anti-Debug (ptrace)", ["ptrace", "isattached", "debugger"]),
        ("Jailbreak Detection", ["cydia", "substrate", "/bin/bash", "sileo"]),
        ("Frida Detection", ["frida", "gumjs", "stalker", "interceptor"]),
        ("Encryption (AES/RSA)", ["aes", "rsa", "encrypt", "decrypt", "crypt"]),
        ("Network Requests", ["http", "https", "nsurl", "alamofire"]),
        ("Root Detection", ["getuid", "isroot", "sudoers"]),
        ("Anti-Tampering", ["checksum", "integrity", "codesign"]),
        ("Certificate Pinning (TrustKit)", ["trustkit", "hpkp", "publickey"]),
        ("Biometrics (TouchID/FaceID)", ["biometry", "touchid", "faceid", "localauth"]),
    ]

    for name, keywords in checks:
        found = [k for k in keywords if k in all_text]
        if found:
            features.append({"feature": name, "evidence": found[:4]})

    return features

def analyze(path, original_filename=None):
    if original_filename is None:
        original_filename = os.path.basename(path)

    extract_dir = None
    extracted_binary = None
    archive_info = None

    lower_name = original_filename.lower()
    if lower_name.endswith((".deb", ".ipa", ".zip")):
        extracted_binary, extract_dir = extract_binary_from_archive(path, original_filename)
        if extracted_binary:
            archive_info = {
                "archive_type": "deb" if lower_name.endswith(".deb") else ("ipa" if lower_name.endswith(".ipa") else "zip"),
                "archive_name": original_filename,
                "extracted_binary": os.path.basename(extracted_binary),
                "extracted_size": os.path.getsize(extracted_binary),
            }
            path = extracted_binary
        else:
            result = {
                "file_info": get_file_info(path),
                "hashes": get_hashes(path),
                "archive_info": {
                    "archive_type": lower_name.rsplit(".", 1)[-1],
                    "archive_name": original_filename,
                    "error": "No executable binary (.dylib, .so, Mach-O) found inside the archive. The package may contain only scripts or config files.",
                },
                "macho": {"error": "Archive file — not a direct binary"},
                "strings": get_strings(path),
                "symbols": [],
                "imports": [],
                "functions": [],
                "pseudo_c": "",
                "capstone_disasm": "",
                "disassembly": "",
                "rop_gadgets": [],
                "obfuscation": [],
                "security_features": [],
                "security_properties": {},
                "objc_headers": {"headers": "", "class_count": 0},
                "ghidra": {"source": "", "error": "No binary found in archive"},
                "retdec": {"source": "", "error": "No binary found in archive"},
            }
            if extract_dir:
                shutil.rmtree(extract_dir, ignore_errors=True)
            return result

    try:
        result = _analyze_binary(path)
        if archive_info:
            result["archive_info"] = archive_info
            result["filename"] = archive_info["extracted_binary"]
        return result
    finally:
        if extract_dir:
            shutil.rmtree(extract_dir, ignore_errors=True)


def _analyze_binary(path):
    result = {}

    # 1. File identification & hashes
    result["file_info"] = get_file_info(path)
    result["hashes"] = get_hashes(path)

    # 2. Deep Mach-O analysis (lief)
    result["macho"] = get_lief_analysis(path)

    # 3. Strings extraction
    result["strings"] = get_strings(path)

    # 4. Symbols + Imports
    result["symbols"] = get_symbols(path)
    result["imports"] = get_imports(path)

    # 5. Security properties (PIE, Stack Canary, ARC)
    result["security_properties"] = get_checksec(path)

    # 6. Radare2 FULL decompilation (all functions)
    r2 = radare2_full_decompile(path)
    result["functions"] = r2.get("functions", [])
    result["pseudo_c"] = r2.get("pseudo_c", "")
    result["r2_error"] = r2.get("error")
    result["r2_functions_decompiled"] = r2.get("functions_decompiled", 0)

    # 7. Capstone direct ARM64 disassembly
    result["capstone_disasm"] = capstone_disasm(path)

    # 8. llvm-objdump disassembly
    result["disassembly"] = get_disassembly(path)

    # 9. ROP Gadgets
    result["rop_gadgets"] = get_ropgadgets(path)

    # 10. Obfuscation & protection analysis
    result["obfuscation"] = detect_obfuscation(
        result["strings"],
        result["symbols"],
        result.get("capstone_disasm", "") + result.get("disassembly", "")
    )

    # 11. Quick security feature scan
    result["security_features"] = detect_security_features(
        result["strings"],
        result["imports"],
        result["symbols"]
    )

    # 12. ObjC Headers (class-dump equivalent)
    result["objc_headers"] = extract_objc_headers(path)

    # 13. Ghidra Decompilation (real C source code)
    result["ghidra"] = ghidra_decompile(path)

    # 14. RetDec Decompilation (secondary decompiler)
    result["retdec"] = retdec_decompile(path)

    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No file path provided"}))
        sys.exit(1)

    path = sys.argv[1]
    original_filename = sys.argv[2] if len(sys.argv) > 2 else None
    if not os.path.exists(path):
        print(json.dumps({"error": f"File not found: {path}"}))
        sys.exit(1)

    try:
        result = analyze(path, original_filename)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

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


def detect_binary_arch(path):
    """Detect binary architecture from Mach-O header"""
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
            if magic in (b'\xcf\xfa\xed\xfe', b'\xfe\xed\xfa\xcf'):
                f.seek(4)
                cpu_type = struct.unpack('<I', f.read(4))[0]
                if cpu_type == 0x0100000c:
                    return "AARCH64", "LE", "64"
                elif cpu_type == 0x0c:
                    return "ARM", "LE", "32"
                elif cpu_type == 0x01000007:
                    return "x86", "LE", "64"
            elif magic in (b'\xce\xfa\xed\xfe', b'\xfe\xed\xfa\xce'):
                f.seek(4)
                cpu_type = struct.unpack('<I', f.read(4))[0]
                if cpu_type == 0x0c:
                    return "ARM", "LE", "32"
    except Exception:
        pass
    return "AARCH64", "LE", "64"


def _compute_timeout(path, base=120):
    """Compute timeout based on file size — larger binaries need more time"""
    try:
        size_mb = os.path.getsize(path) / (1024 * 1024)
        if size_mb > 5:
            return min(base + int(size_mb * 30), 300)
        elif size_mb > 1:
            return min(base + int(size_mb * 15), 240)
        return base
    except Exception:
        return base


def _extract_ghidra_error(stdout, stderr):
    """Extract meaningful error from Ghidra output"""
    diagnostics = []
    for line in (stderr or "").splitlines():
        ll = line.lower()
        if any(k in ll for k in ["error", "exception", "fail", "unable", "cannot", "invalid"]):
            clean = line.strip()
            if clean and len(clean) < 300:
                diagnostics.append(clean)
    for line in (stdout or "").splitlines():
        ll = line.lower()
        if any(k in ll for k in ["error", "exception", "import failed", "not a valid"]):
            clean = line.strip()
            if clean and len(clean) < 300:
                diagnostics.append(clean)
    return "; ".join(diagnostics[:5]) if diagnostics else ""


GHIDRA_PROCESSOR_CONFIGS = [
    ["AARCH64:LE:64:AppleSilicon"],
    ["AARCH64:LE:64:v8A"],
    [],
]


def ghidra_decompile(path):
    """Run Ghidra headless decompiler with auto-retry on different processor configs"""
    thin_path, lipo_dir = extract_thin_arm64(path)
    timeout = _compute_timeout(thin_path, base=120)
    try:
        if not os.path.exists(GHIDRA_HEADLESS):
            return {"error": "Ghidra not available", "source": ""}

        arch, endian, bits = detect_binary_arch(thin_path)
        last_error = ""

        for attempt, proc_config in enumerate(GHIDRA_PROCESSOR_CONFIGS):
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

            if proc_config:
                cmd_analyze.extend(["-processor", proc_config[0]])

            try:
                r = subprocess.run(
                    cmd_analyze, capture_output=True, text=True,
                    timeout=timeout, env=env, errors="replace"
                )

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

                if source.strip():
                    proc_label = proc_config[0] if proc_config else "auto-detect"
                    return {
                        "source": source[:50000],
                        "functions_decompiled": func_count,
                        "engine": f"Ghidra 11.3.2 ({proc_label})",
                    }

                last_error = _extract_ghidra_error(r.stdout, r.stderr)
                if not last_error:
                    last_error = f"Ghidra produced no output (exit code {r.returncode})"

            except subprocess.TimeoutExpired:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                last_error = f"Ghidra timed out ({timeout}s) on attempt {attempt+1}"
            except Exception as e:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                last_error = str(e)

        return {"error": last_error or "All Ghidra processor configurations failed", "source": ""}
    except Exception as e:
        return {"error": str(e), "source": ""}
    finally:
        if lipo_dir:
            shutil.rmtree(lipo_dir, ignore_errors=True)


def retdec_decompile(path):
    """Run RetDec decompiler with architecture auto-detection and retry"""
    thin_path, lipo_dir = extract_thin_arm64(path)
    timeout = _compute_timeout(thin_path, base=120)
    try:
        if not os.path.exists(RETDEC_BIN):
            return {"error": "RetDec not available", "source": ""}

        arch, endian, bits = detect_binary_arch(thin_path)

        retdec_configs = [
            ["--arch", "arm", "--file-format", "macho"],
            [],
        ]

        last_error = ""
        for attempt, extra_args in enumerate(retdec_configs):
            tmp_dir = tempfile.mkdtemp(prefix="retdec_")
            output_file = os.path.join(tmp_dir, "decompiled.c")

            cmd = [RETDEC_BIN, thin_path, "-o", output_file] + extra_args

            try:
                r = subprocess.run(
                    cmd, capture_output=True, text=True,
                    timeout=timeout, errors="replace"
                )

                source = ""
                if os.path.exists(output_file):
                    with open(output_file, "r", errors="replace") as f:
                        source = f.read()

                shutil.rmtree(tmp_dir, ignore_errors=True)

                if source.strip():
                    return {
                        "source": source[:50000],
                        "engine": "RetDec 5.0",
                    }

                stderr_lines = [l.strip() for l in (r.stderr or "").splitlines()
                                if any(k in l.lower() for k in ["error", "fail", "unsupported", "cannot"])]
                last_error = "; ".join(stderr_lines[:3]) if stderr_lines else f"RetDec produced no output (exit {r.returncode})"

            except subprocess.TimeoutExpired:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                last_error = f"RetDec timed out ({timeout}s) on attempt {attempt+1}"
            except Exception as e:
                shutil.rmtree(tmp_dir, ignore_errors=True)
                last_error = str(e)

        return {"error": last_error or "All RetDec configurations failed", "source": ""}
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
    """Enhanced r2 decompilation — decompile ALL functions with pdc, prioritize interesting ones"""
    try:
        import r2pipe
        r2 = r2pipe.open(path, flags=["-2"])
        r2.cmd("e bin.relocs.apply=true")
        r2.cmd("aaa")

        funcs = r2.cmdj("aflj") or []
        func_list = [{"name": f.get("name",""), "size": f.get("size",0), "addr": hex(f.get("offset",0))} for f in funcs[:200]]

        entries = r2.cmdj("iej") or []

        priority_keywords = ["init", "hook", "logos", "bypass", "patch", "main", "load", "setup",
                             "inject", "fake", "spoof", "intercept", "swizzle", "replace", "override"]
        priority_funcs = []
        other_funcs = []
        for fn in funcs:
            name = fn.get("name", "").lower()
            if name.startswith("sym.imp."):
                continue
            if any(k in name for k in priority_keywords):
                priority_funcs.append(fn)
            else:
                other_funcs.append(fn)

        ordered = priority_funcs + other_funcs

        all_pseudo_c = []
        decompiled_count = 0
        total_chars = 0
        max_chars = 50000

        for fn in ordered[:80]:
            if total_chars >= max_chars:
                break
            name = fn.get("name", "")
            offset = fn.get("offset", 0)
            try:
                r2.cmd(f"s {offset}")
                pdc = r2.cmd("pdc") or ""
                clean = "\n".join(l for l in pdc.splitlines() if not l.startswith(("INFO", "WARN", "ERROR")))
                if clean.strip():
                    header = f"// --- {name} @ {hex(offset)} ---"
                    all_pseudo_c.append(header)
                    all_pseudo_c.append(clean)
                    all_pseudo_c.append("")
                    total_chars += len(header) + len(clean) + 2
                    decompiled_count += 1
            except Exception:
                pass

        r2.quit()
        return {
            "functions": func_list,
            "entrypoints": entries,
            "pseudo_c": "\n".join(all_pseudo_c)[:max_chars],
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

def extract_entitlements(path):
    """Extract entitlements and code signing info from Mach-O binary"""
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {"entitlements": "", "signing_info": {}}

        main = binary[0] if isinstance(binary, lief.MachO.FatBinary) else binary

        signing_info = {}
        entitlements_xml = ""

        try:
            if hasattr(main, 'code_signature'):
                cs = main.code_signature
                if cs:
                    signing_info["has_signature"] = True
                    signing_info["data_size"] = cs.data_size if hasattr(cs, 'data_size') else 0
        except Exception:
            pass

        try:
            for cmd in main.commands:
                cmd_str = str(type(cmd).__name__)
                if "CodeSignature" in cmd_str:
                    signing_info["has_code_signature"] = True
                if "EncryptionInfo" in cmd_str:
                    if hasattr(cmd, 'crypt_id'):
                        signing_info["encrypted"] = cmd.crypt_id != 0
                        signing_info["crypt_id"] = cmd.crypt_id
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["ldid", "-e", path],
                capture_output=True, text=True, timeout=10, errors="replace"
            )
            if r.returncode == 0 and r.stdout.strip():
                entitlements_xml = r.stdout.strip()
        except Exception:
            pass

        if not entitlements_xml:
            try:
                with open(path, "rb") as f:
                    data = f.read()
                plist_start = data.find(b"<?xml")
                if plist_start != -1:
                    plist_end = data.find(b"</plist>", plist_start)
                    if plist_end != -1 and (plist_end - plist_start) < 10000:
                        candidate = data[plist_start:plist_end + 8].decode("utf-8", errors="replace")
                        if "entitlements" in candidate.lower() or "application-identifier" in candidate.lower() or "aps-environment" in candidate.lower() or "com.apple" in candidate.lower():
                            entitlements_xml = candidate

            except Exception:
                pass

        entitlements_list = []
        if entitlements_xml:
            import re
            keys = re.findall(r"<key>(.*?)</key>", entitlements_xml)
            for k in keys:
                entitlements_list.append(k)

        return {
            "entitlements_xml": entitlements_xml,
            "entitlements_list": entitlements_list,
            "signing_info": signing_info,
        }
    except Exception as e:
        return {"error": str(e), "entitlements_xml": "", "entitlements_list": [], "signing_info": {}}


def extract_urls_and_endpoints(path):
    """Extract URLs, API endpoints, and domains from binary strings"""
    try:
        import re
        with open(path, "rb") as f:
            data = f.read()

        text = data.decode("utf-8", errors="replace")

        url_pattern = re.compile(r'https?://[^\s\x00"\'<>\)\]\}]{5,200}')
        urls = list(set(url_pattern.findall(text)))

        domain_pattern = re.compile(r'(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.){1,3}(?:com|net|org|io|dev|app|co|me|xyz|api|cloud|ai|edu|gov|info|biz|tv|us|uk|de|fr|jp|cn|ru|br|in|au|ca|nl|it|es|kr|se|no|fi|dk|pl|pt|at|ch|be|ie|nz|mx|ar|cl|sg|hk|tw|id|th|my|ph|vn|ae|sa|qa|eg|za|ke|ng|il)\b')
        domains = list(set(domain_pattern.findall(text)))

        api_pattern = re.compile(r'/(?:api|v[0-9]+|graphql|rest|ws|webhook|oauth|auth|login|signup|register|token|user|admin|dashboard|config|settings|data|upload|download|search|query|fetch|submit|create|update|delete|list|get|post|put|patch)/[^\s\x00"\'<>]{2,100}')
        api_paths = list(set(api_pattern.findall(text)))

        ip_pattern = re.compile(r'\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b')
        ips = list(set(ip_pattern.findall(text)))
        ips = [ip for ip in ips if not ip.startswith("0.") and not ip.startswith("255.")]

        deeplink_pattern = re.compile(r'[a-zA-Z][a-zA-Z0-9+.-]{1,20}://[^\s\x00"\'<>]{3,100}')
        all_schemes = list(set(deeplink_pattern.findall(text)))
        deeplinks = [s for s in all_schemes if not s.startswith("http")]

        firebase_urls = [u for u in urls if "firebase" in u.lower() or "firebaseio" in u.lower() or "googleapis" in u.lower()]
        s3_urls = [u for u in urls if "s3.amazonaws" in u.lower() or "cloudfront" in u.lower()]

        categories = {}
        if firebase_urls:
            categories["Firebase/Google"] = firebase_urls[:10]
        if s3_urls:
            categories["AWS S3/CloudFront"] = s3_urls[:10]

        return {
            "urls": sorted(urls)[:50],
            "domains": sorted(domains)[:30],
            "api_paths": sorted(api_paths)[:30],
            "ip_addresses": sorted(ips)[:20],
            "deeplinks": sorted(deeplinks)[:10],
            "cloud_services": categories,
            "total_urls": len(urls),
            "total_domains": len(domains),
        }
    except Exception as e:
        return {"error": str(e), "urls": [], "domains": [], "api_paths": [], "ip_addresses": [], "deeplinks": []}


KNOWN_PROTECTION_SIGNATURES = [
    {"name": "Arxan/Digital.ai", "patterns": ["arxan", "dexguard", "digital.ai", "AppProtection"], "severity": "critical", "desc": "Commercial app protection — runtime integrity, anti-tamper, code obfuscation"},
    {"name": "iXGuard", "patterns": ["ixguard", "guardsquare"], "severity": "critical", "desc": "iOS-specific protection by GuardSquare — control flow, string encryption, anti-debug"},
    {"name": "Liapp", "patterns": ["liapp", "LIAPP"], "severity": "high", "desc": "Korean app protection SDK"},
    {"name": "Denuvo", "patterns": ["denuvo", "irdeto"], "severity": "critical", "desc": "Anti-tamper protection for mobile apps"},
    {"name": "Promon SHIELD", "patterns": ["promon", "shield"], "severity": "high", "desc": "Runtime Application Self-Protection (RASP)"},
    {"name": "FairPlay DRM", "patterns": ["fairplay", "sinf", "SC_Info"], "severity": "medium", "desc": "Apple's built-in DRM for App Store binaries"},
    {"name": "Themis Crypto", "patterns": ["themis", "objcthemis", "TSSession"], "severity": "low", "desc": "Crypto library for secure comms"},
    {"name": "CydiaSubstrate Hooks", "patterns": ["MSHookMessageEx", "MSHookFunction", "substrate", "CydiaSubstrate"], "severity": "info", "desc": "Uses Cydia Substrate for method hooking (common in tweaks)"},
    {"name": "Logos/Theos", "patterns": ["_logosLocalInit", "__logos_method", "_logos_orig", "logos_register"], "severity": "info", "desc": "Built with Theos/Logos framework (jailbreak tweak)"},
    {"name": "fishhook", "patterns": ["fishhook", "rebind_symbols", "rebinding"], "severity": "medium", "desc": "Facebook's fishhook — rebinds C symbols at runtime"},
    {"name": "Frida Gadget", "patterns": ["FridaGadget", "frida-gadget", "frida_gadget"], "severity": "high", "desc": "Frida Gadget embedded in binary for instrumentation"},
    {"name": "Objection", "patterns": ["objection", "FridaGadget"], "severity": "medium", "desc": "Objection toolkit — runtime mobile exploration"},
]

ANTI_DEBUG_SIGNATURES = [
    {"name": "ptrace DENY_ATTACH", "patterns": ["ptrace", "PT_DENY_ATTACH", "31"], "desc": "Classic anti-debug: prevents debugger attachment"},
    {"name": "sysctl Process Check", "patterns": ["sysctl", "CTL_KERN", "KERN_PROC", "P_TRACED"], "desc": "Checks if process is being traced via sysctl"},
    {"name": "Exception Port Check", "patterns": ["task_get_exception_ports", "EXC_MASK_ALL"], "desc": "Detects debugger via Mach exception ports"},
    {"name": "getppid Check", "patterns": ["getppid"], "desc": "Checks parent PID (debuggers change ppid)"},
    {"name": "isatty Check", "patterns": ["isatty"], "desc": "Checks if stdin/stdout are terminals (can indicate debugging)"},
    {"name": "Timing-Based Detection", "patterns": ["mach_absolute_time", "clock_gettime"], "desc": "Measures execution time to detect breakpoints/stepping"},
    {"name": "dyld Image Count", "patterns": ["_dyld_image_count", "_dyld_get_image_name"], "desc": "Checks loaded dylibs for injected libraries"},
    {"name": "AMFI / Code Signing", "patterns": ["amfid", "csops", "CS_VALID", "CS_ENFORCEMENT"], "desc": "Checks code signing status at runtime"},
]

JB_DETECTION_SIGNATURES = [
    {"name": "File-Based Detection", "paths": ["/Applications/Cydia.app", "/usr/sbin/sshd", "/bin/bash", "/etc/apt", "/var/jb", "/var/lib/dpkg", "/Library/MobileSubstrate", "/usr/bin/ssh"]},
    {"name": "URL Scheme Detection", "paths": ["cydia://", "sileo://", "zbra://", "filza://"]},
    {"name": "Sandbox Check", "paths": ["fork", "/private/var/tmp", "/private/var/mobile"]},
    {"name": "Dylib Injection Check", "paths": ["DYLD_INSERT_LIBRARIES", "_dyld_image_count", "MobileSubstrate.dylib"]},
    {"name": "Symbolic Link Check", "paths": ["lstat", "readlink", "/usr/lib/system"]},
]


def scan_protection_patterns(path, strings_list, symbols_list):
    """Advanced pattern scanner — detect protection SDKs, anti-debug, and JB detection"""
    try:
        all_strings = " ".join(strings_list).lower() if strings_list else ""
        sym_names = " ".join(s.get("name", "") for s in symbols_list).lower() if symbols_list else ""
        combined = all_strings + " " + sym_names

        with open(path, "rb") as f:
            raw = f.read()
        raw_text = raw.decode("utf-8", errors="replace").lower()

        results = {
            "protection_sdks": [],
            "anti_debug": [],
            "jb_detection": [],
            "anti_tamper": [],
            "total_findings": 0,
            "risk_level": "low",
        }

        for sig in KNOWN_PROTECTION_SIGNATURES:
            matched = [p for p in sig["patterns"] if p.lower() in combined or p.lower() in raw_text]
            if matched:
                results["protection_sdks"].append({
                    "name": sig["name"],
                    "severity": sig["severity"],
                    "description": sig["desc"],
                    "matched_patterns": matched,
                })

        for sig in ANTI_DEBUG_SIGNATURES:
            matched = [p for p in sig["patterns"] if p.lower() in combined or p.lower() in raw_text]
            if len(matched) >= 1:
                results["anti_debug"].append({
                    "name": sig["name"],
                    "description": sig["desc"],
                    "matched_patterns": matched,
                })

        for sig in JB_DETECTION_SIGNATURES:
            matched = [p for p in sig["paths"] if p.lower() in combined or p.lower() in raw_text]
            if matched:
                results["jb_detection"].append({
                    "category": sig["name"],
                    "detected_checks": matched,
                    "count": len(matched),
                })

        anti_tamper = []
        tamper_checks = [
            ("Checksum Validation", ["checksum", "crc32", "md5", "sha256", "integrity"]),
            ("Code Signing Verification", ["SecCodeCheckValidity", "csops", "codesign"]),
            ("Mach-O Header Check", ["_mh_execute_header", "machHeader", "LC_CODE_SIGNATURE"]),
            ("Bundle ID Verification", ["CFBundleIdentifier", "bundleIdentifier"]),
            ("Provisioning Profile", ["embedded.mobileprovision", "provisioning"]),
        ]
        for name, patterns in tamper_checks:
            matched = [p for p in patterns if p.lower() in combined or p.lower() in raw_text]
            if matched:
                anti_tamper.append({"check": name, "patterns": matched})
        results["anti_tamper"] = anti_tamper

        total = len(results["protection_sdks"]) + len(results["anti_debug"]) + len(results["jb_detection"]) + len(results["anti_tamper"])
        results["total_findings"] = total

        if any(s["severity"] in ("critical", "high") for s in results["protection_sdks"]):
            results["risk_level"] = "high"
        elif len(results["anti_debug"]) >= 2 or total >= 5:
            results["risk_level"] = "medium"
        elif total > 0:
            results["risk_level"] = "low"
        else:
            results["risk_level"] = "none"

        return results
    except Exception as e:
        return {"error": str(e), "protection_sdks": [], "anti_debug": [], "jb_detection": [], "anti_tamper": [], "total_findings": 0}


def extract_swift_metadata(path):
    """Extract Swift type metadata, protocols, and conformances from Mach-O"""
    try:
        import lief
        import re
        binary = lief.parse(path)
        if binary is None:
            return {"swift_classes": [], "swift_protocols": [], "has_swift": False}

        main = binary[0] if isinstance(binary, lief.MachO.FatBinary) else binary

        has_swift = False
        swift_sections = []
        for section in main.sections:
            sec_name = str(section.name)
            if "swift" in sec_name.lower():
                has_swift = True
                swift_sections.append({"name": f"{section.segment_name},{sec_name}", "size": section.size})

        with open(path, "rb") as f:
            raw_data = f.read()
        raw_text = raw_data.decode("utf-8", errors="replace")

        swift_name_pattern = re.compile(r'_\$s(\d+)([A-Za-z_][A-Za-z0-9_]*)')
        mangled_names = swift_name_pattern.findall(raw_text)

        swift_classes = []
        swift_structs = []
        swift_enums = []
        swift_protocols = []
        class_names_seen = set()

        symbols = []
        try:
            for sym in main.symbols:
                name = str(sym.name) if hasattr(sym, 'name') else ""
                symbols.append(name)
                if "$s" in name and ("C" in name or "V" in name or "O" in name or "P" in name):
                    has_swift = True
        except Exception:
            pass

        type_desc_pattern = re.compile(r'_\$s\d+(\w+?)(?:CN|CMa|CACig|CMn|Cd)')
        struct_desc_pattern = re.compile(r'_\$s\d+(\w+?)(?:VN|VMa|Vd)')
        enum_desc_pattern = re.compile(r'_\$s\d+(\w+?)(?:ON|OMa|Od)')
        proto_desc_pattern = re.compile(r'_\$s\d+(\w+?)(?:Mp|TL|Mc)')

        for sym_name in symbols:
            cm = type_desc_pattern.search(sym_name)
            if cm and cm.group(1) not in class_names_seen:
                class_names_seen.add(cm.group(1))
                swift_classes.append(cm.group(1))

            sm = struct_desc_pattern.search(sym_name)
            if sm and sm.group(1) not in class_names_seen:
                class_names_seen.add(sm.group(1))
                swift_structs.append(sm.group(1))

            em = enum_desc_pattern.search(sym_name)
            if em and em.group(1) not in class_names_seen:
                class_names_seen.add(em.group(1))
                swift_enums.append(em.group(1))

            pm = proto_desc_pattern.search(sym_name)
            if pm and pm.group(1) not in class_names_seen:
                class_names_seen.add(pm.group(1))
                swift_protocols.append(pm.group(1))

        swift_version = ""
        ver_pattern = re.compile(r'swift[- ]?(\d+\.\d+(?:\.\d+)?)')
        vm = ver_pattern.search(raw_text.lower())
        if vm:
            swift_version = vm.group(1)

        header_lines = []
        if has_swift:
            header_lines.append("// Swift Metadata — extracted by ReverseKit")
            header_lines.append(f"// Binary: {os.path.basename(path)}")
            if swift_version:
                header_lines.append(f"// Swift Version: {swift_version}")
            header_lines.append("")

            if swift_protocols:
                header_lines.append("// MARK: - Protocols")
                for p in sorted(swift_protocols)[:50]:
                    header_lines.append(f"protocol {p} {{}}")
                header_lines.append("")

            if swift_classes:
                header_lines.append("// MARK: - Classes")
                for c in sorted(swift_classes)[:50]:
                    header_lines.append(f"class {c} {{}}")
                header_lines.append("")

            if swift_structs:
                header_lines.append("// MARK: - Structs")
                for s in sorted(swift_structs)[:50]:
                    header_lines.append(f"struct {s} {{}}")
                header_lines.append("")

            if swift_enums:
                header_lines.append("// MARK: - Enums")
                for e in sorted(swift_enums)[:50]:
                    header_lines.append(f"enum {e} {{}}")
                header_lines.append("")

        return {
            "has_swift": has_swift,
            "swift_version": swift_version,
            "swift_sections": swift_sections,
            "swift_classes": swift_classes[:100],
            "swift_structs": swift_structs[:100],
            "swift_enums": swift_enums[:100],
            "swift_protocols": swift_protocols[:100],
            "swift_headers": "\n".join(header_lines),
            "total_types": len(swift_classes) + len(swift_structs) + len(swift_enums) + len(swift_protocols),
        }
    except Exception as e:
        return {"error": str(e), "has_swift": False, "swift_classes": [], "swift_protocols": [], "swift_headers": ""}


IOS_YARA_RULES = r"""
rule iOS_Jailbreak_Detection {
    meta:
        description = "Detects jailbreak detection code in iOS binaries"
        severity = "medium"
        category = "security"
    strings:
        $cydia = "/Applications/Cydia.app" ascii
        $sileo = "/Applications/Sileo.app" ascii
        $zebra = "/Applications/Zebra.app" ascii
        $substrate = "/Library/MobileSubstrate" ascii
        $ssh = "/usr/sbin/sshd" ascii
        $bash = "/bin/bash" ascii
        $apt = "/etc/apt" ascii
        $dpkg = "/var/lib/dpkg" ascii
        $varjb = "/var/jb" ascii
        $cydia_url = "cydia://" ascii
        $sileo_url = "sileo://" ascii
    condition:
        3 of them
}

rule iOS_Anti_Debug {
    meta:
        description = "Detects anti-debugging techniques"
        severity = "high"
        category = "anti-analysis"
    strings:
        $ptrace = "ptrace" ascii
        $deny = "PT_DENY_ATTACH" ascii
        $sysctl = "sysctl" ascii
        $kern_proc = "KERN_PROC" ascii
        $task_ports = "task_get_exception_ports" ascii
        $isatty = "isatty" ascii
        $getppid = "getppid" ascii
    condition:
        2 of them
}

rule iOS_Frida_Detection {
    meta:
        description = "Detects Frida instrumentation framework detection"
        severity = "high"
        category = "anti-analysis"
    strings:
        $frida1 = "frida" ascii nocase
        $frida2 = "FridaGadget" ascii
        $frida3 = "frida-server" ascii
        $gumjs = "gumjs" ascii
        $stalker = "stalker" ascii
        $linjector = "linjector" ascii
        $frida_port = "27042" ascii
    condition:
        2 of them
}

rule iOS_SSL_Pinning {
    meta:
        description = "Detects SSL/TLS certificate pinning"
        severity = "medium"
        category = "security"
    strings:
        $trustkit = "TrustKit" ascii
        $pin1 = "SecTrustEvaluate" ascii
        $pin2 = "SecTrustCopyPublicKey" ascii
        $pin3 = "certificate" ascii nocase
        $pin4 = "pinning" ascii nocase
        $afn = "AFSecurityPolicy" ascii
        $alamofire = "ServerTrustEvaluating" ascii
    condition:
        2 of them
}

rule iOS_Encryption_Usage {
    meta:
        description = "Detects encryption/cryptography usage"
        severity = "low"
        category = "crypto"
    strings:
        $aes = "CCCrypt" ascii
        $aes2 = "kCCAlgorithmAES" ascii
        $rsa = "SecKeyCreateEncryptedData" ascii
        $keychain = "SecItemAdd" ascii
        $keychain2 = "SecItemCopyMatching" ascii
        $hash1 = "CC_SHA256" ascii
        $hash2 = "CC_MD5" ascii
        $hmac = "CCHmac" ascii
    condition:
        2 of them
}

rule iOS_Tweak_Logos {
    meta:
        description = "Theos/Logos jailbreak tweak framework"
        severity = "info"
        category = "framework"
    strings:
        $logos1 = "_logosLocalInit" ascii
        $logos2 = "__logos_method" ascii
        $logos3 = "_logos_orig" ascii
        $mshook = "MSHookMessageEx" ascii
        $msfunc = "MSHookFunction" ascii
        $substrate = "CydiaSubstrate" ascii
    condition:
        2 of them
}

rule iOS_Malware_Indicators {
    meta:
        description = "Potential malware behavior indicators"
        severity = "critical"
        category = "malware"
    strings:
        $keylog = "keyLogger" ascii nocase
        $screenshot = "UIGraphicsGetImageFromCurrentImageContext" ascii
        $pasteboard = "UIPasteboard" ascii
        $contacts = "CNContactStore" ascii
        $location = "CLLocationManager" ascii
        $camera = "AVCaptureDevice" ascii
        $mic = "AVAudioRecorder" ascii
        $sms = "MFMessageComposeViewController" ascii
        $call = "tel://" ascii
        $exfil = "uploadData" ascii nocase
        $c2 = "command" ascii
        $backdoor = "backdoor" ascii nocase
        $inject = "inject" ascii nocase
        $payload = "payload" ascii nocase
    condition:
        4 of them
}

rule iOS_Obfuscation_Detected {
    meta:
        description = "Code obfuscation detected"
        severity = "high"
        category = "obfuscation"
    strings:
        $ollvm = "ollvm" ascii nocase
        $hikari = "hikari" ascii nocase
        $fla = "fla_" ascii
        $bcf = "bcf_" ascii
        $sub = "sub_" ascii
        $ixguard = "ixguard" ascii nocase
        $guardsquare = "guardsquare" ascii nocase
    condition:
        2 of them
}

rule iOS_Network_Exfiltration {
    meta:
        description = "Network data exfiltration patterns"
        severity = "high"
        category = "network"
    strings:
        $upload = "uploadTask" ascii
        $post_data = "HTTPBody" ascii
        $nsurl = "NSURLSession" ascii
        $send = "sendAsynchronousRequest" ascii
        $ws = "WebSocket" ascii
        $firebase = "firebaseio.com" ascii
        $s3 = "s3.amazonaws.com" ascii
    condition:
        3 of them
}

rule iOS_Privacy_Violation {
    meta:
        description = "Accesses sensitive user data"
        severity = "medium"
        category = "privacy"
    strings:
        $idfa = "advertisingIdentifier" ascii
        $idfv = "identifierForVendor" ascii
        $device = "UIDevice" ascii
        $sysname = "systemName" ascii
        $sysver = "systemVersion" ascii
        $model = "model" ascii
        $carrier = "CTTelephonyNetworkInfo" ascii
        $wifi = "CNCopyCurrentNetworkInfo" ascii
    condition:
        3 of them
}
"""


def yara_scan(path):
    """Run YARA rules against iOS binary for threat/pattern detection"""
    try:
        import yara
        rules = yara.compile(source=IOS_YARA_RULES)
        matches = rules.match(filepath=path)

        results = []
        for match in matches:
            matched_strings = []
            for s in match.strings:
                for instance in s.instances:
                    decoded = instance.matched_data.decode("utf-8", errors="replace")
                    if decoded not in matched_strings and len(matched_strings) < 8:
                        matched_strings.append(decoded)

            results.append({
                "rule": match.rule,
                "description": match.meta.get("description", ""),
                "severity": match.meta.get("severity", "info"),
                "category": match.meta.get("category", ""),
                "matched_strings": matched_strings,
                "tags": list(match.tags) if match.tags else [],
            })

        severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
        results.sort(key=lambda r: severity_order.get(r["severity"], 5))

        threat_level = "clean"
        if any(r["severity"] == "critical" for r in results):
            threat_level = "critical"
        elif any(r["severity"] == "high" for r in results):
            threat_level = "high"
        elif any(r["severity"] == "medium" for r in results):
            threat_level = "medium"
        elif results:
            threat_level = "low"

        return {
            "matches": results,
            "total_matches": len(results),
            "threat_level": threat_level,
            "engine": "YARA 4.5",
        }
    except Exception as e:
        return {"error": str(e), "matches": [], "total_matches": 0, "threat_level": "unknown"}


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

    # 15. Entitlements & Code Signing
    result["entitlements"] = extract_entitlements(path)

    # 16. URL & Endpoint Extraction
    result["urls_endpoints"] = extract_urls_and_endpoints(path)

    # 17. Advanced Pattern Scanner
    result["pattern_scan"] = scan_protection_patterns(path, result["strings"], result["symbols"])

    # 18. Swift Metadata Extraction
    result["swift_metadata"] = extract_swift_metadata(path)

    # 19. YARA Threat Scan
    result["yara_scan"] = yara_scan(path)

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

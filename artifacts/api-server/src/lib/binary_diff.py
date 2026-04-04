#!/usr/bin/env python3
"""Binary Diff — compare two iOS binaries (versions, patches, etc.)
Supports: .dylib, .app executables, .ipa, .deb, .zip — auto-extracts binaries from archives"""
import sys
import json
import os
import hashlib
import subprocess
import tempfile
import shutil
import struct

BINARY_EXTENSIONS = {".dylib", ".so", ".a", ".o", ".framework"}
MACHO_MAGICS = {b'\xfe\xed\xfa\xce', b'\xfe\xed\xfa\xcf', b'\xce\xfa\xed\xfe', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'}


def is_macho(path):
    try:
        with open(path, "rb") as f:
            magic = f.read(4)
        return magic in MACHO_MAGICS
    except Exception:
        return False


def extract_binary_from_ipa(archive_path):
    extract_dir = tempfile.mkdtemp(prefix="diff_extract_")
    try:
        import zipfile
        with zipfile.ZipFile(archive_path, 'r') as zf:
            zf.extractall(extract_dir)

        candidates = []
        for root, dirs, files in os.walk(extract_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                _, ext = os.path.splitext(fname.lower())
                if ext in BINARY_EXTENSIONS or is_macho(fpath):
                    fsize = os.path.getsize(fpath)
                    candidates.append((fsize, fpath, fname))

        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1], candidates[0][2], extract_dir

        return None, None, extract_dir
    except Exception:
        return None, None, extract_dir


def extract_binary_from_deb(deb_path):
    extract_dir = tempfile.mkdtemp(prefix="diff_deb_")
    try:
        subprocess.run(["ar", "x", deb_path], cwd=extract_dir, capture_output=True, timeout=30)

        data_tar = None
        for name in os.listdir(extract_dir):
            if name.startswith("data.tar"):
                data_tar = os.path.join(extract_dir, name)
                break
        if not data_tar:
            return None, None, extract_dir

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
                return None, None, extract_dir
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
                if ext in BINARY_EXTENSIONS or is_macho(fpath):
                    fsize = os.path.getsize(fpath)
                    candidates.append((fsize, fpath, fname))

        if candidates:
            candidates.sort(reverse=True)
            return candidates[0][1], candidates[0][2], extract_dir

        return None, None, extract_dir
    except Exception:
        return None, None, extract_dir


def resolve_binary(path, original_name):
    """If path is an archive (.ipa/.deb/.zip), extract the main binary. Otherwise return as-is."""
    lower = original_name.lower()
    temp_dir = None

    if lower.endswith(".ipa") or lower.endswith(".zip"):
        bin_path, bin_name, temp_dir = extract_binary_from_ipa(path)
        if bin_path:
            return bin_path, bin_name or original_name, temp_dir
        return None, original_name, temp_dir

    if lower.endswith(".deb"):
        bin_path, bin_name, temp_dir = extract_binary_from_deb(path)
        if bin_path:
            return bin_path, bin_name or original_name, temp_dir
        return None, original_name, temp_dir

    return path, original_name, None


def get_strings(path):
    try:
        out = subprocess.run(["strings", "-n", "6", path], capture_output=True, text=True, timeout=15)
        return set(out.stdout.strip().split("\n")) if out.stdout else set()
    except Exception:
        return set()


def parse_binary(path):
    """Parse binary once and cache the lief object"""
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return None
        if isinstance(binary, lief.MachO.FatBinary):
            return binary[0]
        return binary
    except Exception:
        return None


def get_symbols(path, parsed=None):
    try:
        main = parsed or parse_binary(path)
        if main is None:
            return set()
        syms = set()
        try:
            for s in main.symbols:
                syms.add(str(s.name))
        except Exception:
            pass
        return syms
    except Exception:
        return set()


def get_imports(path, parsed=None):
    try:
        main = parsed or parse_binary(path)
        if main is None:
            return set()
        imps = set()
        try:
            for lib in main.libraries:
                imps.add(str(lib.name))
        except Exception:
            pass
        return imps
    except Exception:
        return set()


def get_classes(path, parsed=None, symbols=None):
    """Extract ObjC classes and methods from symbols (works on all binaries)"""
    try:
        import re
        main = parsed or parse_binary(path)

        cls_map = {}

        if symbols is None:
            symbols = get_symbols(path, main)

        for sym in symbols:
            m = re.match(r'_OBJC_CLASS_\$_(.+)', sym)
            if m:
                cls_map.setdefault(m.group(1), set())

        for sym in symbols:
            m = re.match(r'[+-]\[(\w+)\s+(\w+[:\w]*)\]', sym)
            if m:
                cls_name = m.group(1)
                method = m.group(2)
                cls_map.setdefault(cls_name, set()).add(method)

            m2 = re.match(r'_OBJC_\$_INSTANCE_METHODS_(.+)', sym)
            if m2:
                cls_map.setdefault(m2.group(1), set())

        try:
            if main and hasattr(main, 'classes'):
                for cls in main.classes:
                    name = str(cls.name)
                    methods = set()
                    try:
                        methods = {str(m.name) for m in cls.methods}
                    except Exception:
                        pass
                    if name in cls_map:
                        cls_map[name].update(methods)
                    else:
                        cls_map[name] = methods
        except Exception:
            pass

        return cls_map
    except Exception:
        return {}


def get_sections(path, parsed=None):
    try:
        main = parsed or parse_binary(path)
        if main is None:
            return {}
        secs = {}
        try:
            for sec in main.sections:
                secs[str(sec.name)] = sec.size
        except Exception:
            pass
        return secs
    except Exception:
        return {}


def file_hash(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def is_meaningful_string(s):
    """Filter out binary garbage — keep only human-readable strings"""
    import re
    s = s.strip()
    if len(s) < 4:
        return False
    printable = sum(1 for c in s if c.isalnum() or c in ' .,;:!?-_/()[]{}@#$%&*+=<>\'"')
    ratio = printable / len(s)
    if ratio < 0.7:
        return False
    if len(s) < 6 and not any(c.isalpha() for c in s):
        return False
    if re.match(r'^_?\$s\d', s) or re.match(r'^_?\$sSo', s):
        return False
    if s.count('E') > 3 and any(c.isdigit() for c in s) and 'EE' in s:
        return False
    if re.search(r'[A-Z]{2,}\d[A-Z]', s) and not any(c == ' ' for c in s):
        return False
    if s.startswith('!') and not any(c == ' ' for c in s):
        return False
    if re.match(r'^[A-Za-z0-9_]+EE[A-Za-z0-9_]*$', s):
        return False
    if sum(1 for c in s if c in '{}[]()') > len(s) * 0.3:
        return False
    mangled_indicators = ['ENS0_', 'EPNS', 'ERK', 'EEE', 'NSt3__', 'ERKNS',
                          'ForkHandler', 'Handshaker', 'SliceFrom',
                          'ObjectGroup', 'iP21grpc', 'pollset_size']
    for m in mangled_indicators:
        if m in s:
            return False
    if re.match(r'^[A-Za-z0-9_/:<>]+$', s) and len(s) > 20 and ' ' not in s:
        upper_count = sum(1 for c in s if c.isupper())
        if upper_count > len(s) * 0.3:
            return False
    if s.startswith('v') and re.match(r'^v\d+@', s):
        return False
    if re.match(r'^[yS]{1,3}S\d', s):
        return False
    return True


def categorize_strings(added, removed):
    """Categorize diff strings into meaningful groups for user understanding"""
    import re

    categories = {
        "features": {"label": "New Features & UI", "added": [], "removed": [], "icon": "sparkles"},
        "apis": {"label": "API & Network", "added": [], "removed": [], "icon": "globe"},
        "services": {"label": "Services & SDKs", "added": [], "removed": [], "icon": "cpu"},
        "errors": {"label": "Error Messages", "added": [], "removed": [], "icon": "alert"},
        "localization": {"label": "Translations", "added": [], "removed": [], "icon": "languages"},
        "security": {"label": "Security", "added": [], "removed": [], "icon": "shield"},
        "ui_text": {"label": "User-Facing Text", "added": [], "removed": [], "icon": "text"},
        "debug": {"label": "Debug & Logging", "added": [], "removed": [], "icon": "bug"},
    }

    url_pattern = re.compile(r'https?://|\.com|\.io|\.net|\.org|api\.|/v\d')
    error_pattern = re.compile(r'error|fail|invalid|exception|crash|timeout', re.I)
    service_pattern = re.compile(r'Google|Firebase|Stripe|Apple|AWS|Azure|Veo|Grok|Pixverse|OpenAI|GPT|Claude|Gemini|RevenueCat|AdMob', re.I)
    debug_pattern = re.compile(r'debug|log|print|console|trace|STATUS CODE|SENDING|Response:', re.I)
    security_pattern = re.compile(r'encrypt|decrypt|token|auth|password|keychain|certificate|SSL|TLS', re.I)
    ui_pattern = re.compile(r'button|screen|view|page|menu|dialog|alert|picker|photo|video|image|camera', re.I)

    def classify(s):
        if url_pattern.search(s):
            return "apis"
        if service_pattern.search(s):
            return "services"
        if security_pattern.search(s):
            return "security"
        if error_pattern.search(s):
            return "errors"
        if debug_pattern.search(s):
            return "debug"
        if ui_pattern.search(s):
            return "features"
        ascii_count = sum(1 for c in s if ord(c) > 127 or c.isalpha())
        if ascii_count > len(s) * 0.6 and len(s) > 10:
            has_non_english = any(
                ('\u00c0' <= c <= '\u024f') or
                ('\u0600' <= c <= '\u06ff') or
                ('\u4e00' <= c <= '\u9fff') or
                ('\u3040' <= c <= '\u309f') or
                ('\uac00' <= c <= '\ud7af')
                for c in s
            )
            if has_non_english:
                return "localization"
            if len(s) > 15:
                return "ui_text"
        return None

    uncategorized_added = []
    uncategorized_removed = []

    for s in sorted(added):
        if not is_meaningful_string(s):
            continue
        cat = classify(s)
        if cat and len(categories[cat]["added"]) < 30:
            categories[cat]["added"].append(s.strip())
        elif len(uncategorized_added) < 30:
            uncategorized_added.append(s.strip())

    for s in sorted(removed):
        if not is_meaningful_string(s):
            continue
        cat = classify(s)
        if cat and len(categories[cat]["removed"]) < 30:
            categories[cat]["removed"].append(s.strip())
        elif len(uncategorized_removed) < 30:
            uncategorized_removed.append(s.strip())

    result = {}
    for key, data in categories.items():
        if data["added"] or data["removed"]:
            result[key] = data

    if uncategorized_added or uncategorized_removed:
        result["other"] = {
            "label": "Other Changes",
            "added": uncategorized_added,
            "removed": uncategorized_removed,
            "icon": "list",
        }

    return result


def generate_insights(result):
    """Generate human-readable insights from diff data"""
    insights = []

    if result.get("libraries", {}).get("added"):
        seen_libs = set()
        for lib in result["libraries"]["added"]:
            name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "").replace("libswift", "")
            if name in seen_libs:
                continue
            seen_libs.add(name)
            insights.append({
                "type": "feature",
                "severity": "info",
                "text": f"Added {name} framework — new functionality integrated",
            })

    if result.get("libraries", {}).get("removed"):
        for lib in result["libraries"]["removed"]:
            name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "")
            insights.append({
                "type": "removal",
                "severity": "warning",
                "text": f"Removed {name} — functionality dropped or replaced",
            })

    added_cls = result.get("classes", {}).get("added_count", 0)
    removed_cls = result.get("classes", {}).get("removed_count", 0)
    modified_cls = result.get("classes", {}).get("modified_count", 0)
    if added_cls > 0:
        insights.append({
            "type": "feature",
            "severity": "info",
            "text": f"{added_cls} new class(es) added — new functionality",
        })
    if removed_cls > 0:
        insights.append({
            "type": "removal",
            "severity": "warning",
            "text": f"{removed_cls} class(es) removed — features deprecated",
        })
    if modified_cls > 5:
        insights.append({
            "type": "change",
            "severity": "info",
            "text": f"{modified_cls} classes modified — significant code refactoring",
        })

    cats = result.get("strings", {}).get("categories", {})
    if "services" in cats:
        services = cats["services"]
        if services.get("added"):
            insights.append({
                "type": "feature",
                "severity": "info",
                "text": f"New services detected: {', '.join(services['added'][:3])}",
            })

    if "security" in cats and cats["security"].get("added"):
        insights.append({
            "type": "security",
            "severity": "info",
            "text": "New security-related strings added",
        })

    size_diff = result.get("size_diff", 0)
    if abs(size_diff) > 1024 * 1024:
        mb = abs(size_diff) / 1024 / 1024
        insights.append({
            "type": "size",
            "severity": "info",
            "text": f"Binary size {'increased' if size_diff > 0 else 'decreased'} by {mb:.1f} MB",
        })

    text_sec = None
    for sec in result.get("sections", []):
        if sec.get("name") == "__text" and sec.get("change") == "resized":
            text_sec = sec
            break
    if text_sec:
        diff = text_sec.get("diff", 0)
        if abs(diff) > 10000:
            kb = abs(diff) / 1024
            insights.append({
                "type": "code",
                "severity": "info",
                "text": f"Code section {'grew' if diff > 0 else 'shrank'} by {kb:.1f} KB — {'new code added' if diff > 0 else 'code removed/optimized'}",
            })

    return insights


def diff_binaries(path1, path2, name1, name2):
    result = {
        "file1": {"name": name1, "size": os.path.getsize(path1), "sha256": file_hash(path1)},
        "file2": {"name": name2, "size": os.path.getsize(path2), "sha256": file_hash(path2)},
        "identical": False,
    }

    if result["file1"]["sha256"] == result["file2"]["sha256"]:
        result["identical"] = True
        result["summary"] = "Files are identical"
        return result

    size_diff = result["file2"]["size"] - result["file1"]["size"]
    result["size_diff"] = size_diff
    result["size_diff_pct"] = round((size_diff / max(result["file1"]["size"], 1)) * 100, 2)

    parsed1 = parse_binary(path1)
    parsed2 = parse_binary(path2)

    strings1 = get_strings(path1)
    strings2 = get_strings(path2)
    added_strings = strings2 - strings1
    removed_strings = strings1 - strings2

    categorized = categorize_strings(added_strings, removed_strings)
    result["strings"] = {
        "file1_count": len(strings1),
        "file2_count": len(strings2),
        "added": sorted(list(added_strings))[:100],
        "removed": sorted(list(removed_strings))[:100],
        "added_count": len(added_strings),
        "removed_count": len(removed_strings),
        "categories": categorized,
    }

    syms1 = get_symbols(path1, parsed1)
    syms2 = get_symbols(path2, parsed2)
    added_syms = syms2 - syms1
    removed_syms = syms1 - syms2
    result["symbols"] = {
        "file1_count": len(syms1),
        "file2_count": len(syms2),
        "added": sorted(list(added_syms))[:100],
        "removed": sorted(list(removed_syms))[:100],
        "added_count": len(added_syms),
        "removed_count": len(removed_syms),
    }

    imps1 = get_imports(path1, parsed1)
    imps2 = get_imports(path2, parsed2)
    result["libraries"] = {
        "added": sorted(list(imps2 - imps1)),
        "removed": sorted(list(imps1 - imps2)),
        "common": sorted(list(imps1 & imps2)),
    }

    cls1 = get_classes(path1, parsed1, syms1)
    cls2 = get_classes(path2, parsed2, syms2)
    added_cls = set(cls2.keys()) - set(cls1.keys())
    removed_cls = set(cls1.keys()) - set(cls2.keys())
    common_cls = set(cls1.keys()) & set(cls2.keys())
    modified_cls = []
    for c in common_cls:
        added_m = cls2[c] - cls1[c]
        removed_m = cls1[c] - cls2[c]
        if added_m or removed_m:
            modified_cls.append({
                "class": c,
                "added_methods": sorted(list(added_m))[:20],
                "removed_methods": sorted(list(removed_m))[:20],
            })

    result["classes"] = {
        "added": sorted(list(added_cls))[:50],
        "removed": sorted(list(removed_cls))[:50],
        "modified": modified_cls[:30],
        "added_count": len(added_cls),
        "removed_count": len(removed_cls),
        "modified_count": len(modified_cls),
    }

    secs1 = get_sections(path1, parsed1)
    secs2 = get_sections(path2, parsed2)
    section_changes = []
    all_secs = set(list(secs1.keys()) + list(secs2.keys()))
    for s in sorted(all_secs):
        s1 = secs1.get(s)
        s2 = secs2.get(s)
        if s1 is None:
            section_changes.append({"name": s, "change": "added", "size": s2})
        elif s2 is None:
            section_changes.append({"name": s, "change": "removed", "size": s1})
        elif s1 != s2:
            section_changes.append({"name": s, "change": "resized", "old_size": s1, "new_size": s2, "diff": s2 - s1})
    result["sections"] = section_changes

    changes = []
    if added_cls: changes.append(f"+{len(added_cls)} classes")
    if removed_cls: changes.append(f"-{len(removed_cls)} classes")
    if modified_cls: changes.append(f"~{len(modified_cls)} modified classes")
    if added_syms: changes.append(f"+{len(added_syms)} symbols")
    if removed_syms: changes.append(f"-{len(removed_syms)} symbols")
    if added_strings: changes.append(f"+{len(added_strings)} strings")
    if removed_strings: changes.append(f"-{len(removed_strings)} strings")
    result["summary"] = ", ".join(changes) if changes else "Minor binary differences"

    result["insights"] = generate_insights(result)

    return result


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: binary_diff.py <file1> <file2> [name1] [name2]"}))
        sys.exit(1)

    p1, p2 = sys.argv[1], sys.argv[2]
    n1 = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(p1)
    n2 = sys.argv[4] if len(sys.argv) > 4 else os.path.basename(p2)

    temp_dirs = []
    try:
        bin1, real_name1, td1 = resolve_binary(p1, n1)
        if td1:
            temp_dirs.append(td1)
        bin2, real_name2, td2 = resolve_binary(p2, n2)
        if td2:
            temp_dirs.append(td2)

        if bin1 is None:
            print(json.dumps({"error": f"Could not extract binary from {n1}. Supported: .dylib, .ipa, .deb, .zip, Mach-O executables"}))
            sys.exit(1)
        if bin2 is None:
            print(json.dumps({"error": f"Could not extract binary from {n2}. Supported: .dylib, .ipa, .deb, .zip, Mach-O executables"}))
            sys.exit(1)

        result = diff_binaries(bin1, bin2, n1, n2)

        if real_name1 != n1:
            result["file1"]["extracted_binary"] = real_name1
        if real_name2 != n2:
            result["file2"]["extracted_binary"] = real_name2

        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
    finally:
        for td in temp_dirs:
            try:
                shutil.rmtree(td, ignore_errors=True)
            except Exception:
                pass

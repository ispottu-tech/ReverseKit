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


def get_symbols(path):
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return set()
        main = binary[0] if hasattr(binary, '__getitem__') else binary
        syms = set()
        try:
            for s in main.symbols:
                syms.add(str(s.name))
        except Exception:
            pass
        return syms
    except Exception:
        return set()


def get_imports(path):
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return set()
        main = binary[0] if hasattr(binary, '__getitem__') else binary
        imps = set()
        try:
            for lib in main.libraries:
                imps.add(str(lib.name))
        except Exception:
            pass
        return imps
    except Exception:
        return set()


def get_classes(path):
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {}
        main = binary[0] if hasattr(binary, '__getitem__') else binary
        cls_map = {}
        try:
            for cls in main.classes:
                name = str(cls.name)
                methods = []
                try:
                    methods = [str(m.name) for m in cls.methods]
                except Exception:
                    pass
                cls_map[name] = set(methods)
        except Exception:
            pass
        return cls_map
    except Exception:
        return {}


def get_sections(path):
    try:
        import lief
        binary = lief.parse(path)
        if binary is None:
            return {}
        main = binary[0] if hasattr(binary, '__getitem__') else binary
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

    strings1 = get_strings(path1)
    strings2 = get_strings(path2)
    added_strings = strings2 - strings1
    removed_strings = strings1 - strings2
    result["strings"] = {
        "file1_count": len(strings1),
        "file2_count": len(strings2),
        "added": sorted(list(added_strings))[:100],
        "removed": sorted(list(removed_strings))[:100],
        "added_count": len(added_strings),
        "removed_count": len(removed_strings),
    }

    syms1 = get_symbols(path1)
    syms2 = get_symbols(path2)
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

    imps1 = get_imports(path1)
    imps2 = get_imports(path2)
    result["libraries"] = {
        "added": sorted(list(imps2 - imps1)),
        "removed": sorted(list(imps1 - imps2)),
        "common": sorted(list(imps1 & imps2)),
    }

    cls1 = get_classes(path1)
    cls2 = get_classes(path2)
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

    secs1 = get_sections(path1)
    secs2 = get_sections(path2)
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

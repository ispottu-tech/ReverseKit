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


def _extract_info_plist_metadata(data):
    """Extract Info.plist metadata into _info_plist dict"""
    import plistlib
    try:
        info = plistlib.loads(data)
        ats = info.get('NSAppTransportSecurity', {})
        bg_modes = info.get('UIBackgroundModes', [])
        url_schemes = []
        for ut in info.get('CFBundleURLTypes', []):
            url_schemes.extend(ut.get('CFBundleURLSchemes', []))
        privacy_keys = {k: v for k, v in info.items() if k.startswith('NS') and k.endswith('UsageDescription')}
        if ats or bg_modes or url_schemes or privacy_keys:
            return {
                'app_transport_security': ats,
                'background_modes': bg_modes,
                'url_schemes': url_schemes,
                'privacy_descriptions': privacy_keys,
                'bundle_id': info.get('CFBundleIdentifier', ''),
                'min_os': info.get('MinimumOSVersion', ''),
            }
    except Exception:
        pass
    return None


def _extract_entitlements_from_provision(data):
    """Extract entitlements from embedded.mobileprovision"""
    import plistlib
    try:
        start = data.find(b'<?xml')
        end = data.find(b'</plist>') + len(b'</plist>')
        if start >= 0 and end > start:
            plist = plistlib.loads(data[start:end])
            return plist.get('Entitlements', {})
    except Exception:
        pass
    return {}


def extract_entitlements_from_archive(archive_path, original_name):
    """Extract entitlements from IPA/deb/zip archives — aggregates all sources"""
    import plistlib
    lower = original_name.lower()
    entitlements = {}

    try:
        if lower.endswith(".ipa") or lower.endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(archive_path, 'r') as zf:
                for name in zf.namelist():
                    if name.endswith('.xcent') or 'entitlements' in name.lower():
                        try:
                            data = zf.read(name)
                            parsed = plistlib.loads(data)
                            entitlements.update(parsed)
                        except Exception:
                            pass

                if not entitlements:
                    for name in zf.namelist():
                        if name.endswith('embedded.mobileprovision'):
                            ent = _extract_entitlements_from_provision(zf.read(name))
                            if ent:
                                entitlements.update(ent)
                            break

                for name in zf.namelist():
                    if name.endswith('Info.plist') and 'Payload/' in name:
                        meta = _extract_info_plist_metadata(zf.read(name))
                        if meta:
                            entitlements['_info_plist'] = meta
                        break

        elif lower.endswith(".deb"):
            extract_dir = tempfile.mkdtemp(prefix="diff_ent_")
            try:
                subprocess.run(["ar", "x", archive_path], cwd=extract_dir, capture_output=True, timeout=30)
                data_tar = None
                for name in os.listdir(extract_dir):
                    if name.startswith("data.tar"):
                        data_tar = os.path.join(extract_dir, name)
                        break

                if data_tar:
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
                            data_tar = None
                    elif data_tar.endswith(".xz"):
                        import lzma
                        decompressed = data_tar.replace(".xz", "")
                        with lzma.open(data_tar) as fin:
                            with open(decompressed, "wb") as fout:
                                fout.write(fin.read())
                        data_tar = decompressed

                if data_tar:
                    import tarfile
                    with tarfile.open(data_tar) as tf:
                        for member in tf.getmembers():
                            mlower = member.name.lower()
                            if mlower.endswith('.xcent') or 'entitlements' in mlower:
                                try:
                                    f = tf.extractfile(member)
                                    if f:
                                        parsed = plistlib.loads(f.read())
                                        entitlements.update(parsed)
                                except Exception:
                                    pass
                            elif mlower.endswith('embedded.mobileprovision') and not entitlements:
                                try:
                                    f = tf.extractfile(member)
                                    if f:
                                        ent = _extract_entitlements_from_provision(f.read())
                                        if ent:
                                            entitlements.update(ent)
                                except Exception:
                                    pass
                            elif mlower.endswith('info.plist') and '_info_plist' not in entitlements:
                                try:
                                    f = tf.extractfile(member)
                                    if f:
                                        meta = _extract_info_plist_metadata(f.read())
                                        if meta:
                                            entitlements['_info_plist'] = meta
                                except Exception:
                                    pass
            finally:
                shutil.rmtree(extract_dir, ignore_errors=True)
    except Exception:
        pass

    return entitlements


def diff_entitlements(ent1, ent2):
    """Compare entitlements between two versions"""
    all_keys = set(list(ent1.keys()) + list(ent2.keys()))
    all_keys.discard('_info_plist')

    added = {}
    removed = {}
    changed = {}
    unchanged_count = 0

    for key in sorted(all_keys):
        v1 = ent1.get(key)
        v2 = ent2.get(key)
        if v1 is None and v2 is not None:
            added[key] = v2
        elif v2 is None and v1 is not None:
            removed[key] = v1
        elif v1 != v2:
            changed[key] = {"old": v1, "new": v2}
        else:
            unchanged_count += 1

    info1 = ent1.get('_info_plist', {})
    info2 = ent2.get('_info_plist', {})
    info_changes = {}
    if info1 or info2:
        priv1 = info1.get('privacy_descriptions', {})
        priv2 = info2.get('privacy_descriptions', {})
        priv_added = {k: v for k, v in priv2.items() if k not in priv1}
        priv_removed = {k: v for k, v in priv1.items() if k not in priv2}
        schemes1 = set(info1.get('url_schemes', []))
        schemes2 = set(info2.get('url_schemes', []))
        bg1 = set(info1.get('background_modes', []))
        bg2 = set(info2.get('background_modes', []))
        ats1 = info1.get('app_transport_security', {})
        ats2 = info2.get('app_transport_security', {})

        if priv_added or priv_removed or schemes1 != schemes2 or bg1 != bg2 or ats1 != ats2:
            info_changes = {
                "privacy_added": {k: str(v) for k, v in priv_added.items()},
                "privacy_removed": {k: str(v) for k, v in priv_removed.items()},
                "url_schemes_added": sorted(schemes2 - schemes1),
                "url_schemes_removed": sorted(schemes1 - schemes2),
                "background_modes_added": sorted(bg2 - bg1),
                "background_modes_removed": sorted(bg1 - bg2),
                "ats_changed": ats1 != ats2,
            }

    return {
        "added": {k: str(v) for k, v in added.items()},
        "removed": {k: str(v) for k, v in removed.items()},
        "changed": {k: {"old": str(v["old"]), "new": str(v["new"])} for k, v in changed.items()},
        "unchanged_count": unchanged_count,
        "info_plist": info_changes,
        "has_changes": bool(added or removed or changed or info_changes),
    }


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


def get_functions(path, parsed=None):
    """Extract function names and sizes from binary"""
    try:
        main = parsed or parse_binary(path)
        if main is None:
            return {}
        funcs = {}
        try:
            for sym in main.symbols:
                name = str(sym.name)
                if sym.value > 0 and sym.size > 0 and not name.startswith('_OBJC_'):
                    funcs[name] = sym.size
        except Exception:
            pass

        if not funcs:
            try:
                out = subprocess.run(["llvm-nm", "--defined-only", "--print-size", path],
                                     capture_output=True, text=True, timeout=15)
                if out.stdout:
                    for line in out.stdout.strip().split("\n"):
                        parts = line.strip().split()
                        if len(parts) >= 4:
                            try:
                                size = int(parts[1], 16)
                                name = parts[3]
                                if size > 0 and parts[2].lower() in ('t', 'T'):
                                    funcs[name] = size
                            except (ValueError, IndexError):
                                pass
            except Exception:
                pass
        return funcs
    except Exception:
        return {}


def get_macho_headers(path, parsed=None):
    """Extract Mach-O header info for comparison"""
    try:
        import lief
        main = parsed or parse_binary(path)
        if main is None:
            return {}

        result = {}

        try:
            header = main.header
            result["magic"] = str(header.magic).split(".")[-1] if hasattr(header, 'magic') else ""
            result["cpu_type"] = str(header.cpu_type).split(".")[-1] if hasattr(header, 'cpu_type') else ""
            result["file_type"] = str(header.file_type).split(".")[-1] if hasattr(header, 'file_type') else ""
            flags = []
            try:
                for f in header.flags_list:
                    flags.append(str(f).split(".")[-1])
            except Exception:
                pass
            result["flags"] = sorted(flags)
        except Exception:
            pass

        load_commands = []
        try:
            for cmd in main.commands:
                cmd_type = str(cmd.command).split(".")[-1]
                load_commands.append(cmd_type)
        except Exception:
            pass
        result["load_commands"] = sorted(load_commands)

        try:
            if hasattr(main, 'build_version') and main.build_version:
                bv = main.build_version
                result["min_os"] = f"{bv.minos[0]}.{bv.minos[1]}.{bv.minos[2]}" if hasattr(bv, 'minos') else ""
                result["sdk"] = f"{bv.sdk[0]}.{bv.sdk[1]}.{bv.sdk[2]}" if hasattr(bv, 'sdk') else ""
                result["platform"] = str(bv.platform).split(".")[-1] if hasattr(bv, 'platform') else ""
        except Exception:
            pass

        try:
            if hasattr(main, 'version_min') and main.version_min:
                vm = main.version_min
                result["min_os"] = result.get("min_os") or f"{vm.version[0]}.{vm.version[1]}.{vm.version[2]}"
                result["sdk"] = result.get("sdk") or f"{vm.sdk[0]}.{vm.sdk[1]}.{vm.sdk[2]}"
        except Exception:
            pass

        try:
            if hasattr(main, 'uuid') and main.uuid:
                uuid_bytes = main.uuid.uuid
                result["uuid"] = "-".join(f"{b:02x}" for b in uuid_bytes)
        except Exception:
            pass

        result["pie"] = bool("PIE" in result.get("flags", []))

        rpaths = []
        try:
            for cmd in main.commands:
                cmd_type = str(cmd.command).split(".")[-1]
                if cmd_type == "RPATH" and hasattr(cmd, 'path'):
                    rpaths.append(str(cmd.path))
        except Exception:
            pass
        result["rpaths"] = rpaths

        return result
    except Exception:
        return {}


def diff_functions(funcs1, funcs2):
    """Compare functions between two binaries"""
    names1 = set(funcs1.keys())
    names2 = set(funcs2.keys())

    added = sorted(names2 - names1)
    removed = sorted(names1 - names2)

    modified = []
    for name in sorted(names1 & names2):
        s1 = funcs1[name]
        s2 = funcs2[name]
        if s1 != s2:
            modified.append({
                "name": name,
                "old_size": s1,
                "new_size": s2,
                "diff": s2 - s1,
                "pct": round(((s2 - s1) / max(s1, 1)) * 100, 1),
            })

    modified.sort(key=lambda x: abs(x["diff"]), reverse=True)

    return {
        "added": added[:50],
        "removed": removed[:50],
        "modified": modified[:50],
        "added_count": len(added),
        "removed_count": len(removed),
        "modified_count": len(modified),
        "has_changes": bool(added or removed or modified),
    }


def diff_macho_headers(h1, h2):
    """Compare Mach-O headers between two binaries"""
    changes = []

    if h1.get("cpu_type") != h2.get("cpu_type"):
        changes.append({"field": "CPU Type", "old": h1.get("cpu_type", "—"), "new": h2.get("cpu_type", "—")})

    if h1.get("file_type") != h2.get("file_type"):
        changes.append({"field": "File Type", "old": h1.get("file_type", "—"), "new": h2.get("file_type", "—")})

    if h1.get("min_os") != h2.get("min_os"):
        changes.append({"field": "Min OS", "old": h1.get("min_os", "—"), "new": h2.get("min_os", "—")})

    if h1.get("sdk") != h2.get("sdk"):
        changes.append({"field": "SDK", "old": h1.get("sdk", "—"), "new": h2.get("sdk", "—")})

    if h1.get("platform") != h2.get("platform"):
        changes.append({"field": "Platform", "old": h1.get("platform", "—"), "new": h2.get("platform", "—")})

    if h1.get("uuid") != h2.get("uuid"):
        changes.append({"field": "UUID", "old": h1.get("uuid", "—"), "new": h2.get("uuid", "—")})

    if h1.get("pie") != h2.get("pie"):
        changes.append({"field": "PIE (ASLR)", "old": str(h1.get("pie", False)), "new": str(h2.get("pie", False))})

    flags1 = set(h1.get("flags", []))
    flags2 = set(h2.get("flags", []))
    flags_added = sorted(flags2 - flags1)
    flags_removed = sorted(flags1 - flags2)

    cmds1 = h1.get("load_commands", [])
    cmds2 = h2.get("load_commands", [])
    from collections import Counter
    c1 = Counter(cmds1)
    c2 = Counter(cmds2)
    cmds_added = sorted((c2 - c1).elements())
    cmds_removed = sorted((c1 - c2).elements())

    rpaths1 = set(h1.get("rpaths", []))
    rpaths2 = set(h2.get("rpaths", []))

    return {
        "changes": changes,
        "flags_added": flags_added,
        "flags_removed": flags_removed,
        "load_commands_added": cmds_added,
        "load_commands_removed": cmds_removed,
        "rpaths_added": sorted(rpaths2 - rpaths1),
        "rpaths_removed": sorted(rpaths1 - rpaths2),
        "has_changes": bool(changes or flags_added or flags_removed or cmds_added or cmds_removed or rpaths1 != rpaths2),
    }


def extract_codesign_from_archive(archive_path, original_name):
    """Extract codesign info from IPA"""
    import plistlib
    lower = original_name.lower()
    info = {}

    try:
        if lower.endswith(".ipa") or lower.endswith(".zip"):
            import zipfile
            with zipfile.ZipFile(archive_path, 'r') as zf:
                for name in zf.namelist():
                    if name.endswith('embedded.mobileprovision'):
                        try:
                            data = zf.read(name)
                            start = data.find(b'<?xml')
                            end = data.find(b'</plist>') + len(b'</plist>')
                            if start >= 0 and end > start:
                                plist = plistlib.loads(data[start:end])
                                info["team_name"] = plist.get("TeamName", "")
                                info["team_id"] = ""
                                team_ids = plist.get("TeamIdentifier", [])
                                if team_ids:
                                    info["team_id"] = team_ids[0]
                                info["app_id"] = plist.get("AppIDName", "")
                                info["profile_name"] = plist.get("Name", "")
                                info["creation_date"] = str(plist.get("CreationDate", ""))
                                info["expiration_date"] = str(plist.get("ExpirationDate", ""))
                                info["provisioned_devices"] = len(plist.get("ProvisionedDevices", []))
                                info["is_enterprise"] = plist.get("ProvisionsAllDevices", False)
                                app_id_prefix = plist.get("ApplicationIdentifierPrefix", [])
                                info["app_id_prefix"] = app_id_prefix[0] if app_id_prefix else ""
                                ent = plist.get("Entitlements", {})
                                info["get_task_allow"] = ent.get("get-task-allow", False)
                        except Exception:
                            pass
                        break

                for name in zf.namelist():
                    if name.endswith('Info.plist') and 'Payload/' in name:
                        try:
                            data = zf.read(name)
                            plist = plistlib.loads(data)
                            info["bundle_id"] = plist.get("CFBundleIdentifier", "")
                            info["bundle_version"] = plist.get("CFBundleShortVersionString", "")
                            info["build_number"] = plist.get("CFBundleVersion", "")
                        except Exception:
                            pass
                        break
    except Exception:
        pass

    return info


def diff_codesign(cs1, cs2):
    """Compare codesign info between two versions"""
    changes = []

    fields = [
        ("team_name", "Team Name"),
        ("team_id", "Team ID"),
        ("app_id", "App ID"),
        ("app_id_prefix", "App ID Prefix"),
        ("profile_name", "Profile Name"),
        ("bundle_id", "Bundle ID"),
        ("bundle_version", "Version"),
        ("build_number", "Build"),
        ("creation_date", "Created"),
        ("expiration_date", "Expires"),
    ]

    for key, label in fields:
        v1 = cs1.get(key, "")
        v2 = cs2.get(key, "")
        if v1 and v2 and str(v1) != str(v2):
            changes.append({"field": label, "old": str(v1), "new": str(v2)})

    flags = []
    if cs1.get("team_id") and cs2.get("team_id") and cs1["team_id"] != cs2["team_id"]:
        flags.append("Team ID changed — possible re-sign detected")
    if cs1.get("get_task_allow") != cs2.get("get_task_allow"):
        if cs2.get("get_task_allow"):
            flags.append("get-task-allow enabled — debug/development build")
        else:
            flags.append("get-task-allow disabled — production build")
    if cs1.get("is_enterprise") != cs2.get("is_enterprise"):
        if cs2.get("is_enterprise"):
            flags.append("Changed to enterprise distribution")
        else:
            flags.append("Changed from enterprise to standard distribution")
    dev1 = cs1.get("provisioned_devices", 0)
    dev2 = cs2.get("provisioned_devices", 0)
    if dev1 != dev2:
        flags.append(f"Provisioned devices: {dev1} → {dev2}")

    return {
        "changes": changes,
        "flags": flags,
        "old": cs1,
        "new": cs2,
        "has_changes": bool(changes or flags),
    }


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


def extract_network_footprint(strings):
    """Extract all URLs, domains, IPs from a set of strings"""
    import re
    urls = set()
    domains = set()
    ips = set()

    url_re = re.compile(r'https?://[^\s"\'<>]+')
    domain_re = re.compile(r'\b(?:[a-zA-Z0-9-]+\.)+(?:com|io|net|org|app|dev|co|me|ai|cloud|run|xyz|info|biz|us|uk|de|fr|cn|jp|kr|br|ru|au|in|ca)\b')
    ip_re = re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')

    for s in strings:
        for u in url_re.findall(s):
            u = u.rstrip('.,;:)]}')
            urls.add(u)
            try:
                from urllib.parse import urlparse
                parsed = urlparse(u)
                if parsed.hostname:
                    domains.add(parsed.hostname)
            except Exception:
                pass
        for d in domain_re.findall(s):
            domains.add(d)
        for ip in ip_re.findall(s):
            if not ip.startswith('0.') and not ip.startswith('127.'):
                ips.add(ip)

    return {
        "urls": sorted(urls),
        "domains": sorted(domains),
        "ips": sorted(ips),
    }


def analyze_network_diff(strings1, strings2):
    """Compare network footprint between two versions"""
    net1 = extract_network_footprint(strings1)
    net2 = extract_network_footprint(strings2)

    return {
        "urls": {
            "added": sorted(set(net2["urls"]) - set(net1["urls"])),
            "removed": sorted(set(net1["urls"]) - set(net2["urls"])),
            "common_count": len(set(net1["urls"]) & set(net2["urls"])),
        },
        "domains": {
            "added": sorted(set(net2["domains"]) - set(net1["domains"])),
            "removed": sorted(set(net1["domains"]) - set(net2["domains"])),
            "old_count": len(net1["domains"]),
            "new_count": len(net2["domains"]),
            "common": sorted(set(net1["domains"]) & set(net2["domains"])),
        },
        "ips": {
            "added": sorted(set(net2["ips"]) - set(net1["ips"])),
            "removed": sorted(set(net1["ips"]) - set(net2["ips"])),
        },
    }


def analyze_privacy_impact(libs_added, libs_removed, strings_added, strings_removed, classes_added):
    """Analyze privacy impact of changes between versions"""
    import re

    tracking_frameworks = {
        "AdSupport": "Advertising ID tracking",
        "AppTrackingTransparency": "ATT prompt (tracking consent)",
        "AdServices": "Apple Search Ads attribution",
        "StoreKit": "In-app purchases / subscriptions",
        "CoreLocation": "GPS location access",
        "Contacts": "Contacts access",
        "Photos": "Photo library access",
        "PhotosUI": "Photo picker access",
        "AVFoundation": "Camera/microphone access",
        "CoreBluetooth": "Bluetooth scanning",
        "CoreMotion": "Motion/accelerometer data",
        "HealthKit": "Health data access",
        "HomeKit": "Home automation data",
        "Speech": "Speech recognition",
        "LocalAuthentication": "Biometric data (Face ID/Touch ID)",
        "UserNotifications": "Push notifications",
        "CoreTelephony": "Carrier/network info",
        "NetworkExtension": "VPN/network configuration",
        "WebKit": "Web browsing capability",
    }

    tracking_sdks = {
        "Firebase": "Google Analytics/Firebase",
        "facebook": "Facebook SDK",
        "FBSDKCore": "Facebook SDK",
        "Adjust": "Adjust attribution",
        "AppsFlyer": "AppsFlyer attribution",
        "Branch": "Branch deep linking",
        "Mixpanel": "Mixpanel analytics",
        "Amplitude": "Amplitude analytics",
        "Segment": "Segment analytics",
        "Flurry": "Flurry analytics",
        "Crashlytics": "Crash reporting",
        "Sentry": "Error tracking",
        "RevenueCat": "Subscription tracking",
        "OneSignal": "Push notification service",
        "Braze": "Braze engagement",
        "CleverTap": "CleverTap analytics",
        "MoEngage": "MoEngage analytics",
        "Singular": "Singular attribution",
        "Kochava": "Kochava attribution",
    }

    privacy_flags = []
    data_access_added = []
    data_access_removed = []
    trackers_added = []
    trackers_removed = []

    seen_added = set()
    for lib in libs_added:
        lib_name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "").replace("libswift", "")
        if lib_name in tracking_frameworks and lib_name not in seen_added:
            seen_added.add(lib_name)
            data_access_added.append({
                "framework": lib_name,
                "description": tracking_frameworks[lib_name],
                "risk": "high" if lib_name in ("AdSupport", "CoreLocation", "Contacts", "HealthKit") else "medium",
            })

    seen_removed = set()
    for lib in libs_removed:
        lib_name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "").replace("libswift", "")
        if lib_name in tracking_frameworks and lib_name not in seen_removed:
            seen_removed.add(lib_name)
            data_access_removed.append({
                "framework": lib_name,
                "description": tracking_frameworks[lib_name],
            })

    all_added_str = " ".join(strings_added) + " ".join(classes_added)
    all_removed_str = " ".join(strings_removed)
    for sdk, desc in tracking_sdks.items():
        if sdk.lower() in all_added_str.lower() and sdk.lower() not in all_removed_str.lower():
            trackers_added.append({"sdk": sdk, "description": desc})
        elif sdk.lower() in all_removed_str.lower() and sdk.lower() not in all_added_str.lower():
            trackers_removed.append({"sdk": sdk, "description": desc})

    fingerprint_strings = [
        "IDFA", "IDFV", "advertisingIdentifier", "identifierForVendor",
        "deviceFingerprint", "fingerprint", "device_id", "uniqueIdentifier",
        "carrier", "mobileCountryCode", "mobileNetworkCode",
    ]
    for fp in fingerprint_strings:
        if any(fp.lower() in s.lower() for s in strings_added) and not any(fp.lower() in s.lower() for s in strings_removed):
            privacy_flags.append(f"New device fingerprinting: {fp}")

    data_collection_patterns = {
        "clipboard": "Clipboard data access (UIPasteboard)",
        "pasteboard": "Clipboard data access (UIPasteboard)",
        "SSID": "WiFi network name collection",
        "deviceModel": "Device model collection",
        "systemVersion": "OS version collection",
        "batteryLevel": "Battery level monitoring",
        "diskSpace": "Storage space monitoring",
        "jailbreak": "Jailbreak detection added",
    }
    for pattern, desc in data_collection_patterns.items():
        if any(pattern.lower() in s.lower() for s in strings_added):
            privacy_flags.append(desc)

    risk_score = 0
    risk_score += len(data_access_added) * 15
    risk_score += len(trackers_added) * 10
    risk_score += len(privacy_flags) * 5
    risk_score -= len(data_access_removed) * 10
    risk_score -= len(trackers_removed) * 8
    risk_score = max(0, min(100, risk_score))

    if risk_score == 0 and not data_access_added and not trackers_added and not privacy_flags:
        risk_level = "none"
    elif risk_score <= 20:
        risk_level = "low"
    elif risk_score <= 50:
        risk_level = "medium"
    elif risk_score <= 75:
        risk_level = "high"
    else:
        risk_level = "critical"

    return {
        "risk_score": risk_score,
        "risk_level": risk_level,
        "data_access_added": data_access_added,
        "data_access_removed": data_access_removed,
        "trackers_added": trackers_added,
        "trackers_removed": trackers_removed,
        "privacy_flags": privacy_flags,
    }


def generate_security_assessment(result):
    """Generate security risk assessment from all diff data"""
    risks = []
    score = 0

    libs_added = result.get("libraries", {}).get("added", [])
    libs_removed = result.get("libraries", {}).get("removed", [])

    security_frameworks = {
        "Security": "low",
        "CryptoKit": "low",
        "LocalAuthentication": "low",
        "DeviceCheck": "low",
    }
    dangerous_frameworks = {
        "JavaScriptCore": "Can execute arbitrary JS code",
        "WebKit": "Web content rendering — potential XSS/injection",
        "NetworkExtension": "VPN/proxy — can intercept network traffic",
        "IOKit": "Low-level hardware access",
    }

    for lib in libs_added:
        name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "").replace("libswift", "")
        if name in dangerous_frameworks:
            risks.append({
                "type": "framework",
                "severity": "warning",
                "title": f"Added {name}",
                "detail": dangerous_frameworks[name],
            })
            score += 15

    for lib in libs_removed:
        name = lib.split("/")[-1].replace(".framework", "").replace(".dylib", "").replace("libswift", "")
        if name in security_frameworks:
            risks.append({
                "type": "regression",
                "severity": "critical",
                "title": f"Removed {name} framework",
                "detail": "Security framework removed — possible security downgrade",
            })
            score += 25

    all_added_strings = set(result.get("strings", {}).get("added", []))
    all_removed_strings = set(result.get("strings", {}).get("removed", []))

    ssl_pinning_keywords = ["ssl_pin", "SSLPinning", "TrustKit", "pinned_certificates", "pinnedCertificates",
                            "evaluateServerTrust", "SecTrustEvaluate", "URLAuthenticationChallenge"]
    pinning_added = any(any(kw.lower() in s.lower() for kw in ssl_pinning_keywords) for s in all_added_strings)
    pinning_removed = any(any(kw.lower() in s.lower() for kw in ssl_pinning_keywords) for s in all_removed_strings)

    if pinning_removed and not pinning_added:
        risks.append({
            "type": "regression",
            "severity": "critical",
            "title": "SSL Pinning possibly removed",
            "detail": "Certificate pinning strings were removed — network traffic may be interceptable",
        })
        score += 30
    elif pinning_added:
        risks.append({
            "type": "improvement",
            "severity": "info",
            "title": "SSL Pinning added/updated",
            "detail": "Certificate pinning strings added — improved MITM protection",
        })

    antidebug_keywords = ["ptrace", "sysctl", "P_TRACED", "PT_DENY_ATTACH", "csops", "getppid"]
    debug_removed = any(any(kw in s for kw in antidebug_keywords) for s in all_removed_strings)
    debug_added = any(any(kw in s for kw in antidebug_keywords) for s in all_added_strings)
    if debug_removed and not debug_added:
        risks.append({
            "type": "regression",
            "severity": "warning",
            "title": "Anti-debug checks possibly removed",
            "detail": "Debug protection strings removed — easier to attach debuggers",
        })
        score += 15
    elif debug_added and not debug_removed:
        risks.append({
            "type": "improvement",
            "severity": "info",
            "title": "Anti-debug protection added",
            "detail": "New anti-debugging measures detected",
        })

    jb_keywords = ["Cydia", "jailbreak", "checkra1n", "unc0ver", "sileo", "/Applications/Cydia.app",
                    "/private/var/lib/apt", "substrate", "substitute"]
    jb_removed = any(any(kw.lower() in s.lower() for kw in jb_keywords) for s in all_removed_strings)
    jb_added = any(any(kw.lower() in s.lower() for kw in jb_keywords) for s in all_added_strings)
    if jb_removed and not jb_added:
        risks.append({
            "type": "regression",
            "severity": "warning",
            "title": "Jailbreak detection possibly removed",
            "detail": "Jailbreak detection strings removed — app may run on compromised devices without checks",
        })
        score += 15

    encryption_keywords = ["AES", "RSA", "CCCrypt", "CommonCrypto", "kCCAlgorithm", "SecKeyEncrypt"]
    enc_changed = any(any(kw in s for kw in encryption_keywords) for s in all_added_strings)
    enc_removed = any(any(kw in s for kw in encryption_keywords) for s in all_removed_strings)
    if enc_removed and not enc_changed:
        risks.append({
            "type": "regression",
            "severity": "warning",
            "title": "Encryption references removed",
            "detail": "Cryptographic function references removed — possible weakened data protection",
        })
        score += 10

    new_api_count = len(result.get("network", {}).get("urls", {}).get("added", []))
    if new_api_count > 5:
        risks.append({
            "type": "expansion",
            "severity": "warning",
            "title": f"{new_api_count} new API endpoints",
            "detail": "Significant expansion of network communication — review new endpoints for data leakage",
        })
        score += 10
    elif new_api_count > 0:
        risks.append({
            "type": "expansion",
            "severity": "info",
            "title": f"{new_api_count} new API endpoint(s)",
            "detail": "New network endpoints detected — data may be sent to new servers",
        })

    score = max(0, min(100, score))
    if score == 0 and not risks:
        risk_level = "none"
    elif score <= 15:
        risk_level = "low"
    elif score <= 40:
        risk_level = "medium"
    elif score <= 70:
        risk_level = "high"
    else:
        risk_level = "critical"

    return {
        "risk_score": score,
        "risk_level": risk_level,
        "findings": risks,
    }


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

    result["network"] = analyze_network_diff(strings1, strings2)

    result["privacy"] = analyze_privacy_impact(
        result["libraries"].get("added", []),
        result["libraries"].get("removed", []),
        sorted(list(added_strings)),
        sorted(list(removed_strings)),
        result["classes"].get("added", []),
    )

    funcs1 = get_functions(path1, parsed1)
    funcs2 = get_functions(path2, parsed2)
    if funcs1 or funcs2:
        result["functions"] = diff_functions(funcs1, funcs2)

    headers1 = get_macho_headers(path1, parsed1)
    headers2 = get_macho_headers(path2, parsed2)
    if headers1 or headers2:
        result["headers"] = diff_macho_headers(headers1, headers2)

    result["insights"] = generate_insights(result)

    result["security"] = generate_security_assessment(result)

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

        ent1 = extract_entitlements_from_archive(p1, n1)
        ent2 = extract_entitlements_from_archive(p2, n2)
        if ent1 or ent2:
            result["entitlements"] = diff_entitlements(ent1, ent2)
        else:
            result["entitlements"] = {"has_changes": False, "added": {}, "removed": {}, "changed": {}, "unchanged_count": 0, "info_plist": {}}

        cs1 = extract_codesign_from_archive(p1, n1)
        cs2 = extract_codesign_from_archive(p2, n2)
        if cs1 or cs2:
            result["codesign"] = diff_codesign(cs1, cs2)
        else:
            result["codesign"] = {"has_changes": False, "changes": [], "flags": [], "old": {}, "new": {}}

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

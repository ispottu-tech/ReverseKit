import { Router } from "express";
import multer from "multer";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import os from "os";

const execFileAsync = promisify(execFile);
const router = Router();

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const PYTHON_SCRIPT = path.join(__dirname, "../src/lib/analyze_binary.py");

router.post("/binary/analyze", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tmpPath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const pythonBin = process.env.PYTHON_BIN || "/home/runner/workspace/.pythonlibs/bin/python3";
    const { stdout, stderr } = await execFileAsync(pythonBin, [PYTHON_SCRIPT, tmpPath, originalName], {
      timeout: 300000,
      maxBuffer: 50 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH || "",
      },
    });

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(stdout);
    } catch {
      return res.status(500).json({ error: "Analysis failed", details: stderr || stdout });
    }

    result.filename = originalName;
    res.json(result);
  } catch (err: unknown) {
    const error = err as { stderr?: string; stdout?: string; message?: string };
    res.status(500).json({
      error: "Analysis failed",
      details: error.stderr || error.message || String(err),
    });
  } finally {
    try {
      fs.unlinkSync(tmpPath);
    } catch {}
  }
});

router.post("/binary/hexdump", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tmpPath = req.file.path;
  const originalName = req.file.originalname;
  const rawOffset = parseInt(req.body.offset || "0", 10);
  const rawLength = parseInt(req.body.length || "4096", 10);
  if (isNaN(rawOffset) || isNaN(rawLength) || rawOffset < 0 || rawLength < 1) {
    try { fs.unlinkSync(tmpPath); } catch {}
    return res.status(400).json({ error: "Invalid offset or length" });
  }
  const offset = rawOffset;
  const length = Math.min(rawLength, 65536);

  try {
    const stat = fs.statSync(tmpPath);
    const fd = fs.openSync(tmpPath, "r");
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    fs.closeSync(fd);

    const bytes = Array.from(buffer.subarray(0, bytesRead));

    res.json({
      filename: originalName,
      fileSize: stat.size,
      offset,
      length: bytesRead,
      bytes,
    });
  } catch (err: unknown) {
    const error = err as { message?: string };
    res.status(500).json({ error: error.message || String(err) });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

router.post("/binary/fileinfo", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tmpPath = req.file.path;
  const originalName = req.file.originalname;

  try {
    const stat = fs.statSync(tmpPath);
    const fileOut = await execFileAsync("file", ["-b", tmpPath], { timeout: 10000 }).catch(() => ({ stdout: "Unknown" }));

    const fd = fs.openSync(tmpPath, "r");
    const header = Buffer.alloc(Math.min(16, stat.size));
    fs.readSync(fd, header, 0, header.length, 0);
    fs.closeSync(fd);

    const magic = header.subarray(0, 4).toString("hex").toUpperCase();

    res.json({
      filename: originalName,
      size: stat.size,
      type: (fileOut.stdout || "").trim(),
      magic,
      headerHex: header.toString("hex").toUpperCase(),
    });
  } catch (err: unknown) {
    const error = err as { message?: string };
    res.status(500).json({ error: error.message || String(err) });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

router.post("/binary/hexsearch", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const tmpPath = req.file.path;
  const query = (req.body.query || "").trim();
  const mode = req.body.mode || "hex";
  const maxResults = Math.min(parseInt(req.body.maxResults || "100", 10), 500);

  if (!query) {
    try { fs.unlinkSync(tmpPath); } catch {}
    return res.status(400).json({ error: "No search query" });
  }

  try {
    const data = fs.readFileSync(tmpPath);
    let needle: Buffer;

    if (mode === "hex") {
      const cleaned = query.replace(/0x/gi, "").replace(/[\s,]/g, "");
      if (!/^[0-9a-fA-F]+$/.test(cleaned) || cleaned.length < 2 || cleaned.length % 2 !== 0) {
        return res.status(400).json({ error: "Invalid hex pattern. Use pairs like: CA FE BA BE" });
      }
      needle = Buffer.from(cleaned, "hex");
    } else {
      needle = Buffer.from(query, "utf-8");
    }

    if (needle.length === 0) {
      return res.status(400).json({ error: "Empty search pattern" });
    }

    const matches: number[] = [];
    let pos = 0;
    let hasMore = false;
    while (pos <= data.length - needle.length) {
      const idx = data.indexOf(needle, pos);
      if (idx === -1) break;
      if (matches.length >= maxResults) {
        hasMore = true;
        break;
      }
      matches.push(idx);
      pos = idx + 1;
    }

    res.json({
      query,
      mode,
      needleLength: needle.length,
      totalMatches: matches.length,
      matches,
      truncated: hasMore,
    });
  } catch (err: unknown) {
    const error = err as { message?: string };
    res.status(500).json({ error: error.message || String(err) });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
});

const diffUpload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 100 * 1024 * 1024 },
}).fields([
  { name: "file1", maxCount: 1 },
  { name: "file2", maxCount: 1 },
]);

router.post("/binary/diff", diffUpload, async (req, res) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] };
  const file1 = files?.file1?.[0];
  const file2 = files?.file2?.[0];

  if (!file1 || !file2) {
    if (file1) try { fs.unlinkSync(file1.path); } catch {}
    if (file2) try { fs.unlinkSync(file2.path); } catch {}
    return res.status(400).json({ error: "Two files required (file1, file2)" });
  }

  try {
    const pythonBin = process.env.PYTHON_BIN || "/home/runner/workspace/.pythonlibs/bin/python3";
    const diffScript = path.join(__dirname, "../src/lib/binary_diff.py");
    const { stdout, stderr } = await execFileAsync(pythonBin, [diffScript, file1.path, file2.path, file1.originalname, file2.originalname], {
      timeout: 60000,
      maxBuffer: 20 * 1024 * 1024,
    });

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(stdout);
    } catch {
      return res.status(500).json({ error: "Diff failed", details: stderr || stdout });
    }
    res.json(result);
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    res.status(500).json({ error: error.stderr || error.message || String(err) });
  } finally {
    try { fs.unlinkSync(file1.path); } catch {}
    try { fs.unlinkSync(file2.path); } catch {}
  }
});

export default router;

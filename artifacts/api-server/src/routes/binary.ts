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
    const { stdout, stderr } = await execFileAsync(pythonBin, [PYTHON_SCRIPT, tmpPath], {
      timeout: 120000,
      maxBuffer: 20 * 1024 * 1024,
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

export default router;

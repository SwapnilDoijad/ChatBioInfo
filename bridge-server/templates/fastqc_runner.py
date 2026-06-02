#!/usr/bin/env python3
"""FastQC SLURM job runner for ChatBioInfo bridge.

This script reads bridge input JSON, runs FastQC, and writes a JSON result.
Expected input schema:
{
  "query": "...",
  "sampleData": {
    "fastqPath": "/shared/path/sample.fastq.gz",
    "outDir": "/shared/path/output",      # optional
    "threads": 4                             # optional
  }
}
"""

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path


def parse_args():
  parser = argparse.ArgumentParser(description="Run FastQC using bridge input/output files")
  parser.add_argument("--input", required=True, help="Path to bridge input JSON")
  parser.add_argument("--output", required=True, help="Path to result JSON")
  parser.add_argument("--job-dir", required=False, default="", help="Remote bridge job directory")
  parser.add_argument("--fastqc-bin", required=False, default="fastqc", help="FastQC binary path")
  return parser.parse_args()


def maybe_strip_fastq_suffix(filename: str) -> str:
  suffixes = [".fastq.gz", ".fq.gz", ".fastq", ".fq"]
  lower = filename.lower()
  for suffix in suffixes:
    if lower.endswith(suffix):
      return filename[: -len(suffix)]
  return filename


def main():
  args = parse_args()

  with open(args.input, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

  sample_data = payload.get("sampleData") or {}
  fastq_path = sample_data.get("fastqPath")

  if not fastq_path:
    result = {
      "status": "failed",
      "error": "sampleData.fastqPath is required",
      "inputPath": args.input
    }
    with open(args.output, "w", encoding="utf-8") as handle:
      json.dump(result, handle, indent=2)
    return 2

  threads = int(sample_data.get("threads", 2))

  job_dir = args.job_dir or str(Path(args.output).resolve().parent)
  out_dir = sample_data.get("outDir") or os.path.join(job_dir, "fastqc")
  os.makedirs(out_dir, exist_ok=True)

  cmd = [
    args.fastqc_bin,
    "-t",
    str(threads),
    "-o",
    out_dir,
    fastq_path
  ]

  completed = subprocess.run(cmd, capture_output=True, text=True)

  base_name = maybe_strip_fastq_suffix(Path(fastq_path).name)
  html_report = os.path.join(out_dir, f"{base_name}_fastqc.html")
  zip_report = os.path.join(out_dir, f"{base_name}_fastqc.zip")

  result = {
    "status": "completed" if completed.returncode == 0 else "failed",
    "returnCode": completed.returncode,
    "fastqPath": fastq_path,
    "outDir": out_dir,
    "htmlReport": html_report if os.path.exists(html_report) else None,
    "zipReport": zip_report if os.path.exists(zip_report) else None,
    "stdout": completed.stdout,
    "stderr": completed.stderr
  }

  with open(args.output, "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)

  return completed.returncode


if __name__ == "__main__":
  sys.exit(main())

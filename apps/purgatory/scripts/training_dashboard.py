"""Live training dashboard — reads results.csv and plots metrics as training runs.

Usage:
    python apps/purgatory/scripts/training_dashboard.py
    python apps/purgatory/scripts/training_dashboard.py runs/detect/purgatory_v3/results.csv
"""
import sys
import os
import glob
import time
import csv
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.animation as animation
from matplotlib.gridspec import GridSpec

# ── Locate results.csv ────────────────────────────────────────────────────────

def find_latest_results():
    matches = sorted(glob.glob("runs/detect/*/results.csv"), key=os.path.getmtime)
    return matches[-1] if matches else None

if len(sys.argv) > 1:
    CSV_PATH = sys.argv[1]
else:
    CSV_PATH = find_latest_results()
    if not CSV_PATH:
        print("No results.csv found. Pass path as argument or run from repo root.")
        sys.exit(1)

print(f"Watching: {CSV_PATH}")

# ── Layout ────────────────────────────────────────────────────────────────────

fig = plt.figure(figsize=(13, 8), facecolor="#111827")
fig.suptitle(f"Training — {Path(CSV_PATH).parent.name}", color="#f9fafb", fontsize=13, y=0.98)

gs = GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.35,
              left=0.07, right=0.97, top=0.91, bottom=0.08)

ax_map    = fig.add_subplot(gs[0, :2])   # mAP50 + mAP50-95 — wide
ax_pr     = fig.add_subplot(gs[0, 2])    # Precision / Recall
ax_tloss  = fig.add_subplot(gs[1, 0])    # Train losses
ax_vloss  = fig.add_subplot(gs[1, 1])    # Val losses
ax_lr     = fig.add_subplot(gs[1, 2])    # Learning rate

BG       = "#111827"
SURFACE  = "#1f2937"
GRID     = "#374151"
TEXT     = "#e5e7eb"
MUTED    = "#9ca3af"
BLUE     = "#60a5fa"
INDIGO   = "#818cf8"
GREEN    = "#34d399"
AMBER    = "#f59e0b"
RED      = "#f87171"
PINK     = "#f472b6"

for ax in (ax_map, ax_pr, ax_tloss, ax_vloss, ax_lr):
    ax.set_facecolor(SURFACE)
    ax.tick_params(colors=MUTED, labelsize=9)
    ax.xaxis.label.set_color(MUTED)
    ax.yaxis.label.set_color(MUTED)
    ax.title.set_color(TEXT)
    for spine in ax.spines.values():
        spine.set_edgecolor(GRID)
    ax.grid(True, color=GRID, linewidth=0.5, alpha=0.7)

# Status text at top right
status_text = fig.text(0.97, 0.96, "", ha="right", va="top",
                        color=MUTED, fontsize=9, family="monospace")

# ── Read CSV ──────────────────────────────────────────────────────────────────

def read_csv(path):
    rows = []
    try:
        with open(path) as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    rows.append({k.strip(): float(v) for k, v in row.items()})
                except ValueError:
                    pass
    except FileNotFoundError:
        pass
    return rows

# ── Update ────────────────────────────────────────────────────────────────────

def update(_frame):
    rows = read_csv(CSV_PATH)
    if not rows:
        return

    epochs   = [r["epoch"] for r in rows]
    map50    = [r["metrics/mAP50(B)"] for r in rows]
    map5095  = [r["metrics/mAP50-95(B)"] for r in rows]
    prec     = [r["metrics/precision(B)"] for r in rows]
    rec      = [r["metrics/recall(B)"] for r in rows]
    t_box    = [r["train/box_loss"] for r in rows]
    t_cls    = [r["train/cls_loss"] for r in rows]
    t_dfl    = [r["train/dfl_loss"] for r in rows]
    v_box    = [r["val/box_loss"] for r in rows]
    v_cls    = [r["val/cls_loss"] for r in rows]
    v_dfl    = [r["val/dfl_loss"] for r in rows]
    lr       = [r["lr/pg0"] for r in rows]

    cur = rows[-1]
    e   = int(cur["epoch"])

    # ── mAP ──────────────────────────────────────────────────────────────────
    ax_map.cla()
    ax_map.set_facecolor(SURFACE)
    ax_map.grid(True, color=GRID, linewidth=0.5, alpha=0.7)
    ax_map.plot(epochs, map50,   color=BLUE,   lw=2,   label=f"mAP50  {map50[-1]:.3f}")
    ax_map.plot(epochs, map5095, color=INDIGO, lw=1.5, linestyle="--", label=f"mAP50-95  {map5095[-1]:.3f}")
    ax_map.axhline(0.75, color=GREEN, lw=0.8, linestyle=":", alpha=0.6, label="target 0.75")
    ax_map.set_title("mAP", color=TEXT, fontsize=10)
    ax_map.set_xlabel("epoch", fontsize=9)
    ax_map.set_ylim(0, 1.05)
    ax_map.legend(fontsize=8, facecolor=SURFACE, edgecolor=GRID, labelcolor=TEXT, loc="upper left")
    ax_map.tick_params(colors=MUTED, labelsize=9)
    for spine in ax_map.spines.values(): spine.set_edgecolor(GRID)

    # ── Precision / Recall ────────────────────────────────────────────────────
    ax_pr.cla()
    ax_pr.set_facecolor(SURFACE)
    ax_pr.grid(True, color=GRID, linewidth=0.5, alpha=0.7)
    ax_pr.plot(epochs, prec, color=GREEN, lw=1.5, label=f"Prec  {prec[-1]:.3f}")
    ax_pr.plot(epochs, rec,  color=AMBER, lw=1.5, label=f"Rec   {rec[-1]:.3f}")
    ax_pr.set_title("Precision / Recall", color=TEXT, fontsize=10)
    ax_pr.set_xlabel("epoch", fontsize=9)
    ax_pr.set_ylim(0, 1.05)
    ax_pr.legend(fontsize=8, facecolor=SURFACE, edgecolor=GRID, labelcolor=TEXT)
    ax_pr.tick_params(colors=MUTED, labelsize=9)
    for spine in ax_pr.spines.values(): spine.set_edgecolor(GRID)

    # ── Train loss ────────────────────────────────────────────────────────────
    ax_tloss.cla()
    ax_tloss.set_facecolor(SURFACE)
    ax_tloss.grid(True, color=GRID, linewidth=0.5, alpha=0.7)
    ax_tloss.plot(epochs, t_box, color=BLUE,  lw=1.5, label=f"box {t_box[-1]:.3f}")
    ax_tloss.plot(epochs, t_cls, color=PINK,  lw=1.5, label=f"cls {t_cls[-1]:.3f}")
    ax_tloss.plot(epochs, t_dfl, color=AMBER, lw=1.5, label=f"dfl {t_dfl[-1]:.3f}")
    ax_tloss.set_title("Train loss", color=TEXT, fontsize=10)
    ax_tloss.set_xlabel("epoch", fontsize=9)
    ax_tloss.legend(fontsize=8, facecolor=SURFACE, edgecolor=GRID, labelcolor=TEXT)
    ax_tloss.tick_params(colors=MUTED, labelsize=9)
    for spine in ax_tloss.spines.values(): spine.set_edgecolor(GRID)

    # ── Val loss ──────────────────────────────────────────────────────────────
    ax_vloss.cla()
    ax_vloss.set_facecolor(SURFACE)
    ax_vloss.grid(True, color=GRID, linewidth=0.5, alpha=0.7)
    ax_vloss.plot(epochs, v_box, color=BLUE,  lw=1.5, label=f"box {v_box[-1]:.3f}")
    ax_vloss.plot(epochs, v_cls, color=PINK,  lw=1.5, label=f"cls {v_cls[-1]:.3f}")
    ax_vloss.plot(epochs, v_dfl, color=AMBER, lw=1.5, label=f"dfl {v_dfl[-1]:.3f}")
    ax_vloss.set_title("Val loss", color=TEXT, fontsize=10)
    ax_vloss.set_xlabel("epoch", fontsize=9)
    ax_vloss.legend(fontsize=8, facecolor=SURFACE, edgecolor=GRID, labelcolor=TEXT)
    ax_vloss.tick_params(colors=MUTED, labelsize=9)
    for spine in ax_vloss.spines.values(): spine.set_edgecolor(GRID)

    # ── LR ────────────────────────────────────────────────────────────────────
    ax_lr.cla()
    ax_lr.set_facecolor(SURFACE)
    ax_lr.grid(True, color=GRID, linewidth=0.5, alpha=0.7)
    ax_lr.plot(epochs, lr, color=INDIGO, lw=1.5)
    ax_lr.set_title("Learning rate", color=TEXT, fontsize=10)
    ax_lr.set_xlabel("epoch", fontsize=9)
    ax_lr.tick_params(colors=MUTED, labelsize=9)
    for spine in ax_lr.spines.values(): spine.set_edgecolor(GRID)

    # ── Status ────────────────────────────────────────────────────────────────
    status_text.set_text(
        f"epoch {e}  |  mAP50 {map50[-1]:.3f}  |  prec {prec[-1]:.3f}  rec {rec[-1]:.3f}"
    )

ani = animation.FuncAnimation(fig, update, interval=15000, cache_frame_data=False)
update(None)  # draw immediately without waiting for first interval
plt.show()

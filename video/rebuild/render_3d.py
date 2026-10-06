"""Compatibility entrypoint for the current film."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).resolve().parents[1]/"source/render_3d.py"),run_name="__main__")

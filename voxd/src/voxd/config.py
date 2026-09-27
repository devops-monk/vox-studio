from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path


def default_data_dir() -> Path:
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / "com.voxstudio.app"
    if sys.platform == "win32":
        return Path(os.environ.get("APPDATA", home)) / "VoxStudio"
    return Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")) / "voxstudio"


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    port: int = 4870
    # Per-launch secret shared with the shell; empty disables the check (tests, CLI use).
    token: str = ""
    # Optional base URL serving `<model id>/<file name>`; for firewalled or offline installs.
    model_mirror: str = ""
    allowed_origins: tuple[str, ...] = field(
        default=(
            "tauri://localhost",
            "http://tauri.localhost",
            "http://localhost:1420",
        )
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "voxd.db"

    @property
    def takes_dir(self) -> Path:
        return self.data_dir / "takes"

    @property
    def models_dir(self) -> Path:
        return self.data_dir / "models"

    def ensure_dirs(self) -> None:
        self.takes_dir.mkdir(parents=True, exist_ok=True)

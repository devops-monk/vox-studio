"""Write voxd's OpenAPI schema to stdout (used by `npm run api:gen`)."""

import json
import tempfile
from pathlib import Path

from .app import create_app
from .config import Settings

if __name__ == "__main__":
    app = create_app(Settings(data_dir=Path(tempfile.mkdtemp())))
    print(json.dumps(app.openapi(), indent=2))

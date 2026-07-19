"""Package entry point so `python -m app.pipeline <brochure>` runs the CLI."""

from app.pipeline.orchestrator import main

if __name__ == "__main__":
    raise SystemExit(main())

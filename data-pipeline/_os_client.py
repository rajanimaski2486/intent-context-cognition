"""Shared OpenSearch connection builder for the data pipeline.

Resolves which cluster to connect to from a `--target` CLI flag (or the
OPENSEARCH_TARGET env var), so the same indexing scripts can backfill either the
primary cluster or a standby/fallback Aiven service without editing .env.local:

    primary  (default) -> OPENSEARCH_URL / OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD
    fallback           -> OPENSEARCH_FALLBACK_URL / _USERNAME / _PASSWORD

Usage from a script:
    from _os_client import build_client
    client = build_client(timeout=60)

Run it against the standby:
    python 03_index_opensearch.py --target fallback
    # or
    OPENSEARCH_TARGET=fallback python 03_index_opensearch.py

The caller is responsible for loading .env.local (via load_dotenv) before calling
build_client — this module only reads os.environ.
"""

import os
import sys

from opensearchpy import OpenSearch, RequestsHttpConnection


def resolve_target() -> str:
    """Return 'primary' or 'fallback' from argv (--target X / --target=X) or the
    OPENSEARCH_TARGET env var, defaulting to 'primary'."""
    argv = sys.argv[1:]
    for i, arg in enumerate(argv):
        if arg == "--target" and i + 1 < len(argv):
            return argv[i + 1].strip().lower()
        if arg.startswith("--target="):
            return arg.split("=", 1)[1].strip().lower()
    return os.environ.get("OPENSEARCH_TARGET", "primary").strip().lower()


def _credentials(target: str) -> tuple[str, str, str]:
    if target in ("", "primary"):
        return (
            os.environ["OPENSEARCH_URL"],
            os.environ["OPENSEARCH_USERNAME"],
            os.environ["OPENSEARCH_PASSWORD"],
        )
    if target == "fallback":
        try:
            return (
                os.environ["OPENSEARCH_FALLBACK_URL"],
                os.environ["OPENSEARCH_FALLBACK_USERNAME"],
                os.environ["OPENSEARCH_FALLBACK_PASSWORD"],
            )
        except KeyError as e:
            raise SystemExit(
                f"--target fallback needs {e} in .env.local "
                "(OPENSEARCH_FALLBACK_URL / _USERNAME / _PASSWORD)."
            )
    raise SystemExit(f"Unknown --target '{target}' (use 'primary' or 'fallback').")


def build_client(timeout: int = 60) -> OpenSearch:
    target = resolve_target()
    url, username, password = _credentials(target)

    url = url.rstrip("/")
    if url.startswith("https://"):
        host, use_ssl = url[len("https://"):], True
    elif url.startswith("http://"):
        host, use_ssl = url[len("http://"):], False
    else:
        host, use_ssl = url, True

    if ":" in host:
        hostname, port_str = host.rsplit(":", 1)
        port = int(port_str)
    else:
        hostname, port = host, (443 if use_ssl else 9200)

    print(f"[os] target={target} host={hostname}:{port}")
    return OpenSearch(
        hosts=[{"host": hostname, "port": port}],
        http_auth=(username, password),
        use_ssl=use_ssl,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
        timeout=timeout,
    )

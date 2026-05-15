"""
Fetch ~8000 unique images from Pexels and save to pexels_images.jsonl.

Sources:
  - /v1/photos/curated  (broad quality images)
  - /v1/search          (one call per category below)

Run: python 01_fetch_pexels.py
Output: pexels_images.jsonl  (one JSON object per line)
"""

import json
import os
import time

import requests
from dotenv import load_dotenv
from tqdm import tqdm

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env.local"))

API_KEY = os.environ["PEXELS_API_KEY"]
TARGET = 8000
PER_PAGE = 80  # Pexels max
OUTPUT = os.path.join(os.path.dirname(__file__), "pexels_images.jsonl")

SEARCH_CATEGORIES = [
    "nature",
    "architecture",
    "people",
    "workspace",
    "urban",
    "abstract",
    "technology",
    "lifestyle",
]

HEADERS = {"Authorization": API_KEY}


def _parse_photo(photo: dict) -> dict:
    return {
        "image_id": str(photo["id"]),
        "title": photo.get("alt", ""),
        "description": photo.get("alt", ""),
        "tags": "",
        "photographer": photo.get("photographer", ""),
        "pexels_url": photo.get("url", ""),
        "thumbnail_url": photo["src"].get("tiny", ""),
        "medium_url": photo["src"].get("medium", ""),
        "width": photo.get("width", 0),
        "height": photo.get("height", 0),
    }


def fetch_curated(seen: set, results: list) -> None:
    page = 1
    pbar = tqdm(desc="curated", unit="img")
    while len(results) < TARGET // 2:
        resp = requests.get(
            "https://api.pexels.com/v1/curated",
            headers=HEADERS,
            params={"per_page": PER_PAGE, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        photos = data.get("photos", [])
        if not photos:
            break
        for photo in photos:
            iid = str(photo["id"])
            if iid not in seen:
                seen.add(iid)
                results.append(_parse_photo(photo))
                pbar.update(1)
        page += 1
        time.sleep(0.2)
    pbar.close()


def fetch_category(category: str, seen: set, results: list, per_category: int) -> None:
    page = 1
    fetched = 0
    pbar = tqdm(desc=category, unit="img", total=per_category)
    while fetched < per_category:
        resp = requests.get(
            "https://api.pexels.com/v1/search",
            headers=HEADERS,
            params={"query": category, "per_page": PER_PAGE, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        photos = data.get("photos", [])
        if not photos:
            break
        for photo in photos:
            iid = str(photo["id"])
            if iid not in seen:
                seen.add(iid)
                # tag the image with the search category for richer text
                parsed = _parse_photo(photo)
                parsed["tags"] = category
                results.append(parsed)
                fetched += 1
                pbar.update(1)
            if fetched >= per_category:
                break
        page += 1
        time.sleep(0.2)
    pbar.close()


def main() -> None:
    seen: set = set()
    results: list = []

    print(f"Target: {TARGET} unique images → {OUTPUT}")

    fetch_curated(seen, results)

    remaining = TARGET - len(results)
    per_category = max(1, remaining // len(SEARCH_CATEGORIES))

    for category in SEARCH_CATEGORIES:
        if len(results) >= TARGET:
            break
        fetch_category(category, seen, results, per_category)

    # top-up if still short
    if len(results) < TARGET:
        shortfall = TARGET - len(results)
        per_category_topup = max(1, shortfall // len(SEARCH_CATEGORIES))
        for category in SEARCH_CATEGORIES:
            if len(results) >= TARGET:
                break
            fetch_category(category, seen, results, per_category_topup)

    print(f"\nFetched {len(results)} unique images.")

    with open(OUTPUT, "w", encoding="utf-8") as f:
        for record in results:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Saved to {OUTPUT}")


if __name__ == "__main__":
    main()

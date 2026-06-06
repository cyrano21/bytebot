import asyncio
import datetime
import json
import os
import sys
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from playwright.async_api import Browser, Page, async_playwright

try:
    from playwright_stealth import Stealth
except Exception:
    Stealth = None


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)


def find_chromium_executable() -> Optional[str]:
    configured = os.environ.get("CHROMIUM_PATH")
    candidates = [
        configured,
        "/usr/bin/chromium-browser",
        "/usr/bin/chromium",
        "/usr/bin/google-chrome",
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return configured


async def apply_stealth(page: Page) -> None:
    if Stealth is None:
        return
    await Stealth().apply_stealth_async(page)


async def launch_browser(playwright) -> Browser:
    launch_options: Dict[str, Any] = {
        "headless": True,
        "args": [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
        ],
    }
    executable_path = find_chromium_executable()
    if executable_path:
        launch_options["executable_path"] = executable_path

    return await playwright.chromium.launch(**launch_options)


async def new_page(browser: Browser) -> Page:
    context = await browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
        locale="fr-FR",
    )
    page = await context.new_page()
    await apply_stealth(page)
    return page


async def find_tiktok_videos_for_hashtag(
    hashtag: str,
    video_limit: int = 5,
) -> List[str]:
    normalized = hashtag.lstrip("#").strip()
    tag_url = f"https://www.tiktok.com/tag/{quote(normalized)}"
    videos: List[str] = []

    async with async_playwright() as playwright:
        browser = await launch_browser(playwright)
        page = await new_page(browser)
        try:
            await page.goto(tag_url, wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_timeout(5_000)

            for _ in range(8):
                links = await page.eval_on_selector_all(
                    'a[href*="/video/"]',
                    """(anchors) => anchors
                        .map((anchor) => anchor.href)
                        .filter((href) => href && href.includes('/video/'))""",
                )
                for href in links:
                    cleaned = href.split("?")[0]
                    if cleaned not in videos:
                        videos.append(cleaned)
                    if len(videos) >= video_limit:
                        return videos[:video_limit]

                await page.mouse.wheel(0, 1800)
                await page.wait_for_timeout(2_000)
        finally:
            await browser.close()

    return videos[:video_limit]


async def scrape_tiktok_comments(
    video_url: str,
    limit: int = 50,
    browser: Optional[Browser] = None,
) -> List[Dict[str, Any]]:
    comments: List[Dict[str, Any]] = []
    seen = set()
    own_browser = browser is None

    async with async_playwright() as playwright:
        if browser is None:
            browser = await launch_browser(playwright)

        page = await new_page(browser)
        try:
            await page.goto(video_url, wait_until="domcontentloaded", timeout=60_000)
            await page.wait_for_timeout(4_000)

            selectors = [
                'p[data-e2e="comment-level-1"]',
                '[data-e2e="comment-level-1"]',
                'div[class*="DivCommentContent"] p',
            ]

            for _ in range(10):
                for selector in selectors:
                    elements = await page.query_selector_all(selector)
                    for element in elements:
                        text = (await element.inner_text()).strip()
                        if not text or text in seen:
                            continue
                        seen.add(text)
                        comments.append({"text": text, "videoUrl": video_url})
                        if len(comments) >= limit:
                            return comments[:limit]

                await page.mouse.wheel(0, 1200)
                await page.wait_for_timeout(1_500)
        finally:
            await page.context.close()
            if own_browser and browser is not None:
                await browser.close()

    return comments[:limit]


async def collect_hashtag_comments(
    hashtag: str,
    comment_limit: int = 20,
    video_limit: int = 5,
) -> Dict[str, Any]:
    videos = await find_tiktok_videos_for_hashtag(hashtag, video_limit)
    comments: List[Dict[str, Any]] = []
    seen = set()

    async with async_playwright() as playwright:
        browser = await launch_browser(playwright)
        try:
            for video_url in videos:
                remaining = comment_limit - len(comments)
                if remaining <= 0:
                    break
                for comment in await scrape_tiktok_comments(video_url, remaining, browser):
                    text = comment.get("text")
                    if not text or text in seen:
                        continue
                    seen.add(text)
                    comments.append(comment)
                    if len(comments) >= comment_limit:
                        break
        finally:
            await browser.close()

    return {
        "hashtag": hashtag.lstrip("#"),
        "videos": videos,
        "comments": comments[:comment_limit],
        "count": len(comments[:comment_limit]),
        "source": "local-playwright-market-research",
    }


def analyze_comments_locally(comments: List[str], niche: str) -> Dict[str, Any]:
    if not comments:
        return {
            "niche": niche,
            "painPoints": [],
            "unmetNeeds": [],
            "forecast": "Pas assez de donnees",
            "confidence": 0,
        }

    try:
        from transformers import pipeline

        classifier = pipeline(
            "zero-shot-classification",
            model="vicgalle/xlm-roberta-large-xnli-anli",
        )
        candidate_labels = [
            "probleme technique ou fragilite",
            "prix trop cher",
            "besoin d'une nouvelle fonctionnalite",
            "deception",
            "satisfaction",
        ]

        pain_points = []
        needs = []
        negative_count = 0
        sample = comments[:30]

        for text in sample:
            if len(text.strip()) < 10:
                continue
            result = classifier(text, candidate_labels)
            top_label = result["labels"][0]
            top_score = result["scores"][0]
            if top_score <= 0.5:
                continue
            if top_label in [
                "probleme technique ou fragilite",
                "prix trop cher",
                "deception",
            ]:
                pain_points.append(text)
                negative_count += 1
            elif top_label == "besoin d'une nouvelle fonctionnalite":
                needs.append(text)

        confidence = min(
            100,
            int((len(pain_points) + len(needs)) / max(1, len(sample)) * 100 * 2),
        )
        forecast = "Marche sature ou produit fonctionnel."
        if negative_count > len(sample) * 0.3:
            forecast = (
                "Opportunite forte : le produit actuel genere beaucoup de "
                "frustration. Trouver un fournisseur qui corrige ces defauts."
            )
        elif len(needs) > len(sample) * 0.1:
            forecast = (
                "Opportunite d'innovation : les clients demandent des "
                "fonctionnalites manquantes."
            )

        return {
            "niche": niche,
            "painPoints": pain_points[:3] or ["Aucun probleme majeur detecte"],
            "unmetNeeds": needs[:3] or ["Aucun besoin specifique detecte"],
            "forecast": forecast,
            "confidence": confidence,
            "analyzed_comments_count": len(sample),
        }
    except Exception as error:
        return {
            "error": str(error),
            "niche": niche,
            "painPoints": [],
            "unmetNeeds": [],
            "forecast": "Erreur d'analyse NLP",
            "confidence": 0,
        }


def save_insights_to_mongo(insights: Dict[str, Any], niche: str, source_url: str) -> None:
    from pymongo import MongoClient

    mongo_uri = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/orchidy-pro")
    client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
    db = client["orchidy-pro"]
    document = {
        "niche": niche,
        "sourceUrl": source_url,
        "painPoints": insights["painPoints"],
        "unmetNeeds": insights["unmetNeeds"],
        "forecast": insights["forecast"],
        "confidence": insights["confidence"],
        "analyzedCount": insights.get("analyzed_comments_count", 0),
        "createdAt": datetime.datetime.utcnow(),
    }
    db["market_insights"].insert_one(document)
    insights["mongodb_inserted_id"] = str(document["_id"])


async def main() -> None:
    if len(sys.argv) >= 2 and sys.argv[1] == "hashtag-comments":
        hashtag = sys.argv[2] if len(sys.argv) >= 3 else "e-commerce"
        comment_limit = int(sys.argv[3]) if len(sys.argv) >= 4 else 20
        video_limit = int(sys.argv[4]) if len(sys.argv) >= 5 else 5
        result = await collect_hashtag_comments(hashtag, comment_limit, video_limit)
        print(json.dumps(result, ensure_ascii=False))
        return

    if len(sys.argv) >= 2 and sys.argv[1] == "comments":
        video_url = sys.argv[2]
        comment_limit = int(sys.argv[3]) if len(sys.argv) >= 4 else 50
        comments = await scrape_tiktok_comments(video_url, comment_limit)
        print(json.dumps({"sourceUrl": video_url, "comments": comments}, ensure_ascii=False))
        return

    if len(sys.argv) < 3:
        print(
            json.dumps(
                {
                    "error": (
                        "Usage: python market_research.py hashtag-comments <hashtag> "
                        "[comment_limit] [video_limit]"
                    )
                }
            )
        )
        return

    niche = sys.argv[1]
    video_url = sys.argv[2]
    comments = await scrape_tiktok_comments(video_url, limit=50)
    comment_texts = [comment["text"] for comment in comments]
    insights = analyze_comments_locally(comment_texts, niche)
    if "error" not in insights:
        save_insights_to_mongo(insights, niche, video_url)
    print(json.dumps(insights, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())

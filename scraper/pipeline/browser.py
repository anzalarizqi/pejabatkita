from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

_playwright_instance = None
_browser = None
_idle_task: asyncio.Task | None = None
IDLE_SECONDS = 300  # close browser after 5 min idle


async def _get_browser():
    global _playwright_instance, _browser, _idle_task

    if _browser is None or not _browser.is_connected():
        try:
            from playwright.async_api import async_playwright
            _playwright_instance = await async_playwright().start()
            _browser = await _playwright_instance.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
            )
            logger.debug("Headless Chromium launched")
        except Exception as e:
            logger.error("Failed to launch browser: %s", e)
            raise

    _reset_idle_timer()
    return _browser


def _reset_idle_timer():
    global _idle_task
    if _idle_task and not _idle_task.done():
        _idle_task.cancel()
    try:
        loop = asyncio.get_running_loop()
        _idle_task = loop.create_task(_idle_close())
    except RuntimeError:
        pass


async def _idle_close():
    await asyncio.sleep(IDLE_SECONDS)
    await close()
    logger.debug("Browser closed after idle timeout")


async def close():
    global _playwright_instance, _browser
    if _browser and _browser.is_connected():
        await _browser.close()
    if _playwright_instance:
        await _playwright_instance.stop()
    _browser = None
    _playwright_instance = None


async def navigate(url: str, wait_for: str | None = None) -> str:
    """
    Open URL in headless browser, return page text (up to 15000 chars).
    Used as last-resort fallback for JS-heavy sites.
    """
    try:
        browser = await _get_browser()
    except Exception:
        return ""

    page = await browser.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        if wait_for:
            await page.wait_for_selector(wait_for, timeout=10000)
        text: str = await page.evaluate("() => document.body.innerText?.slice(0, 15000) || ''")
        logger.debug("browser.navigate(%s): %d chars", url, len(text))
        return text
    except Exception as e:
        logger.debug("browser.navigate(%s) failed: %s", url, e)
        return ""
    finally:
        await page.close()


async def extract(url: str, selector: str) -> list[str]:
    """
    Extract text content of all elements matching selector (max 50).
    """
    try:
        browser = await _get_browser()
    except Exception:
        return []

    page = await browser.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        elements = await page.query_selector_all(selector)
        results = []
        for el in elements[:50]:
            text = (await el.inner_text()).strip()
            if text:
                results.append(text)
        return results
    except Exception as e:
        logger.debug("browser.extract(%s, %r) failed: %s", url, selector, e)
        return []
    finally:
        await page.close()

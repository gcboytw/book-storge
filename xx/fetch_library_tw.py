import sys
import re
from playwright.sync_api import sync_playwright
import httpx
from bs4 import BeautifulSoup

def clean_isbn(raw_isbn: str) -> str:
    return "".join(c for c in raw_isbn if c.isdigit() or c.upper() == 'X')

def scrape_ncl_isbn(isbn: str) -> dict | None:
    isbn_clean = clean_isbn(isbn)
    if not isbn_clean:
        return None

    # 1. 優先嘗試 國圖全國新書資訊網 (Playwright 模擬瀏覽器)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            page = context.new_page()

            # 進入國圖 ISBN 整合平臺 (使用 domcontentloaded 避免公家機關網站 networkidle 超時)
            page.goto("https://isbn.ncl.edu.tw/", timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)

            # 定位搜尋框並填入 ISBN
            search_input = page.locator("input[type='search'], input[name*='keyword'], input[name*='Search'], input[id*='search'], input[type='text']").first
            if search_input.count() > 0:
                search_input.fill(isbn_clean)
                search_input.press("Enter")
                page.wait_for_timeout(3000)

                html_content = page.content()
                soup = BeautifulSoup(html_content, "html.parser")

                # 解析結果標題與出版資訊
                title = None
                author = None
                publisher = None
                pub_date = None

                # 嘗試多種常見書目欄位選取器
                for row in soup.find_all(["tr", "div", "li"]):
                    text = row.get_text(separator=" ", strip=True)
                    if not title and ("題名" in text or "書名" in text) and len(text) < 150:
                        parts = re.split(r"[:：]", text, maxsplit=1)
                        if len(parts) > 1 and len(parts[1].strip()) > 1:
                            title = parts[1].strip()
                    if not author and ("著者" in text or "作者" in text) and len(text) < 100:
                        parts = re.split(r"[:：]", text, maxsplit=1)
                        if len(parts) > 1 and len(parts[1].strip()) > 1:
                            author = parts[1].strip()
                    if not publisher and ("出版者" in text or "出版社" in text) and len(text) < 100:
                        parts = re.split(r"[:：]", text, maxsplit=1)
                        if len(parts) > 1 and len(parts[1].strip()) > 1:
                            publisher = parts[1].strip()

                if title:
                    browser.close()
                    return {
                        "isbn13": isbn_clean if len(isbn_clean) == 13 else None,
                        "isbn10": isbn_clean if len(isbn_clean) == 10 else None,
                        "title": title,
                        "author_display": author,
                        "publisher": publisher,
                        "publication_date": pub_date,
                        "metadata_source": "NCL_Web"
                    }

            browser.close()
    except Exception as e:
        # 若國圖伺服器壅塞或防爬蟲阻擋，進入備援解析
        pass

    # 2. 備援方案：Google Books & OpenLibrary（繁體中文出版品收錄最完整）
    try:
        gb_url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn_clean}"
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            resp = client.get(gb_url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("totalItems", 0) > 0 and "items" in data:
                    vol = data["items"][0].get("volumeInfo", {})
                    return {
                        "isbn13": isbn_clean if len(isbn_clean) == 13 else None,
                        "isbn10": isbn_clean if len(isbn_clean) == 10 else None,
                        "title": vol.get("title"),
                        "author_display": ", ".join(vol.get("authors", [])) if vol.get("authors") else None,
                        "publisher": vol.get("publisher"),
                        "publication_date": vol.get("publishedDate"),
                        "cover_url": vol.get("imageLinks", {}).get("thumbnail"),
                        "metadata_source": "GoogleBooks_TW"
                    }
    except Exception:
        pass
    except Exception:
        pass

    return None

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "9789577413451"
    print(f"正在查詢 ISBN: {target} ...")
    res = scrape_ncl_isbn(target)
    if res:
        print("\n=== 成功抓取 ===")
        for k, v in res.items():
            print(f"{k}: {v}")
    else:
        print("查無此書或解析失敗。")
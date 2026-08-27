import sys
import os
import re
import uuid
from pathlib import Path
import httpx
from bs4 import BeautifulSoup

def clean_isbn(raw_isbn: str) -> str:
    """清理 ISBN 字串，僅保留數字及 X"""
    return "".join(c for c in str(raw_isbn) if c.isdigit() or c.upper() == 'X')

def download_and_save_cover(image_url: str, isbn_or_key: str | None = None) -> str:
    """下載並儲存封面至 static/covers"""
    if not image_url or not image_url.startswith("http"):
        return image_url

    try:
        covers_dir = Path(__file__).resolve().parent / "app" / "static" / "covers"
        covers_dir.mkdir(parents=True, exist_ok=True)

        safe_key = clean_isbn(isbn_or_key) if isbn_or_key else str(uuid.uuid4())[:8]
        ext = ".jpg"
        if ".png" in image_url.lower():
            ext = ".png"
        elif ".webp" in image_url.lower():
            ext = ".webp"

        filename = f"{safe_key}{ext}"
        file_path = covers_dir / filename

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer": "https://www.sanmin.com.tw/",
        }

        with httpx.Client(headers=headers, timeout=10.0, follow_redirects=True) as client:
            resp = client.get(image_url)
            if resp.status_code == 200 and len(resp.content) > 500:
                with open(file_path, "wb") as f:
                    f.write(resp.content)
                return f"/static/covers/{filename}"
    except Exception as e:
        print(f"[CoverDownload] 失敗: {e}")

    return image_url

def fetch_from_sanmin(isbn: str) -> dict | None:
    """第一順位：三民書局站內搜尋"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8",
    }
    search_url = f"https://www.sanmin.com.tw/search?ct=K&qu={isbn}"

    try:
        with httpx.Client(headers=headers, timeout=10.0, follow_redirects=True) as client:
            resp_search = client.get(search_url)
            if resp_search.status_code != 200:
                return None

            soup_search = BeautifulSoup(resp_search.text, "html.parser")
            product_view = soup_search.find(class_=lambda c: c and "ProductView" in c)
            container = product_view if product_view else soup_search

            product_url = None
            for a in container.find_all("a", href=True):
                href = a["href"]
                if "/product/index/" in href:
                    product_url = href if href.startswith("http") else f"https://www.sanmin.com.tw{href}"
                    break

            if not product_url:
                return None

            resp_prod = client.get(product_url)
            if resp_prod.status_code != 200:
                return None

            soup = BeautifulSoup(resp_prod.text, "html.parser")
            title = None
            h1 = soup.find("h1")
            if h1:
                title = h1.get_text(strip=True)
            elif soup.find("meta", property="og:title"):
                title = soup.find("meta", property="og:title")["content"].replace(" - 三民網路書店", "").strip()

            if not title:
                return None

            raw_cover = None
            og_image = soup.find("meta", property="og:image")
            if og_image and og_image.get("content"):
                raw_cover = og_image["content"]

            local_cover = download_and_save_cover(raw_cover, isbn) if raw_cover else None

            author = None
            publisher = None
            publication_date = None

            for li in soup.find_all("li"):
                txt = li.get_text(strip=True)
                if "作者：" in txt or "作者:" in txt:
                    parts = re.split(r"[:：]", txt, maxsplit=1)
                    if len(parts) > 1:
                        author = parts[1].strip()
                elif "出版社：" in txt or "出版社:" in txt:
                    parts = re.split(r"[:：]", txt, maxsplit=1)
                    if len(parts) > 1:
                        publisher = parts[1].strip()
                elif "出版日：" in txt or "出版日:" in txt or "出版日期：" in txt:
                    parts = re.split(r"[:：]", txt, maxsplit=1)
                    if len(parts) > 1:
                        publication_date = parts[1].strip()

            intro = None
            intro_div = soup.find("div", class_=lambda c: c and "intro" in str(c).lower()) or soup.find("div", id=lambda i: i and "intro" in str(i).lower())
            if intro_div:
                intro = intro_div.get_text(strip=True)

            return {
                "isbn13": isbn if len(isbn) == 13 else None,
                "isbn10": isbn if len(isbn) == 10 else None,
                "title": title,
                "author": author,
                "publisher": publisher,
                "publication_date": publication_date,
                "cover_url": local_cover,
                "description": intro,
                "metadata_source": "Sanmin_TW"
            }
    except Exception as e:
        print(f"[SanminLookup] 異常: {e}")
        return None

def fetch_from_openlibrary(isbn: str) -> dict | None:
    """第二順位: OpenLibrary API"""
    url = f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
    headers = {"User-Agent": "BookStorageBot/1.0", "Accept": "application/json"}
    try:
        with httpx.Client(headers=headers, timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                key = f"ISBN:{isbn}"
                if key in data:
                    item = data[key]
                    raw_cover = None
                    if "cover" in item:
                        raw_cover = item["cover"].get("large") or item["cover"].get("medium")
                    local_cover = download_and_save_cover(raw_cover, isbn) if raw_cover else None

                    authors = [a["name"] for a in item.get("authors", []) if "name" in a]
                    publishers = [p["name"] for p in item.get("publishers", []) if "name" in p]
                    return {
                        "isbn13": isbn if len(isbn) == 13 else None,
                        "isbn10": isbn if len(isbn) == 10 else None,
                        "title": item.get("title"),
                        "author": ", ".join(authors) if authors else None,
                        "publisher": ", ".join(publishers) if publishers else None,
                        "publication_date": item.get("publish_date"),
                        "cover_url": local_cover,
                        "metadata_source": "OpenLibrary"
                    }
    except Exception:
        pass
    return None

def fetch_from_google_books(isbn: str) -> dict | None:
    """第三順位: Google Books API"""
    api_key = os.getenv("GOOGLE_BOOKS_API_KEY")
    url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
    if api_key:
        url += f"&key={api_key}"
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    try:
        with httpx.Client(headers=headers, timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("totalItems", 0) > 0 and "items" in data:
                    vol = data["items"][0].get("volumeInfo", {})
                    raw_cover = vol.get("imageLinks", {}).get("thumbnail")
                    local_cover = download_and_save_cover(raw_cover, isbn) if raw_cover else None
                    return {
                        "isbn13": isbn if len(isbn) == 13 else None,
                        "isbn10": isbn if len(isbn) == 10 else None,
                        "title": vol.get("title"),
                        "author": ", ".join(vol.get("authors", [])) if vol.get("authors") else None,
                        "publisher": vol.get("publisher"),
                        "publication_date": vol.get("publishedDate"),
                        "cover_url": local_cover,
                        "description": vol.get("description"),
                        "metadata_source": "GoogleBooks_API"
                    }
    except Exception:
        pass
    return None

def fetch_book_metadata(isbn_raw: str) -> dict | None:
    isbn = clean_isbn(isbn_raw)
    if not isbn:
        return None
    res = fetch_from_sanmin(isbn)
    if res:
        return res
    res = fetch_from_openlibrary(isbn)
    if res:
        return res
    res = fetch_from_google_books(isbn)
    if res:
        return res
    return None

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "9786267156841"
    print(f"正在查詢 ISBN: {target} ...")
    book = fetch_book_metadata(target)
    if book:
        print("\n=== 查詢成功 ===")
        for key, value in book.items():
            print(f"{key}: {value}")
    else:
        print("\n查無此書目資料。")

import sys
import os
import re
import httpx
from bs4 import BeautifulSoup

def clean_isbn(raw_isbn: str) -> str:
    """清理 ISBN 字串，僅保留數字及 X"""
    return "".join(c for c in str(raw_isbn) if c.isdigit() or c.upper() == 'X')

def fetch_from_sanmin(isbn: str) -> dict | None:
    """
    第一順位：三民書局 (臺灣最完整繁中出版品資料庫)
    透過 ISBN 反查商品頁並解析完整的出版元數據
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8",
    }

    try:
        with httpx.Client(headers=headers, timeout=8.0, follow_redirects=True) as client:
            # 1. 取得三民書局對應該 ISBN 的商品專屬網址
            search_endpoint = "https://html.duckduckgo.com/html/"
            resp_index = client.post(search_endpoint, data={"q": isbn})
            
            target_url = None
            if resp_index.status_code == 200:
                soup_idx = BeautifulSoup(resp_index.text, "html.parser")
                for a in soup_idx.find_all("a", class_="result__url"):
                    link_text = a.get_text(strip=True)
                    if "sanmin.com.tw/product/index/" in link_text:
                        target_url = link_text if link_text.startswith("http") else ("https://" + link_text)
                        break

            # 2. 請求書籍商品詳細頁
            resp = client.get(target_url)
            if resp.status_code != 200 or "product/index" not in str(resp.url):
                return None

            soup = BeautifulSoup(resp.text, "html.parser")

            # 書名
            title = None
            h1 = soup.find("h1")
            if h1:
                title = h1.get_text(strip=True)
            if not title:
                og_title = soup.find("meta", property="og:title")
                if og_title and og_title.get("content"):
                    title = og_title["content"].replace(" - 三民網路書店", "").strip()

            if not title:
                return None

            # 封面
            cover_url = None
            og_image = soup.find("meta", property="og:image")
            if og_image and og_image.get("content"):
                cover_url = og_image["content"]

            # 作者、出版社、出版日
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

            return {
                "isbn13": isbn if len(isbn) == 13 else None,
                "isbn10": isbn if len(isbn) == 10 else None,
                "title": title,
                "author": author,
                "publisher": publisher,
                "publication_date": publication_date,
                "cover_url": cover_url,
                "metadata_source": "Sanmin_TW"
            }
    except Exception:
        return None

def fetch_from_openlibrary(isbn: str) -> dict | None:
    """
    第二順位: OpenLibrary API (全球開源圖書庫)
    """
    url = f"https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data"
    headers = {
        "User-Agent": "BookStorageBot/1.0 (contact@example.com)",
        "Accept": "application/json"
    }

    try:
        with httpx.Client(headers=headers, timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                key = f"ISBN:{isbn}"
                if key in data:
                    item = data[key]
                    
                    cover_url = None
                    if "cover" in item:
                        cover_url = item["cover"].get("large") or item["cover"].get("medium")

                    authors = [a["name"] for a in item.get("authors", []) if "name" in a]
                    publishers = [p["name"] for p in item.get("publishers", []) if "name" in p]

                    return {
                        "isbn13": isbn if len(isbn) == 13 else None,
                        "isbn10": isbn if len(isbn) == 10 else None,
                        "title": item.get("title"),
                        "author": ", ".join(authors) if authors else None,
                        "publisher": ", ".join(publishers) if publishers else None,
                        "publication_date": item.get("publish_date"),
                        "cover_url": cover_url,
                        "metadata_source": "OpenLibrary"
                    }
    except Exception:
        pass
    return None

def fetch_from_google_books(isbn: str) -> dict | None:
    """
    第三順位: Google Books API
    """
    api_key = os.getenv("GOOGLE_BOOKS_API_KEY")
    url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}"
    if api_key:
        url += f"&key={api_key}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "application/json"
    }

    try:
        with httpx.Client(headers=headers, timeout=6.0, follow_redirects=True) as client:
            resp = client.get(url)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("totalItems", 0) > 0 and "items" in data:
                    vol = data["items"][0].get("volumeInfo", {})
                    return {
                        "isbn13": isbn if len(isbn) == 13 else None,
                        "isbn10": isbn if len(isbn) == 10 else None,
                        "title": vol.get("title"),
                        "author": ", ".join(vol.get("authors", [])) if vol.get("authors") else None,
                        "publisher": vol.get("publisher"),
                        "publication_date": vol.get("publishedDate"),
                        "cover_url": vol.get("imageLinks", {}).get("thumbnail"),
                        "description": vol.get("description"),
                        "metadata_source": "GoogleBooks_API"
                    }
    except Exception:
        pass
    return None

def fetch_book_metadata(isbn_raw: str) -> dict | None:
    """
    多重來源自動降級查詢入口
    順序: 三民書局 (繁中覆蓋率最高) -> OpenLibrary -> Google Books
    """
    isbn = clean_isbn(isbn_raw)
    if not isbn:
        return None

    # 1. 優先查 三民書局 (臺灣新書、翻譯小說、各出版社繁中書庫最齊全)
    res = fetch_from_sanmin(isbn)
    if res:
        return res

    # 2. 備援查 OpenLibrary
    res = fetch_from_openlibrary(isbn)
    if res:
        return res

    # 3. 備援查 Google Books
    res = fetch_from_google_books(isbn)
    if res:
        return res

    return None

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "9786267356418"
    print(f"正在查詢 ISBN: {target} ...")
    book = fetch_book_metadata(target)
    if book:
        print("\n=== 查詢成功 ===")
        for key, value in book.items():
            print(f"{key}: {value}")
    else:
        print("\n查無此書目資料。")

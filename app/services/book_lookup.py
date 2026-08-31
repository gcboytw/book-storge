import os
import re
import uuid
import httpx
from pathlib import Path
from bs4 import BeautifulSoup
from app.core.config import settings

class BookLookupService:
    @staticmethod
    def clean_isbn(raw_isbn: str) -> str:
        """清理 ISBN 字串，僅保留數字及 X"""
        return "".join(c for c in str(raw_isbn) if c.isdigit() or c.upper() == 'X')

    @classmethod
    def download_and_save_cover(cls, image_url: str, isbn_or_key: str | None = None) -> str:
        """
        將遠端封面圖檔下載並儲存至本地 static/covers 目錄，回傳本地靜態路由路徑。
        若下載失敗則回傳原始 image_url 作為降級。
        """
        if not image_url or not image_url.startswith("http"):
            return image_url

        try:
            settings.COVERS_DIR.mkdir(parents=True, exist_ok=True)
            
            # 決定儲存檔名
            safe_key = cls.clean_isbn(isbn_or_key) if isbn_or_key else ""
            if not safe_key:
                safe_key = str(uuid.uuid4())[:8]

            # 抓取副檔名
            ext = ".jpg"
            if ".png" in image_url.lower():
                ext = ".png"
            elif ".webp" in image_url.lower():
                ext = ".webp"

            filename = f"{safe_key}{ext}"
            file_path = settings.COVERS_DIR / filename

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
            print(f"[CoverDownload] 下載封面失敗 ({image_url}): {e}")

        return image_url

    @classmethod
    def delete_cover_file(cls, cover_url: str | None) -> bool:
        """
        若 cover_url 是本地檔案 (/static/covers/...)，嘗試自 settings.COVERS_DIR 刪除實體檔案。
        """
        if not cover_url or not isinstance(cover_url, str):
            return False

        if cover_url.startswith("/static/covers/"):
            filename = cover_url.replace("/static/covers/", "").strip()
            # 安全性檢查：防止路徑遍歷
            if filename and "/" not in filename and "\\" not in filename and ".." not in filename:
                file_path = settings.COVERS_DIR / filename
                try:
                    if file_path.is_file():
                        file_path.unlink(missing_ok=True)
                        return True
                except Exception as e:
                    print(f"[CoverDelete] 刪除本地封面檔案失敗 ({file_path}): {e}")
        return False

    @classmethod
    def fetch_from_sanmin(cls, isbn: str) -> dict | None:
        """
        第一順位：三民書局站內直接搜尋 (臺灣最完整繁中出版品資料庫)
        """
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8",
        }

        search_url = f"https://www.sanmin.com.tw/search?ct=K&qu={isbn}"

        try:
            with httpx.Client(headers=headers, timeout=10.0, follow_redirects=True) as client:
                resp_search = client.get(search_url)
                if resp_search.status_code != 200:
                    return None

                soup_search = BeautifulSoup(resp_search.text, "html.parser")
                
                # 從主搜尋區塊尋找商品詳細連結
                product_url = None
                
                # 優先在 .ProductView 中尋找商品連結
                product_view = soup_search.find(class_=lambda c: c and "ProductView" in c)
                search_container = product_view if product_view else soup_search

                for a in search_container.find_all("a", href=True):
                    href = a["href"]
                    if "/product/index/" in href:
                        # 避開側邊推薦等非搜尋結果 (如在 ProductView 內即可確定為結果)
                        product_url = href if href.startswith("http") else f"https://www.sanmin.com.tw{href}"
                        break

                if not product_url:
                    return None

                # 請求書籍詳細頁
                resp_prod = client.get(product_url)
                if resp_prod.status_code != 200:
                    return None

                soup = BeautifulSoup(resp_prod.text, "html.parser")

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
                remote_cover_url = None
                og_image = soup.find("meta", property="og:image")
                if og_image and og_image.get("content"):
                    remote_cover_url = og_image["content"]

                # 自動下載封面至本地伺服器
                local_cover_url = cls.download_and_save_cover(remote_cover_url, isbn) if remote_cover_url else None

                # 出版資訊
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

                # 內容簡介
                description = None
                intro_div = soup.find("div", class_=lambda c: c and "intro" in str(c).lower()) or soup.find("div", id=lambda i: i and "intro" in str(i).lower())
                if intro_div:
                    description = intro_div.get_text(strip=True)

                return {
                    "isbn13": isbn if len(isbn) == 13 else None,
                    "isbn10": isbn if len(isbn) == 10 else None,
                    "title": title,
                    "author_display": author,
                    "publisher": publisher,
                    "publication_date": publication_date,
                    "cover_url": local_cover_url,
                    "description": description,
                    "metadata_source": "Sanmin_TW"
                }
        except Exception as e:
            print(f"[SanminLookup] 查詢異常: {e}")
            return None

    @classmethod
    def fetch_from_openlibrary(cls, isbn: str) -> dict | None:
        """
        第二順位: OpenLibrary API
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
                            raw_cover = item["cover"].get("large") or item["cover"].get("medium")
                            cover_url = cls.download_and_save_cover(raw_cover, isbn) if raw_cover else None

                        authors = [a["name"] for a in item.get("authors", []) if "name" in a]
                        publishers = [p["name"] for p in item.get("publishers", []) if "name" in p]

                        return {
                            "isbn13": isbn if len(isbn) == 13 else None,
                            "isbn10": isbn if len(isbn) == 10 else None,
                            "title": item.get("title"),
                            "author_display": ", ".join(authors) if authors else None,
                            "publisher": ", ".join(publishers) if publishers else None,
                            "publication_date": item.get("publish_date"),
                            "cover_url": cover_url,
                            "metadata_source": "OpenLibrary"
                        }
        except Exception:
            pass
        return None

    @classmethod
    def fetch_from_google_books(cls, isbn: str) -> dict | None:
        """
        第三順位: Google Books API
        """
        api_key = settings.GOOGLE_BOOKS_API_KEY
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
                        raw_cover = vol.get("imageLinks", {}).get("thumbnail")
                        cover_url = cls.download_and_save_cover(raw_cover, isbn) if raw_cover else None

                        return {
                            "isbn13": isbn if len(isbn) == 13 else None,
                            "isbn10": isbn if len(isbn) == 10 else None,
                            "title": vol.get("title"),
                            "author_display": ", ".join(vol.get("authors", [])) if vol.get("authors") else None,
                            "publisher": vol.get("publisher"),
                            "publication_date": vol.get("publishedDate"),
                            "cover_url": cover_url,
                            "description": vol.get("description"),
                            "metadata_source": "GoogleBooks_API"
                        }
        except Exception:
            pass
        return None

    @classmethod
    def lookup(cls, isbn_raw: str) -> dict | None:
        """
        多層降級查詢：三民書局(站內搜尋) -> OpenLibrary -> Google Books
        """
        isbn = cls.clean_isbn(isbn_raw)
        if not isbn:
            return None

        # 1. 優先直接查 三民書局站內搜尋
        res = cls.fetch_from_sanmin(isbn)
        if res:
            return res

        # 2. 備援查 OpenLibrary
        res = cls.fetch_from_openlibrary(isbn)
        if res:
            return res

        # 3. 備援查 Google Books
        res = cls.fetch_from_google_books(isbn)
        if res:
            return res

        return None

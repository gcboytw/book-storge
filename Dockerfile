FROM python:3.11-slim

WORKDIR /app

# 安裝系統依賴
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 安裝 uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# 複製依賴描述並安裝
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-cache || uv sync --no-cache

# 複製應用程式程式碼
COPY app ./app
COPY material ./material
COPY scripts ./scripts

# 建立圖檔存放目錄
RUN mkdir -p /app/app/static/covers

ENV HOST=0.0.0.0
ENV APP_PORT=8000
EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

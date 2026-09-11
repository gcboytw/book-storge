---
trigger: always_on
---

# Project Rules

## sw.js

- 絕對不要修改 sw.js 的版號。
- 不要自動增加版號。
- 不要因為修改 Service Worker 而自行更新版號。
- 除非使用者明確要求，否則必須保留目前版號。

## Database

- 不得修改 production database schema。

## Github

- 不要自行執行 git commit。
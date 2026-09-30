# Workflow 模板（未激活）

本目录存放 GitHub Actions workflow 模板。由于自动化使用的 PAT 没有 `workflow` scope，
无法直接把文件写入 `.github/workflows/`，因此先存放于此。

## 激活方法（一次性，约 30 秒）

1. 打开本仓库 GitHub 页面，进入 `app` 目录（或任意目录）
2. 点击 **Add file → Create new file**
3. 文件名输入 `.github/workflows/build-android.yml`
4. 把 [`build-android.yml`](./build-android.yml) 的内容完整粘贴进去
5. Commit changes —— 用你自己的账号提交即可（账号天然有 workflow 权限）

激活后：推送 `v*` tag（例如 `v1.0.1`）或到 Actions 页手动运行，即可自动构建
release APK 并发布到 Releases。

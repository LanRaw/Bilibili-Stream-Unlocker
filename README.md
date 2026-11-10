# 还我推流权 · Bilibili Stream Unlocker

用于 B 站网页直播中心的 Chrome 扩展，恢复第三方软件开播入口，并适配推流地址获取和开播接口。

本分支由 LanRaw 维护，基于 [George-Bai-VDS 的 Chrome 扩展](https://github.com/George-Bai-VDS/Bilibili-Stream-Unlocker)，移植 [ProgramRipper/BLiveWeb 的接口兼容方案](https://github.com/ProgramRipper/BLiveWeb/blob/eaa6433945ebc20dae3a2443b167ea37fdfeb99d/src/index.user.ts)。当前版本为 **1.1.0**。

## 下载与安装

- [下载 1.1.0 完整安装包](https://github.com/LanRaw/Bilibili-Stream-Unlocker/releases/download/v1.1.0/bilibili-live-extension-v1.1.0.zip)
- [查看所有发布版本](https://github.com/LanRaw/Bilibili-Stream-Unlocker/releases)
- [仓库内的同版 ZIP 备份](https://github.com/LanRaw/Bilibili-Stream-Unlocker/raw/refs/heads/master/dist/bilibili-live-extension-v1.1.0.zip)

1. 下载 ZIP，解压到一个固定保留的文件夹；该文件夹根目录应包含 `manifest.json`。
2. 打开 `chrome://extensions/`，启用右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择刚才的文件夹。
4. 停用其他同类脚本或旧版扩展，避免重复拦截，然后刷新 [B 站开播设置页](https://link.bilibili.com/#/my-room/start-live)。
5. 选择直播分区，点击「开始直播」，将页面返回的服务器地址和串流密钥填入 OBS。

已安装此分支时，可将新版文件覆盖到原目录，在扩展管理页点击「重新加载」，再刷新直播中心。如果移动了解压目录，需要重新选择目录加载。

## 1.1.0 修复内容

原版只处理名称含 `startLive` 的请求。新版网页先调用 `FetchWebUpStreamAddr`，原版漏掉该接口，因而会出现「第三方开播卡片可见，点击后却失败」的情况。排查时服务器返回 `690001 系统维护仅支持直播姬开播`。

本版采用上游兼容方案：

- 捕获网页请求中的房间 ID，将取地址请求转换为 `get_stream_by_roomId`，适配返回字段 `rtmp/stream_line` 为网页需要的 `addr/line`。
- 将 `WebLiveCenterStartLive` 转换为带客户端参数和 MD5 签名的 `/room/v1/Room/startLive`。
- 同时支持 XHR 和 fetch，保留服务器真实失败响应。
- 直接在页面 MAIN 世界安装拦截器，修复网页脚本误用扩展后台 API 的异常；移除重复注入、无关第三方库/WebSocket 修改及请求体日志。
- 清理旧版无效的自定义请求头规则，缩减扩展权限。

## 验证与使用边界

2026-11-10 在 macOS Chrome 中实测：已取得服务器地址与串流密钥；完成 B 站要求的本人人脸认证后，页面成功进入开播状态，随后结束测试直播。未进行 OBS 音视频推流测试。

入口显示不代表服务器已经授予开播权限。实名认证、人脸验证等账号要求仍需本人完成；实际可用性以 B 站当前服务端响应为准。每次重新开播，请重新复制页面中的地址和串流密钥。

本扩展只处理 B 站直播 API 的指定端点，不直接读取 Cookie，不记录或上传推流码；登录凭据由浏览器按页面请求正常携带。Chrome 为本次实测环境，其他 Chromium 浏览器尚未验证。

## 开发与打包

没有 npm 依赖。测试需要 Node.js 20 或更高版本；打包需要 Python 3。

```sh
node --test tests/content.test.cjs
node --check content.js
node --check background.js
python3 scripts/build_package.py
```

测试覆盖 XHR/fetch 接口转换、响应字段、请求签名、凭据传递、服务端错误保留及无关请求透传。

打包脚本会生成 `dist/bilibili-live-extension-v1.1.0.zip` 和 `dist/SHA256SUMS`。ZIP 只包含扩展运行文件、图标、说明和许可证，不包含测试、Git 元数据、本地备份或调试记录。对相同源码重复打包会生成相同的校验值。

更新记录见 [CHANGELOG.md](CHANGELOG.md)。原作者及分支作者的 MIT 声明见 [LICENSE.txt](LICENSE.txt)。

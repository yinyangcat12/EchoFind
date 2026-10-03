# EchoFind — 中控专用 Cloudflare Workers 部署

本仓库只发布 `/control.html`，`/`、`/index.html`、空间总览、AI 接口及飞书文档接口全部返回 404。
源码采用平铺结构方便 GitHub 网页上传；`node build.mjs` 只把允许的静态文件复制到 `dist/`，并从锁定版本的 Three.js 复制实际引用的模块。不要把整个仓库设成静态目录。

## Cloudflare Workers Builds

- 仓库：yinyangcat12/EchoFind；分支：main；根目录：`/`
- 构建命令可留空；部署命令：`npx wrangler deploy`
- Wrangler 会通过配置自动执行 `node build.mjs`。
- Worker 名称已设为 `echofind`，不创建收费数据库或服务器。
- 访问平台实际生成的 `https://<你的 Worker 域名>/control.html`。根路径故意 404。

## 首次部署后，必须在 Worker Settings → Variables and Secrets 添加

**全部选择 Secret，不要提交到 GitHub，不要放在构建变量或 HTML/JS 中：**

| 变量 | 内容 |
| --- | --- |
| APP_ACCESS_PASSWORD | 新的网页访问密码，至少 16 位；只分享给演示观众 |
| SESSION_SECRET | 独立高强度随机串，至少 32 位；不能当访问密码分享 |
| FEISHU_APP_ID | 本机 `.env` 中的飞书应用 ID |
| FEISHU_APP_SECRET | 本机 `.env` 中的飞书应用密钥 |
| FEISHU_APP_TOKEN | 本机 `.env` 中的多维表格标识 |
| FEISHU_TABLE_ID | 本机 `.env` 中的数据表标识 |

保存并部署变量后刷新网页。缺少安全变量时数据接口默认拒绝访问；缺少飞书变量时返回“尚未配置”，不会编造红点。FEISHU_DEFAULT_STATION 默认 LeftUpper 已写入非机密配置。

## 行为

- 保留原房间 GLB、拖动视角、两台基站、信号强弱/距离映射和墙体避让。
- 每次页面刷新生成一个随机 seed；5 秒轮询保持 seed 不变；信号改变、新增或删除物品时才调整对应点。
- Cookie 使用签名认证，跨 Worker 实例仍有效；8 小时后过期；变更访问密码或会话密钥使旧 Cookie 失效。
- 退出仅清除此浏览器 Cookie；不实现跨地区即时吊销。全站强制失效请轮换 SESSION_SECRET。
- 飞书认证与数据仅服务端读取；每实例短缓存合并并发请求。演示表最多读取 20 页/2000 条，超限会显式报错。
- 网页展示的数据和模型可以被获授权的浏览器读取；保护的是后台凭据，不是让已展示内容无法复制。
- 此部署不使用 AI，原 AI 密钥不得上传。

## 本地验证

`npm ci` → `npm run build` → `npm test`

`npx wrangler deploy --dry-run` 只校验构建，不发布。不得将 `.env`、`feishu_test.py`、`.dev.vars`、`node_modules/`、工具日志或 Blender 源文件上传。

免费套餐存在请求/CPU等限额；当前配置不购买任何付费服务。小规模临时演示使用免费 workers.dev 地址即可。分享前请核对 Cloudflare 账号仍为 Free。
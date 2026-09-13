<div align="center">

# nuo agent launcher

**一个功能丰富的 Minecraft 启动器 —— Java 版 / 基岩版、自动 Java、联机大厅、免密钥 AI 助手**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/platform-Windows%20x64-0078D4.svg)](#)
[![Version](https://img.shields.io/github/v/release/nuoagentlauncher/nuo-agent-launcher?include_prereleases&label=version)](https://github.com/nuoagentlauncher/nuo-agent-launcher/releases)
[![Downloads](https://img.shields.io/github/downloads/nuoagentlauncher/nuo-agent-launcher/total?label=downloads)](https://github.com/nuoagentlauncher/nuo-agent-launcher/releases)

[官方下载站](https://nuoagentlauncher.github.io/nuo-agent-launcher/) · [更新日志](CHANGELOG.md) · [下载最新版](https://github.com/nuoagentlauncher/nuo-agent-launcher/releases/latest)

</div>

---

## 功能特性

### 游戏核心
- **Java 版**：解析 Mojang 官方版本清单，支持原版 / Forge / Fabric 一键下载启动
- **基岩版**：通过微软商店 API 获取 appx 包，自动注册安装、一键启动
- **Java 自动管理**：读取版本官方声明的 `javaVersion`，自动下载匹配的 JRE（新版本如 Java 25 也能自动适配）
- **资源多源回退**：Mojang 官方源 + BMCLAPI 镜像源，下载失败自动切换
- 离线账号管理，开箱即用

### 联机大厅
- 房主一键创建房间，房客输入 IP 加入
- 房间密码保护（SHA-256 校验）
- 局域网房间自动发现（Minecraft 官方多播协议）
- **UPnP 内网穿透**：SSDP 发现路由器 + SOAP 端口映射，自动返回公网 IP，跨网络联机无需手动配置

### AI 助手
- **完全免 API 密钥**，无需任何配置
- 多免费通道自动轮换（OVHcloud、Pollinations 等）
- **AI 测速**：并发探测各通道延迟，自动优先使用最快通道

### 个性化
- 明 / 暗双主题，切换即时生效
- 开发者模式 + 独立配色配置页，可自定义主题色，背景渐变自动生成
- 响应式界面 + 丰富交互动画

### 其他
- 实时更新检测（基于 GitHub Releases）
- 完整日志系统（启动日志 / 下载日志 / 全局日志页）
- Mod 管理

## 下载安装

前往 **[GitHub Releases](https://github.com/nuoagentlauncher/nuo-agent-launcher/releases/latest)** 或 **[官方下载站](https://nuoagentlauncher.github.io/nuo-agent-launcher/)**，提供两个版本：

| 版本 | 说明 |
| --- | --- |
| 便携版 `nuo-agent-launcher-便携版.exe` | 免安装，解压即用，适合 U 盘携带 |
| 安装版 `nuo-agent-launcher-安装版.exe` | 安装向导，可选目录，创建桌面快捷方式 |

> 仅支持 Windows x64。

## 技术栈

- **桌面框架**：Electron 29
- **前端**：React 18 + Vite 5 + Zustand + React Router
- **打包**：electron-builder（portable / nsis）
- **后端服务**：Node.js 原生模块（`net` / `dgram` / `http`，实现联机与 UPnP，零额外重型依赖）

## 从源码运行

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（同时启动 Vite 与 Electron，热更新）
npm run dev

# 3. 打包 Windows x64（产物输出到 dist-release/）
npm run build
```

## 目录结构

```
nuo agent launcher/
├── electron/              # Electron 主进程（服务层）
│   ├── main.cjs           # 应用入口、IPC 注册
│   ├── preload.cjs        # 预加载脚本（安全桥接）
│   └── services/
│       ├── downloader.cjs # 游戏资源下载（多源回退）
│       ├── java.cjs       # Java 运行时自动管理
│       ├── launcher.cjs   # 启动参数生成与游戏拉起
│       ├── bedrock.cjs    # 基岩版下载安装
│       ├── multiplayer.cjs# 联机房间 / 局域网发现 / UPnP
│       ├── updater.cjs    # 版本更新检测（GitHub Releases）
│       ├── ai.cjs         # 免密钥 AI 与测速
│       ├── account.cjs    # 账号管理
│       ├── mod.cjs        # Mod 管理
│       └── logger.cjs     # 日志
├── src/                   # React 渲染进程
│   ├── pages/             # 各功能页面
│   ├── stores/            # Zustand 状态
│   └── styles/            # 全局样式与主题变量
├── build/                 # 应用图标
├── website/               # 官方下载站（GitHub Pages）
└── package.json
```

## 更新日志

所有版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 开源协议

[MIT License](LICENSE)

---

> Minecraft 版权归 Mojang Studios / Microsoft 所有。本项目为第三方启动器，与 Mojang、Microsoft 没有隶属关系。

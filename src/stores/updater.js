// 启动器自更新 store：App 横幅与 About 页共享下载进度状态
import { create } from 'zustand'

export const useUpdaterStore = create((set) => ({
  // 主进程推送的"发现新版本"信息 { hasUpdate, current, latest, release }
  updateInfo: null,
  // 下载进度 { phase, percent, received, total, speed, message }
  download: null,
  setUpdateInfo: (info) => set({ updateInfo: info }),
  clearUpdate: () => set({ updateInfo: null }),
  setDownload: (d) => set({ download: d }),
}))

// phase 处于这些值之外（error/idle）视为未在下载
export const isDownloading = (download) =>
  !!download && !['error', 'idle'].includes(download.phase)

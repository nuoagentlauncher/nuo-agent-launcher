// 全局配置 store：通过 IPC 与主进程同步
import { create } from 'zustand'

export const useConfigStore = create((set, get) => ({
  config: {},
  setAll: (all) => set({ config: all || {} }),
  get: (key, def) => {
    const v = get().config[key]
    return v === undefined ? def : v
  },
  set: (key, value) => {
    set((s) => ({ config: { ...s.config, [key]: value } }))
    // 同步到主进程
    if (window.nal?.config?.set) {
      window.nal.config.set(key, value).catch((e) => console.error('Config sync failed:', e))
    }
  },
}))

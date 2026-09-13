import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 配置：为 Electron 优化
// base 设为相对路径，使打包后资源加载与 file:// 协议兼容
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
})

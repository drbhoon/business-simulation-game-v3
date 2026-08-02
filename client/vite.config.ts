import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// On the HR platform the app is mounted at hr.rdcc.ai/simgame; everywhere else
// it sits at the root. Vite bakes `base` into the built asset URLs and exposes
// it to the client as import.meta.env.BASE_URL — see src/basePath.ts.
const base = process.env.BASE_PATH ? `${process.env.BASE_PATH}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
})

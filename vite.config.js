import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Plain HTTP — works fine on localhost (camera + mic granted automatically)
// Switch back to basicSsl() + host:true if you need to test on a phone
export default defineConfig({
  plugins: [react()],
})

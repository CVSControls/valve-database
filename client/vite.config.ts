import { defineConfig } from 'vite';import react from '@vitejs/plugin-react';
export default defineConfig({base:process.env.GITHUB_ACTIONS?`/${process.env.GITHUB_REPOSITORY?.split('/')[1]||'valve-database'}/`:'/',plugins:[react()],server:{port:5173}});

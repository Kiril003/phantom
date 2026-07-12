/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly AEGIS_BACKEND?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

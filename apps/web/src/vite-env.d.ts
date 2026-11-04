/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_MSAL_CLIENT_ID?: string;
  readonly VITE_MSAL_TENANT_ID?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_BASE?: string;
}

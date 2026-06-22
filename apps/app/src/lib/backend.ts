import { SupabaseBackend } from "@pulpo/backend-supabase";
import { supabase } from "./supabase";

/**
 * BackendPort de la app: la misma abstracción que usa el runner, pero sobre el
 * cliente Supabase ya autenticado. RLS limita lo que ve a sus propios datos.
 */
export const backend = new SupabaseBackend(supabase);

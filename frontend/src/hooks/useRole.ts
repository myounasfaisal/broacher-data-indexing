import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import type { UserRole } from "@/types/chemical";

/**
 * Reads the current user's role ('admin' | 'viewer') from the `profiles` table.
 *
 * This drives UX only (which nav/routes to show). The backend independently
 * re-checks the role on every protected endpoint — that is the real security
 * boundary, not this hook.
 */
export function useRole() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["role", user?.id],
    enabled: !!user,
    queryFn: async (): Promise<UserRole> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data.role as UserRole;
    },
  });
}

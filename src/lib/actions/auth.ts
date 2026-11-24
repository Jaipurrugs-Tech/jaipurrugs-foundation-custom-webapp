"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthActionState = { error?: string; message?: string };

// Single flow, no separate sign-up UI: a whitelisted email's first-ever
// password attempt creates its account (rejected by the before-user-created
// hook if not whitelisted); an existing account just signs in. Supabase
// deliberately returns the same generic error for "wrong password" and "no
// such account" on signInWithPassword (to prevent user enumeration), so we
// distinguish the two by attempting signUp next: it only succeeds when no
// account exists yet, which is exactly the "first time" case.
export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await createClient();

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (!signInError) {
    redirect("/dashboard");
  }

  const { data, error: signUpError } = await supabase.auth.signUp({ email, password });

  if (signUpError) {
    // Either "already registered" (a wrong password on an existing account) or
    // the whitelist hook's rejection. One message for both, so the login page
    // doesn't reveal which emails are whitelisted or registered.
    console.warn("[auth] sign-in refused:", signUpError.status, signUpError.code ?? signUpError.message);
    return { error: "Incorrect email or password, or this email doesn't have access. Ask an admin if you need access." };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  // Only reached if the project still has email confirmation enabled.
  return { message: "Check your email to confirm your account, then sign in again." };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}
